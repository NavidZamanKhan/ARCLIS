from collections.abc import Sequence
from enum import StrEnum

from .sandbox import SandboxLimits, Toolchain
from .worker import ExecutionResult, run_compiled_job
from .workspace import InvalidWorkspace, SourceFile, validate_workspace

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
    if not isinstance(language, NativeLanguage):
        raise ValueError("Supply a C or C++ language.")

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
        compiler, standard, "-fdiagnostics-color=never", "-I", "/workspace",
        "-o", "/tmp/arclis-program", *sorted(sources),
    )
    return run_compiled_job(
        workspace, Toolchain.C_CPP, command, ("/tmp/arclis-program",), stdin=stdin, limits=limits,
    )
