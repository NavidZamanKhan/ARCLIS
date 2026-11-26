from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from .states import ExecutionSession, ExecutionState
from .workspace import (
    MAX_SOURCE_BYTES,
    InvalidWorkspace,
    SourceFile,
    materialize_workspace,
    validate_workspace,
)


class SessionTests(TestCase):
    def test_history_can_only_reach_one_terminal_state(self):
        session = ExecutionSession()
        for state in (
            ExecutionState.PREPARING,
            ExecutionState.RUNNING,
            ExecutionState.COMPLETED,
        ):
            session.transition(state)

        self.assertEqual(session.history[0], ExecutionState.CREATED)
        self.assertEqual(session.history[-1], ExecutionState.COMPLETED)
        for state in (ExecutionState.COMPLETED, ExecutionState.TIMEOUT):
            with self.assertRaises(ValueError):
                session.transition(state)

    def test_invalid_phase_jump_is_rejected(self):
        with self.assertRaises(ValueError):
            ExecutionSession().transition(ExecutionState.RUNNING)


class WorkspaceTests(TestCase):
    def test_writes_only_the_new_input_tree(self):
        files = validate_workspace([SourceFile("package/Main.java", "é")])
        with TemporaryDirectory() as directory:
            root = Path(directory) / "input"
            materialize_workspace(root, files)
            self.assertEqual((root / "package/Main.java").read_bytes(), b"\xc3\xa9")
            self.assertEqual((root / "package").stat().st_mode & 0o777, 0o755)

    def test_rejects_unsafe_or_noncanonical_paths(self):
        for name in (
            "/main.c", "../main.c", "src/../main.c", "src//main.c",
            "./main.c", "src\\main.c", "C:/main.c", "bad\x00.c", ".env",
            "notes.txt", "src./main.c",
        ):
            with self.subTest(name=name), self.assertRaises(InvalidWorkspace):
                validate_workspace([SourceFile(name, "")])

    def test_rejects_duplicates_and_file_directory_collisions(self):
        for paths in (("main.c", "main.c"), ("main.c/x.h", "main.c")):
            with self.subTest(paths=paths), self.assertRaises(InvalidWorkspace):
                validate_workspace([SourceFile(path, "") for path in paths])

    def test_limits_count_and_counts_utf8_bytes(self):
        for files in (
            [],
            [SourceFile(f"file{i}.c", "") for i in range(51)],
            [SourceFile("main.c", "é" * (MAX_SOURCE_BYTES // 2 + 1))],
        ):
            with self.assertRaises(InvalidWorkspace):
                validate_workspace(files)
