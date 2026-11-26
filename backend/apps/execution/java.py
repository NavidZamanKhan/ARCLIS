import re
from collections.abc import Sequence
from pathlib import PurePosixPath

from .sandbox import SandboxLimits, Toolchain
from .worker import CompiledJob, ExecutionResult
from .workspace import InvalidWorkspace, SourceFile, validate_workspace

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
MIN_JAVA_MEMORY_MIB = 192


def run_java(
    main_class: str,
    files: Sequence[SourceFile],
    *,
    stdin: bytes = b"",
    limits: SandboxLimits = SandboxLimits(memory_mib=384),
) -> ExecutionResult:
    """Execute a Java program using its conventional package and class path."""
    return prepare_java(main_class, files, limits=limits).run(stdin=stdin)


def prepare_java(main_class, files, *, limits=SandboxLimits(memory_mib=384), entry_file=None):
    if not isinstance(main_class, str) or not all(
        _IDENTIFIER.fullmatch(part) for part in main_class.split(".")
    ):
        raise InvalidWorkspace("Supply a Java main class with optional package qualifiers.")
    if not isinstance(limits, SandboxLimits) or limits.memory_mib < MIN_JAVA_MEMORY_MIB:
        raise ValueError(f"Java requires validated limits with at least {MIN_JAVA_MEMORY_MIB} MiB.")

    workspace = validate_workspace(files)
    main_path = PurePosixPath(*main_class.split(".")).with_suffix(".java")
    if entry_file is not None and entry_file != str(main_path):
        raise InvalidWorkspace("The entry file must match the Java main class.")
    if main_path not in workspace:
        raise InvalidWorkspace("The main class must match a submitted Java source path.")
    for path in workspace:
        if path.suffix != ".java" or not all(
            _IDENTIFIER.fullmatch(part) for part in (*path.parts[:-1], path.stem)
        ):
            raise InvalidWorkspace("Use .java files with conventional package and class paths.")

    vm_args = (
        "-Xms16m", f"-Xmx{limits.memory_mib // 3}m",
        "-XX:+UseSerialGC", "-XX:ActiveProcessorCount=1", "-Djava.io.tmpdir=/tmp",
    )
    compiler = (
        "javac", *(f"-J{arg}" for arg in vm_args), "-proc:none", "-encoding", "UTF-8",
        "-d", "/tmp", "-classpath", "/tmp", "-sourcepath", "/workspace",
        *(f"/workspace/{path}" for path in sorted(workspace)),
    )
    program = ("java", *vm_args, "-cp", "/tmp", main_class)
    return CompiledJob(workspace, Toolchain.JAVA, compiler, program, limits)
