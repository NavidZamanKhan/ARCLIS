import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

MAX_FILES = 50
MAX_SOURCE_BYTES = 1024 * 1024
_SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")
_EXTENSIONS = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".java", ".py"}


class InvalidWorkspace(ValueError):
    """The submitted file set cannot safely be staged."""


@dataclass(frozen=True)
class SourceFile:
    path: str
    content: str


def validate_workspace(files: Sequence[SourceFile]) -> dict[PurePosixPath, bytes]:
    if not 1 <= len(files) <= MAX_FILES:
        raise InvalidWorkspace(f"Supply between 1 and {MAX_FILES} source files.")

    staged = {}
    total_bytes = 0
    for source in files:
        raw_path = source.path
        if not isinstance(raw_path, str) or len(raw_path) > 240 or any(
            not _SEGMENT.fullmatch(part) or part.endswith(".")
            for part in raw_path.split("/")
        ):
            raise InvalidWorkspace("Source paths must use safe relative POSIX segments.")

        path = PurePosixPath(raw_path)
        if path.suffix.lower() not in _EXTENSIONS or path in staged:
            raise InvalidWorkspace("Source extensions must be supported and paths unique.")

        if not isinstance(source.content, str):
            raise InvalidWorkspace("Source content must be text.")
        if len(source.content) > MAX_SOURCE_BYTES - total_bytes:
            raise InvalidWorkspace("The workspace exceeds the source size limit.")
        try:
            content = source.content.encode("utf-8")
        except UnicodeEncodeError as error:
            raise InvalidWorkspace("Source content must be valid UTF-8.") from error
        total_bytes += len(content)
        if total_bytes > MAX_SOURCE_BYTES:
            raise InvalidWorkspace("The workspace exceeds the source size limit.")
        staged[path] = content

    if any(parent in staged for path in staged for parent in path.parents):
        raise InvalidWorkspace("A source file cannot also be a directory.")
    return staged


def materialize_workspace(root: Path, files: dict[PurePosixPath, bytes]):
    """Write validated files into a new input tree inside a private parent."""
    root.mkdir()
    root.chmod(0o755)
    for path, content in files.items():
        for parent in reversed(path.parents):
            directory = root.joinpath(*parent.parts)
            directory.mkdir(exist_ok=True)
            directory.chmod(0o755)
        destination = root.joinpath(*path.parts)
        with destination.open("xb") as handle:
            handle.write(content)
        destination.chmod(0o644)
