from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from .sandbox import DockerSandbox, SandboxError, SandboxLimits, SandboxOutcome, Toolchain
from .states import ExecutionSession, ExecutionState
from .workspace import SourceFile, materialize_workspace, validate_workspace

WORKSPACE_PREFIX = "arclis-worker-"


@dataclass(frozen=True)
class ExecutionResult:
    job_id: str
    history: tuple[ExecutionState, ...]
    outcome: SandboxOutcome


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
    validated = validate_workspace(files)
    job_id = uuid4().hex
    name = f"arclis-job-{job_id}"
    session = ExecutionSession()
    session.transition(ExecutionState.PREPARING)

    try:
        with TemporaryDirectory(prefix=f"{WORKSPACE_PREFIX}{job_id}-", dir="/tmp") as temporary:
            root = Path(temporary)
            workspace = root / "input"
            materialize_workspace(workspace, validated)
            sandbox = DockerSandbox(root / "docker")
            sandbox.verify()
            try:
                sandbox.create(name, workspace, toolchain, argv, limits)
                session.transition(ExecutionState.RUNNING)
                outcome = sandbox.execute(name, limits)
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
    return ExecutionResult(job_id, session.history, outcome)
