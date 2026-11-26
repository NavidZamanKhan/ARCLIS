import json
import os
import selectors
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from time import monotonic

from .states import ExecutionState

CONTAINER_LABEL = "org.arclis.worker=local"
_DOCKER_ENVIRONMENT = {"PATH": os.defpath, "LANG": "C"}
_CONTROL_TIMEOUT = 15
_REQUIRED_LIMITS = ("MemoryLimit", "SwapLimit", "CpuCfsPeriod", "CpuCfsQuota", "PidsLimit")


class SandboxError(RuntimeError):
    """A Docker or isolation failure safe to report to an operator."""


class Toolchain(StrEnum):
    C_CPP = "c-cpp"
    JAVA = "java"
    PYTHON = "python"

    @property
    def image(self):
        return f"arclis-toolchain-{self.value}:s03"


@dataclass(frozen=True)
class SandboxLimits:
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
            ("output_bytes", 1, 256 * 1024),
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

    def create(self, name, workspace, toolchain, argv, limits):
        memory = f"{limits.memory_mib}m"
        scratch = f"rw,exec,nosuid,nodev,size={limits.scratch_mib}m,mode=1777"
        result = self._call(
            "create",
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

    def execute(self, name, limits):
        started = monotonic()
        with subprocess.Popen(
            (*self._docker, "start", "--attach", name),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_DOCKER_ENVIRONMENT,
        ) as attached:
            try:
                streams = [bytearray(), bytearray()]
                code, early = _read_output(
                    attached, streams, limits.output_bytes, started + limits.timeout_seconds,
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
        result = self._call("container", "rm", "--force", "--volumes", name)
        if result.returncode and f"no such container: {name}" not in result.stderr.lower():
            raise SandboxError("Docker did not confirm cleanup of the job container.")


def _read_output(attached, streams, cap, deadline):
    remaining_bytes = cap
    with selectors.DefaultSelector() as selector:
        selector.register(attached.stdout, selectors.EVENT_READ, streams[0])
        selector.register(attached.stderr, selectors.EVENT_READ, streams[1])
        while selector.get_map():
            remaining_time = deadline - monotonic()
            if remaining_time <= 0:
                return None, ExecutionState.TIMEOUT
            for key, _ in selector.select(remaining_time):
                chunk = os.read(key.fd, min(65536, remaining_bytes + 1))
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                key.data.extend(chunk[:remaining_bytes])
                remaining_bytes -= len(chunk)
                if remaining_bytes < 0:
                    return None, ExecutionState.RESOURCE_LIMIT_EXCEEDED
    try:
        return attached.wait(timeout=max(0, deadline - monotonic())), None
    except subprocess.TimeoutExpired:
        return None, ExecutionState.TIMEOUT
