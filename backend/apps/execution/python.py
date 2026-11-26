from collections.abc import Sequence

from .sandbox import SandboxLimits, Toolchain
from .worker import ExecutionResult, run_compiled_job
from .workspace import InvalidWorkspace, SourceFile, validate_workspace

_SYNTAX_CHECK = """
from pathlib import Path
from sys import argv

for name in argv[1:]:
    compile(Path(name).read_bytes(), name, "exec")
"""


def run_python(
    entry_file: str,
    files: Sequence[SourceFile],
    *,
    stdin: bytes = b"",
    limits: SandboxLimits = SandboxLimits(),
) -> ExecutionResult:
    """Syntax-check submitted Python files, then execute the selected script."""
    workspace = validate_workspace(files)
    if any(path.suffix != ".py" for path in workspace):
        raise InvalidWorkspace("Submit only .py files for the Python adapter.")
    names = sorted(str(path) for path in workspace)
    if not isinstance(entry_file, str) or entry_file not in names:
        raise InvalidWorkspace("The Python entry file must match a submitted .py path.")

    compiler = (
        "python3", "-I", "-S", "-B", "-c", _SYNTAX_CHECK,
        *(f"/workspace/{name}" for name in names),
    )
    program = (
        "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "PYTHONPATH=/workspace",
        "/usr/bin/python3", "-S", "-B", f"/workspace/{entry_file}",
    )
    return run_compiled_job(
        workspace, Toolchain.PYTHON, compiler, program, stdin=stdin, limits=limits,
    )
