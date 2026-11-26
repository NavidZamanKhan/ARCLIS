from collections.abc import Sequence
from enum import StrEnum

from .sandbox import SandboxLimits, Toolchain
from .worker import ExecutionResult, _run_job
from .workspace import InvalidWorkspace, SourceFile, validate_workspace

MAX_STDIN_BYTES = 64 * 1024
_COMPILERS = {
    "c": ("gcc", "-std=c17", frozenset({".c"}), frozenset({".h"})),
    "cpp": (
        "g++", "-std=c++17", frozenset({".cc", ".cpp", ".cxx"}),
        frozenset({".h", ".hh", ".hpp", ".hxx"}),
    ),
}


class NativeLanguage(StrEnum):
    C = "c"
    CPP = "cpp"


def run_native(
    language: NativeLanguage,
    files: Sequence[SourceFile],
    *,
    stdin: bytes = b"",
    limits: SandboxLimits = SandboxLimits(),
) -> ExecutionResult:
    """Compile and run one validated C or C++ program within the local worker."""
    if not isinstance(language, NativeLanguage) or not isinstance(limits, SandboxLimits):
        raise ValueError("Supply a C or C++ language and validated worker limits.")
    if not isinstance(stdin, bytes) or len(stdin) > MAX_STDIN_BYTES:
        raise ValueError("Standard input must be bytes and at most 64 KiB.")

    workspace = validate_workspace(files)
    compiler, standard, source_extensions, header_extensions = _COMPILERS[language]
    sources = []
    for path in workspace:
        if path.suffix in source_extensions:
            sources.append(f"/workspace/{path}")
        elif path.suffix not in header_extensions:
            raise InvalidWorkspace("All files must be sources or headers for the chosen language.")
    if not sources:
        raise InvalidWorkspace("Supply at least one translation unit for the chosen language.")

    command = (
        "python3", "-I", "/opt/arclis/native_job.py", str(limits.output_bytes),
        compiler, standard, "-fdiagnostics-color=never", "-I", "/workspace",
        "-o", "/tmp/arclis-program", *sorted(sources),
    )
    return _run_job(workspace, Toolchain.C_CPP, command, limits, native_stdin=stdin)
