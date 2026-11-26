from collections.abc import Sequence
from enum import StrEnum

from .sandbox import SandboxLimits, Toolchain
from .worker import CompiledJob, ExecutionResult
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
    return prepare_native(language, files, limits=limits).run(stdin=stdin)


def prepare_native(language, files, *, limits=SandboxLimits(), entry_file=None):
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
    if entry_file is not None and f"/workspace/{entry_file}" not in sources:
        raise InvalidWorkspace("The entry file must match a submitted translation unit.")

    command = (
        compiler, standard, "-fdiagnostics-color=never", "-I", "/workspace",
        "-o", "/tmp/arclis-program", *sorted(sources),
    )
    return CompiledJob(workspace, Toolchain.C_CPP, command, ("/tmp/arclis-program",), limits)
