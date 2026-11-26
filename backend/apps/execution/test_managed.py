import os
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import patch

from .java import MIN_JAVA_MEMORY_MIB, run_java
from .sandbox import SandboxLimits
from .states import ExecutionState
from .worker import MAX_STDIN_BYTES, WORKSPACE_PREFIX
from .workspace import InvalidWorkspace, SourceFile


class ManagedValidationTests(TestCase):
    def test_invalid_java_layout_or_arguments_never_launch(self):
        main = SourceFile("Main.java", "")
        with patch("apps.execution.worker._run_job") as worker:
            for name, files in (
                ("-version", [main]),
                ("pkg..Main", [main]),
                ("pkg.Main", [main]),
                ("Main", [main, SourceFile("bad-name.java", "")]),
                ("Main", [main, SourceFile("extra.py", "")]),
            ):
                with self.subTest(name=name, files=files), self.assertRaises(InvalidWorkspace):
                    run_java(name, files)
            with self.assertRaises(ValueError):
                run_java("Main", [main], limits=SandboxLimits(memory_mib=MIN_JAVA_MEMORY_MIB - 1))
            with self.assertRaises(ValueError):
                run_java("Main", [main], stdin=b"x" * (MAX_STDIN_BYTES + 1))
            worker.assert_not_called()


@skipUnless(os.environ.get("ARCLIS_TEST_WORKER") == "1", "Requires rootless Docker and images")
class ManagedExecutionTests(TestCase):
    def assert_finished(self, result, state, *, ran=True):
        self.assertEqual(result.outcome.state, state, result.outcome)
        phases = [ExecutionState.CREATED, ExecutionState.PREPARING, ExecutionState.COMPILING]
        if ran:
            phases.append(ExecutionState.RUNNING)
        self.assertEqual(result.history, (*phases, state))
        self.assertEqual(list(Path("/tmp").glob(f"{WORKSPACE_PREFIX}{result.job_id}-*")), [])

    def test_java_hello_world_and_memory_budget(self):
        code = """
import java.nio.file.Files;
import java.nio.file.Path;
class Main {
    public static void main(String[] args) throws Exception {
        long memory = Long.parseLong(Files.readString(Path.of("/sys/fs/cgroup/memory.max")).trim());
        if (memory != 192L * 1024 * 1024 || Runtime.getRuntime().maxMemory() > 64L * 1024 * 1024)
            System.exit(3);
        System.out.println("hello Java");
    }
}
"""
        result = run_java(
            "Main", [SourceFile("Main.java", code)],
            limits=SandboxLimits(memory_mib=MIN_JAVA_MEMORY_MIB),
        )
        self.assert_finished(result, ExecutionState.COMPLETED)
        self.assertEqual(result.outcome.stdout, b"hello Java\n")
        self.assertEqual(result.outcome.exit_code, 0)

    def test_java_package_multiple_sources_and_stdin(self):
        result = run_java(
            "lab.Main",
            [
                SourceFile(
                    "lab/Main.java",
                    """
package lab;
class Main {
    public static void main(String[] args) throws Exception {
        System.out.print(Helper.prefix());
        System.in.transferTo(System.out);
    }
}
""",
                ),
                SourceFile(
                    "lab/Helper.java",
                    'package lab; class Helper { static String prefix() { return "input:"; } }',
                ),
            ],
            stdin=b"replayed\x00\n",
        )
        self.assert_finished(result, ExecutionState.COMPLETED)
        self.assertEqual(result.outcome.stdout, b"input:replayed\x00\n")

    def test_java_compile_failure_is_distinct_from_runtime_failure(self):
        invalid = run_java("Main", [SourceFile("Main.java", "class Main { void broken( }")])
        self.assert_finished(invalid, ExecutionState.COMPILATION_FAILED, ran=False)
        self.assertIn(b"error:", invalid.compiler_diagnostics)
        self.assertEqual(invalid.outcome.stderr, b"")
        self.assertIsNone(invalid.outcome.exit_code)

        failed = run_java(
            "Main",
            [
                SourceFile(
                    "Main.java",
                    """
class Main {
    public static void main(String[] args) { throw new IllegalStateException("fixture"); }
}
""",
                ),
            ],
        )
        self.assert_finished(failed, ExecutionState.RUNTIME_FAILED)
        self.assertEqual(failed.compiler_diagnostics, b"")
        self.assertIn(b"IllegalStateException: fixture", failed.outcome.stderr)
        self.assertEqual(failed.outcome.exit_code, 1)
