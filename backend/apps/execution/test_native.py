import os
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import patch

from .native import NativeLanguage, run_native
from .sandbox import SandboxLimits, Toolchain
from .states import ExecutionState
from .worker import MAX_STDIN_BYTES, WORKSPACE_PREFIX
from .workspace import InvalidWorkspace, SourceFile


class NativeValidationTests(TestCase):
    def test_invalid_inputs_never_reach_the_worker(self):
        with patch("apps.execution.worker._run_job") as worker:
            for files in (
                [SourceFile("../main.c", "")],
                [SourceFile("main.cpp", "")],
                [SourceFile("decl.h", "")],
                [SourceFile("one.c", ""), SourceFile("two.py", "")],
            ):
                with self.subTest(files=files), self.assertRaises(InvalidWorkspace):
                    run_native(NativeLanguage.C, files)
            for stdin in (b"x" * (MAX_STDIN_BYTES + 1), "text"):
                with self.assertRaises(ValueError):
                    run_native(NativeLanguage.C, [SourceFile("main.c", "")], stdin=stdin)
            worker.assert_not_called()

    def test_arguments_are_fixed_and_paths_are_absolute_inside_workspace(self):
        with patch("apps.execution.worker._run_job") as worker:
            run_native(
                NativeLanguage.CPP,
                [
                    SourceFile("lib/util.cc", ""),
                    SourceFile("include/util.hpp", ""),
                    SourceFile("app/main.cpp", ""),
                ],
                stdin=b"hello",
            )

        _, toolchain, command, _ = worker.call_args.args
        self.assertEqual(toolchain, Toolchain.C_CPP)
        self.assertEqual(
            command[5:],
            (
                "g++", "-std=c++17", "-fdiagnostics-color=never", "-I", "/workspace",
                "-o", "/tmp/arclis-program", "/workspace/app/main.cpp", "/workspace/lib/util.cc",
                "/tmp/arclis-program",
            ),
        )
        self.assertEqual(worker.call_args.kwargs, {"native_stdin": b"hello"})


