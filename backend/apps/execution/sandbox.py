import json
import os
import selectors
import struct
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from time import monotonic
from typing import ClassVar

from .interaction import EOF, MAX_EVENT_CHUNK, MAX_RUNTIME_SECONDS, POLL_SECONDS
from .states import ExecutionState

CONTAINER_LABEL = "org.arclis.worker=local"
_DOCKER_ENVIRONMENT = {"PATH": os.defpath, "LANG": "C"}
_CONTROL_TIMEOUT = 15
_REQUIRED_LIMITS = ("MemoryLimit", "SwapLimit", "CpuCfsPeriod", "CpuCfsQuota", "PidsLimit")
COMPILER_FRAME = struct.Struct(">4sBI")


class SandboxError(RuntimeError):
    """A Docker or isolation failure safe to report to an operator."""


class Toolchain(StrEnum):
    C_CPP = "c-cpp"
    C_ANALYZER = "c-analyzer"
    JAVA = "java"
    PYTHON = "python"
    PYTHON_ANALYZER = "python-analyzer"

    @property
    def image(self):
        version = {Toolchain.C_ANALYZER: "s18", Toolchain.PYTHON_ANALYZER: "s19"}.get(self, "s06")
        return f"arclis-toolchain-{self.value}:{version}"


@dataclass(frozen=True)
class SandboxLimits:
    MAX_OUTPUT_BYTES: ClassVar[int] = 256 * 1024
    cpu_millis: int = 1000
    memory_mib: int = 256
    processes: int = 64
    scratch_mib: int = 32
    output_bytes: int = 256 * 1024
    timeout_seconds: float = 15.0

    def __post_init__(self):
        for name, minimum, maximum in (
            ("cpu_millis", 10, 1000),
            ("memory_mib", 32, 512),
            ("processes", 8, 64),
            ("scratch_mib", 1, 64),
            ("output_bytes", 1, self.MAX_OUTPUT_BYTES),
        ):
            value = getattr(self, name)
            if type(value) is not int or not minimum <= value <= maximum:
                raise ValueError(f"{name} must be an integer between {minimum} and {maximum}.")
        if type(self.timeout_seconds) not in (int, float) or not 0 < self.timeout_seconds <= 30:
            raise ValueError("timeout_seconds must be greater than zero and at most 30.")


@dataclass(frozen=True)
class SandboxOutcome:
    state: ExecutionState
    stdout: bytes = b""
    stderr: bytes = b""
    exit_code: int | None = None
    duration_ms: int = 0
    error: str | None = None


def validate_engine_info(info):
    options = info.get("SecurityOptions")
    if (
        info.get("CgroupVersion") != "2"
        or info.get("CgroupDriver") != "systemd"
        or not isinstance(options, list)
        or "name=rootless" not in options
        or "name=seccomp,profile=builtin" not in options
        or not all(info.get(limit) is True for limit in _REQUIRED_LIMITS)
    ):
        raise SandboxError("Docker must provide rootless mode, seccomp, and all cgroup limits.")


