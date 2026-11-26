from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from .sandbox import (
    COMPILER_FRAME,
    DockerSandbox,
    SandboxError,
    SandboxLimits,
    SandboxOutcome,
    Toolchain,
    compiler_header,
)
from .states import ExecutionSession, ExecutionState
from .workspace import SourceFile, materialize_workspace, validate_workspace

WORKSPACE_PREFIX = "arclis-worker-"
MAX_STDIN_BYTES = 64 * 1024


@dataclass(frozen=True)
class ExecutionResult:
    job_id: str
    history: tuple[ExecutionState, ...]
    outcome: SandboxOutcome
    compiler_diagnostics: bytes = b""


def run_job(
    files: Sequence[SourceFile],
    toolchain: Toolchain,
    argv: Sequence[str],
    limits: SandboxLimits = SandboxLimits(),
) -> ExecutionResult:
    """Run an adapter's trusted argument list in a local, per-job Docker sandbox."""
    if (
        not isinstance(toolchain, Toolchain)
        or not isinstance(limits, SandboxLimits)
        or isinstance(argv, (str, bytes))
        or not argv
        or not argv[0]
        or any(not isinstance(arg, str) or "\0" in arg for arg in argv)
    ):
        raise ValueError("Supply a toolchain, validated limits, and trusted command arguments.")
    return _run_job(validate_workspace(files), toolchain, argv, limits)


def run_compiled_job(workspace, toolchain, compiler, program, *, stdin, limits):
    """Run trusted compile and program argv with framed diagnostics and buffered stdin."""
    if not isinstance(limits, SandboxLimits):
        raise ValueError("Supply validated worker limits.")
    if not isinstance(stdin, bytes) or len(stdin) > MAX_STDIN_BYTES:
        raise ValueError("Standard input must be bytes and at most 64 KiB.")

    command = (
        "python3", "-I", "/opt/arclis/native_job.py", str(limits.output_bytes),
        str(len(compiler)), *compiler, *program,
    )
    return _run_job(workspace, toolchain, command, limits, native_stdin=stdin)


def _run_job(validated, toolchain, argv, limits, *, native_stdin=None):
    job_id = uuid4().hex
    name = f"arclis-job-{job_id}"
    session = ExecutionSession()
    session.transition(ExecutionState.PREPARING)
    diagnostics = b""

    try:
        with TemporaryDirectory(prefix=f"{WORKSPACE_PREFIX}{job_id}-", dir="/tmp") as temporary:
            root = Path(temporary)
            workspace = root / "input"
            materialize_workspace(workspace, validated)
            if native_stdin is not None:
                input_file = workspace / ".arclis-stdin"
                input_file.write_bytes(native_stdin)
                input_file.chmod(0o644)
            sandbox = DockerSandbox(root / "docker")
            sandbox.verify()
            try:
                sandbox.create(name, workspace, toolchain, argv, limits)
                if native_stdin is None:
                    session.transition(ExecutionState.RUNNING)
                    outcome = sandbox.execute(name, limits)
                else:
                    session.transition(ExecutionState.COMPILING)
                    outcome, diagnostics = _native_outcome(
                        session, sandbox.execute(name, limits, compiler_frame=True)
                    )
            finally:
                sandbox.remove(name)
    except SandboxError as error:
        outcome = SandboxOutcome(ExecutionState.INTERNAL_ERROR, error=str(error))
    except OSError:
        outcome = SandboxOutcome(
            ExecutionState.INTERNAL_ERROR,
            error="The worker could not prepare, run, or clean up the local job.",
        )

    session.transition(outcome.state)
    return ExecutionResult(job_id, session.history, outcome, diagnostics)


def _native_outcome(session, outcome):
    output = outcome.stdout
    interrupted = outcome.state in (
        ExecutionState.TIMEOUT,
        ExecutionState.RESOURCE_LIMIT_EXCEEDED,
    )
    if len(output) < COMPILER_FRAME.size:
        if interrupted:
            return replace(outcome, stdout=b"", stderr=b""), b""
        raise SandboxError("The native launcher did not return a compiler record.")

    phase, length = compiler_header(output)
    end = COMPILER_FRAME.size + length
    if len(output) < end:
        if interrupted:
            return replace(outcome, stdout=b"", stderr=b""), output[COMPILER_FRAME.size:]
        raise SandboxError("The native launcher returned incomplete compiler diagnostics.")

    diagnostics = output[COMPILER_FRAME.size:end]
    if phase == 0:
        session.transition(ExecutionState.RUNNING)
        return replace(outcome, stdout=output[end:]), diagnostics

    if not interrupted:
        if outcome.state is not ExecutionState.RUNTIME_FAILED or outcome.exit_code != 1:
            raise SandboxError("The native launcher did not confirm compilation failure.")
        state = (
            ExecutionState.COMPILATION_FAILED if phase == 1
            else ExecutionState.RESOURCE_LIMIT_EXCEEDED
        )
        outcome = replace(outcome, state=state)
    return replace(outcome, stdout=b"", stderr=b"", exit_code=None), diagnostics