@skipUnless(os.environ.get("ARCLIS_TEST_WORKER") == "1", "Requires rootless Docker and images")
class NativeExecutionTests(TestCase):
    def assert_finished(self, result, state, *, ran=True):
        self.assertEqual(result.outcome.state, state, result.outcome)
        phases = [
            ExecutionState.CREATED, ExecutionState.PREPARING, ExecutionState.COMPILING,
        ]
        if ran:
            phases.append(ExecutionState.RUNNING)
        self.assertEqual(result.history, (*phases, state))
        self.assertEqual(list(Path("/tmp").glob(f"{WORKSPACE_PREFIX}{result.job_id}-*")), [])

    def test_c_and_cpp_hello_world(self):
        for language, path, code in (
            (NativeLanguage.C, "main.c", '#include <stdio.h>\nint main(void) { puts("hello C"); }'),
            (
                NativeLanguage.CPP,
                "main.cpp",
                '#include <iostream>\nint main() { std::cout << "hello C++\\n"; }',
            ),
        ):
            with self.subTest(language=language):
                result = run_native(language, [SourceFile(path, code)])
                self.assert_finished(result, ExecutionState.COMPLETED)
                expected = b"hello C\n" if language is NativeLanguage.C else b"hello C++\n"
                self.assertEqual(result.outcome.stdout, expected)
                self.assertEqual(result.outcome.stderr, b"")
                self.assertEqual(result.outcome.exit_code, 0)
                self.assertEqual(result.compiler_diagnostics, b"")

    def test_c_and_cpp_compile_multiple_sources_with_headers(self):
        for language, main, helper, header in (
            (NativeLanguage.C, "main.c", "lib/value.c", "include/value.h"),
            (NativeLanguage.CPP, "main.cpp", "lib/value.cc", "include/value.hpp"),
        ):
            with self.subTest(language=language):
                result = run_native(
                    language,
                    [
                        SourceFile(main, f'#include "{header}"\nint main(void) {{ return value() != 42; }}'),
                        SourceFile(helper, f'#include "{header}"\nint value(void) {{ return 42; }}'),
                        SourceFile(header, "int value(void);"),
                    ],
                )
                self.assert_finished(result, ExecutionState.COMPLETED)
                self.assertEqual(result.outcome.exit_code, 0)

    def test_binary_stdin_round_trip(self):
        code = """
#include <stdio.h>
int main(void) {
    unsigned char buffer[4096];
    size_t count;
    while ((count = fread(buffer, 1, sizeof(buffer), stdin)) != 0)
        if (fwrite(buffer, 1, count, stdout) != count) return 1;
    return ferror(stdin) != 0;
}
"""
        payload = bytes(range(256)) * (MAX_STDIN_BYTES // 256)
        result = run_native(NativeLanguage.C, [SourceFile("main.c", code)], stdin=payload)

        self.assert_finished(result, ExecutionState.COMPLETED)
        self.assertEqual(result.outcome.stdout, payload)

    def test_compiler_failure_keeps_diagnostics_out_of_program_streams(self):
        for language, path in ((NativeLanguage.C, "main.c"), (NativeLanguage.CPP, "main.cpp")):
            with self.subTest(language=language):
                result = run_native(language, [SourceFile(path, "int main( {")])
                self.assert_finished(result, ExecutionState.COMPILATION_FAILED, ran=False)
                self.assertIn(b"error:", result.compiler_diagnostics)
                self.assertIn(path.encode(), result.compiler_diagnostics)
                self.assertEqual(result.outcome.stdout, b"")
                self.assertEqual(result.outcome.stderr, b"")
                self.assertIsNone(result.outcome.exit_code)

    def test_runtime_exit_code_and_streams_cannot_be_confused_with_compilation(self):
        code = """
#include <stdio.h>
#warning compile-note
int main(void) {
    fwrite("ARC1", 1, 4, stdout);
    fputs("run-error", stderr);
    return 1;
}
"""
        result = run_native(NativeLanguage.C, [SourceFile("main.c", code)])

        self.assert_finished(result, ExecutionState.RUNTIME_FAILED)
        self.assertEqual(result.outcome.exit_code, 1)
        self.assertEqual(result.outcome.stdout, b"ARC1")
        self.assertEqual(result.outcome.stderr, b"run-error")
        self.assertIn(b"compile-note", result.compiler_diagnostics)

    def test_compiler_output_cannot_exceed_budget(self):
        result = run_native(
            NativeLanguage.C,
            [SourceFile("main.c", "#error deliberately long diagnostic for the test")],
            limits=SandboxLimits(output_bytes=24),
        )

        self.assert_finished(result, ExecutionState.RESOURCE_LIMIT_EXCEEDED, ran=False)
        self.assertEqual(len(result.compiler_diagnostics), 24)
        self.assertEqual(result.outcome.stdout + result.outcome.stderr, b"")

    def test_diagnostics_and_runtime_streams_share_one_output_budget(self):
        code = """
#include <stdio.h>
#warning compile-note
int main(void) {
    for (int i = 0; i < 2048; ++i) {
        fputc('o', stdout);
        fputc('e', stderr);
    }
    return 0;
}
"""
        result = run_native(
            NativeLanguage.C, [SourceFile("main.c", code)], limits=SandboxLimits(output_bytes=512)
        )

        self.assert_finished(result, ExecutionState.RESOURCE_LIMIT_EXCEEDED)
        self.assertIn(b"compile-note", result.compiler_diagnostics)
        self.assertEqual(
            len(result.compiler_diagnostics + result.outcome.stdout + result.outcome.stderr), 512
        )

    def test_long_running_program_times_out(self):
        code = '#include <stdio.h>\nint main(void) { puts("started"); fflush(stdout); for (;;) {} }'
        result = run_native(
            NativeLanguage.C, [SourceFile("main.c", code)], limits=SandboxLimits(timeout_seconds=4)
        )

        self.assert_finished(result, ExecutionState.TIMEOUT)
        self.assertEqual(result.outcome.stdout, b"started\n")