class DockerSandbox:
    def __init__(self, configuration: Path):
        if os.name != "posix":
            raise SandboxError("Run the local Docker worker on Linux or WSL 2.")
        configuration.mkdir(mode=0o700)
        self._docker = (
            "docker",
            "--config",
            str(configuration),
            "--host",
            f"unix:///run/user/{os.getuid()}/docker.sock",
        )

    def _call(self, *args):
        try:
            return subprocess.run(
                (*self._docker, *args),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=_CONTROL_TIMEOUT,
                env=_DOCKER_ENVIRONMENT,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise SandboxError("Docker control command could not be completed.") from error

    def verify(self):
        result = self._call("info", "--format", "{{json .}}")
        if result.returncode:
            raise SandboxError("The local rootless Docker daemon could not be inspected.")
        try:
            info = json.loads(result.stdout)
            if not isinstance(info, dict):
                raise ValueError("Expected a Docker info object.")
        except ValueError as error:
            raise SandboxError("Docker isolation capabilities could not be verified.") from error
        validate_engine_info(info)

    def create(self, name, workspace, toolchain, argv, limits, *, interactive=False):
        memory = f"{limits.memory_mib}m"
        scratch = f"rw,exec,nosuid,nodev,size={limits.scratch_mib}m,mode=1777"
        result = self._call(
            "create",
            *(("--interactive",) if interactive else ()),
            "--name", name,
            "--label", CONTAINER_LABEL,
            "--pull", "never",
            "--network", "none",
            "--ipc", "private",
            "--user", "65534:65534",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--read-only",
            "--init",
            "--log-driver", "none",
            "--ulimit", "core=0:0",
            "--cpus", f"{limits.cpu_millis / 1000:.3f}",
            "--memory", memory,
            "--memory-swap", memory,
            "--pids-limit", str(limits.processes),
            "--shm-size", "8m",
            "--tmpfs", f"/tmp:{scratch}",
            "--mount", f"type=bind,src={workspace},dst=/workspace,readonly",
            "--workdir", "/workspace",
            toolchain.image,
            *argv,
        )
        if result.returncode:
            raise SandboxError("Docker could not create the worker. Check the local toolchain image.")

    def execute(self, name, limits, *, compiler_frame=False, interaction=None):
        started = monotonic()
        with subprocess.Popen(
            (
                *self._docker, "start", "--attach",
                *(("--interactive",) if interaction is not None else ()), name,
            ),
            stdin=subprocess.PIPE if interaction is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
            env=_DOCKER_ENVIRONMENT,
        ) as attached:
            try:
                streams = [bytearray(), bytearray()]
                code, early = _read_output(
                    attached, streams, limits.output_bytes, started + limits.timeout_seconds,
                    compiler_frame=compiler_frame, interaction=interaction,
                    runtime_deadline=started + MAX_RUNTIME_SECONDS,
                )
            finally:
                if attached.poll() is None:
                    attached.kill()
                attached.wait()

        duration = round((monotonic() - started) * 1000)
        stdout, stderr = (bytes(stream) for stream in streams)
        if early is not None:
            return SandboxOutcome(early, stdout, stderr, duration_ms=duration)

        result = self._call("container", "inspect", "--format", "{{json .State}}", name)
        if result.returncode:
            raise SandboxError("Docker could not verify the container exit.")
        try:
            state = json.loads(result.stdout)
            status, exit_code = state["Status"], state["ExitCode"]
        except (ValueError, TypeError, KeyError) as error:
            raise SandboxError("Docker returned an invalid container exit state.") from error
        if status != "exited" or state.get("Error") or exit_code != code:
            raise SandboxError("Docker did not confirm a normal container exit.")
        if state.get("OOMKilled"):
            outcome = ExecutionState.RESOURCE_LIMIT_EXCEEDED
        elif exit_code == 0:
            outcome = ExecutionState.COMPLETED
        else:
            outcome = ExecutionState.RUNTIME_FAILED
        return SandboxOutcome(outcome, stdout, stderr, exit_code, duration)

    def remove(self, name):
        # A timed-out request may have removed the container before losing its response.
        for _ in range(2):
            try:
                result = self._call("container", "rm", "--force", "--volumes", name)
            except SandboxError:
                continue
            if result.returncode == 0 or f"no such container: {name}" in result.stderr.lower():
                return
        raise SandboxError("Docker did not confirm cleanup of the job container.")


def compiler_header(output):
    magic, phase, size = COMPILER_FRAME.unpack_from(output)
    if magic != b"ARC1" or phase not in (0, 1, 2):
        raise SandboxError("The native launcher returned an invalid compiler record.")
    return phase, size


def _read_output(attached, streams, cap, deadline, *, compiler_frame=False,
                 interaction=None, runtime_deadline=None):
    remaining_bytes = cap
    interactive_runtime = False
    pending_input = b""
    with selectors.DefaultSelector() as selector:
        selector.register(attached.stdout, selectors.EVENT_READ, streams[0])
        if compiler_frame:
            stopped = _read_compiler_frame(selector, streams[0], cap, deadline, interaction)
            if stopped is not None:
                return None, stopped
            remaining_bytes -= max(0, len(streams[0]) - COMPILER_FRAME.size)
            if interaction is not None and len(streams[0]) >= COMPILER_FRAME.size:
                phase, length = compiler_header(streams[0])
                if len(streams[0]) == COMPILER_FRAME.size + length:
                    for offset in range(COMPILER_FRAME.size, len(streams[0]), MAX_EVENT_CHUNK):
                        interaction.emit(
                            "diagnostics", bytes(streams[0][offset:offset + MAX_EVENT_CHUNK]),
                        )
                    if phase == 0:
                        interaction.begin_runtime()
                        os.set_blocking(attached.stdin.fileno(), False)
                        interactive_runtime = True
                        deadline = runtime_deadline
        selector.register(attached.stderr, selectors.EVENT_READ, streams[1])
        while selector.get_map() or (interaction is not None and attached.poll() is None):
            stopped = _interrupt(interaction, deadline)
            if stopped is not None:
                return None, stopped
            if interactive_runtime:
                pending_input = _write_input(attached.stdin, interaction, pending_input)
            remaining_time = deadline - monotonic()
            wait = min(POLL_SECONDS, remaining_time) if interaction is not None else remaining_time
            for key, _ in selector.select(max(0, wait)):
                chunk_size = MAX_EVENT_CHUNK if interaction is not None else 65536
                chunk = os.read(key.fd, min(chunk_size, remaining_bytes + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                retained = chunk[:remaining_bytes]
                key.data.extend(retained)
                if interactive_runtime and retained:
                    interaction.emit("stdout" if key.fileobj is attached.stdout else "stderr", retained)
                remaining_bytes -= len(chunk)
                if remaining_bytes < 0:
                    return None, ExecutionState.RESOURCE_LIMIT_EXCEEDED
    try:
        return attached.wait(timeout=max(0, deadline - monotonic())), None
    except subprocess.TimeoutExpired:
        return None, ExecutionState.TIMEOUT


def _interrupt(interaction, deadline):
    if interaction is not None and (state := interaction.interruption()) is not None:
        return state
    if monotonic() >= deadline:
        return ExecutionState.TIMEOUT
    return None


def _write_input(stream, interaction, pending):
    if stream.closed:
        return b""
    data = pending or interaction.read_input()
    if data is EOF:
        stream.close()
    elif data:
        try:
            return data[os.write(stream.fileno(), data):]
        except BlockingIOError:
            return data
        except BrokenPipeError:
            stream.close()
    return b""


def _read_compiler_frame(selector, output, cap, deadline, interaction):
    # The launcher writes its record to stdout before it can start the program.
    # Consume that record before charging runtime stderr to the shared budget.
    target = COMPILER_FRAME.size
    while len(output) < target:
        stopped = _interrupt(interaction, deadline)
        if stopped is not None:
            return stopped
        remaining = deadline - monotonic()
        wait = min(POLL_SECONDS, remaining) if interaction is not None else remaining
        events = selector.select(max(0, wait))
        if not events:
            continue
        key, _ = events[0]
        chunk = os.read(key.fd, target - len(output))
        if not chunk:
            selector.unregister(key.fileobj)
            return None
        output.extend(chunk)
        if target == COMPILER_FRAME.size and len(output) == target:
            _, size = compiler_header(output)
            if size > cap:
                raise SandboxError("The native launcher exceeded its diagnostic budget.")
            target += size
    return None
