import os
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from django.urls import reverse

from apps.execution.native import NativeLanguage, prepare_native
from apps.execution.sandbox import SandboxOutcome, Toolchain
from apps.execution.states import ExecutionState
from apps.execution.workspace import SourceFile

from .api import AnalysisJSONParser, _slot
from .service import COMMAND, LIMITS, PYTHON_COMMAND, AnalysisLimit


class AnalysisRequests(SimpleTestCase):
    def post(self, source, *, language=None, **headers):
        payload = {"source": source}
        if language is not None:
            payload["language"] = language
        return self.client.post(reverse("analyze_source"), payload, content_type="application/json", **headers)


@override_settings(LOCAL_ANALYSIS_ENABLED=True, LOCAL_EXECUTION_ENABLED=False,
                   FRONTEND_ORIGINS=["http://127.0.0.1:5173"])
class AnalysisApiTests(AnalysisRequests):
    def test_capability_and_access_use_loopback_and_analysis_opt_in(self):
        flags = self.client.get(reverse("capabilities")).json()
        self.assertEqual(flags["analysis"], {"available": True, "languages": ["c", "python"]})
        self.assertFalse(flags["execution"]["available"])
        self.assertFalse(self.client.get(reverse("capabilities"), REMOTE_ADDR="192.0.2.1").json()["analysis"]["available"])
        with patch("apps.analysis.api.analyze_c") as analyze:
            self.assertEqual(self.post("", REMOTE_ADDR="192.0.2.1", HTTP_X_FORWARDED_FOR="127.0.0.1").status_code, 404)
            with self.settings(LOCAL_ANALYSIS_ENABLED=False):
                self.assertEqual(self.post("").status_code, 404)
            self.assertEqual(self.post("", HTTP_ORIGIN="https://example.org").status_code, 403)
            analyze.assert_not_called()

    def test_validates_source_type_byte_limit_and_json_limit(self):
        with patch("apps.analysis.api.analyze_c") as analyze:
            for source in (23, "😀" * 16385, "\ud800"):
                with self.subTest(source_type=type(source)):
                    response = self.post(source)
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.json()["error"]["code"], "validation_error")
            with patch.object(AnalysisJSONParser, "max_bytes", 16):
                self.assertEqual(self.post("int source;").status_code, 413)
            analyze.assert_not_called()

    def test_preserves_exact_snapshot_and_disables_response_caching(self):
        source = "\ufeff// 😀\r\nint x;\r\n"
        with patch("apps.analysis.api.analyze_c", return_value={"syntax_valid": True}) as analyze:
            response = self.post(source, HTTP_ORIGIN="http://127.0.0.1:5173", REMOTE_ADDR="::1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        analyze.assert_called_once_with(content=source, source_size=len(source.encode("utf-8")))

    def test_routes_python_and_rejects_unsupported_languages(self):
        with patch("apps.analysis.api.analyze_python", return_value={}) as python, patch("apps.analysis.api.analyze_c") as c:
            for language in ("cpp", "java"):
                response = self.post("", language=language)
                self.assertEqual(response.status_code, 400)
                self.assertIn("language", response.json()["error"]["details"])
            self.assertEqual(self.post("x = 1", language="python").status_code, 200)
            python.assert_called_once_with(content="x = 1", source_size=5)
            c.assert_not_called()

    def test_python_rejects_invalid_worker_reports(self):
        result = SimpleNamespace(outcome=SandboxOutcome(ExecutionState.COMPLETED, b'{"partial":true}', exit_code=0))
        with patch("apps.analysis.service.run_job", return_value=result) as worker:
            response = self.post("x = 1", language="python")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b"partial", response.content)
        worker.assert_called_once_with([SourceFile("input.py", "x = 1")], Toolchain.PYTHON_ANALYZER, PYTHON_COMMAND, LIMITS)

    def test_bounded_capacity_and_resource_error_release_the_slot(self):
        self.assertTrue(_slot.acquire(blocking=False))
        try:
            self.assertEqual(self.post("").status_code, 429)
        finally:
            _slot.release()
        with patch("apps.analysis.api.analyze_c", side_effect=[AnalysisLimit("Bounded failure."), {}]):
            failure = self.post("")
            self.assertEqual(failure.status_code, 422)
            self.assertEqual(failure.json()["error"]["code"], "analysis_limit")
            self.assertEqual(self.post("").status_code, 200)

    def test_worker_failures_do_not_return_partial_or_internal_output(self):
        source = "int main(void) { return 0; }"
        cases = (
            (ExecutionState.INTERNAL_ERROR, b"", b"private path", None, 503),
            (ExecutionState.COMPLETED, b'{"kind":"private marker"}', b"", 0, 503),
            (ExecutionState.RESOURCE_LIMIT_EXCEEDED, b"partial result", b"", None, 422),
            (ExecutionState.TIMEOUT, b"partial result", b"", None, 422),
        )
        for state, stdout, stderr, code, http_status in cases:
            with self.subTest(state=state):
                result = SimpleNamespace(outcome=SandboxOutcome(state, stdout, stderr, code))
                with patch("apps.analysis.service.run_job", return_value=result) as worker:
                    response = self.post(source)
                self.assertEqual(response.status_code, http_status)
                for private in (b"private path", b"private marker", b"partial result"):
                    self.assertNotIn(private, response.content)
                worker.assert_called_once_with([SourceFile("input.c", source)], Toolchain.C_ANALYZER, COMMAND, LIMITS)


@skipUnless(os.environ.get("ARCLIS_TEST_WORKER") == "1", "requires local rootless Docker images")
@override_settings(LOCAL_ANALYSIS_ENABLED=True)
class DockerAnalysisTests(AnalysisRequests):
    def test_real_worker_returns_all_artifacts_and_uses_utf8_ranges(self):
        source = '\ufeff// leading\r\nint main(void) { "😀\u2028"; return 1+2*3; }\r\n'
        response = self.post(source)
        self.assertEqual(response.status_code, 200, response.content)
        report = response.json()
        self.assertTrue(report["syntax_valid"] and report["semantic_valid"])
        self.assertEqual(report["diagnostics"], [])
        quoted = next(token for token in report["tokens"] if token["kind"] == "string")
        self.assertEqual(quoted["lexeme"], '"😀\u2028"')
        self.assertEqual(quoted["range"]["start"]["offset"], source.encode().index(b'"'))
        self.assertEqual(report["tokens"][-1]["range"]["end"]["offset"], len(source.encode()))
        self.assertEqual(report["ast"]["kind"], "Program")
        self.assertEqual(report["symbols"][0]["name"], "main")
        self.assertEqual(report["scopes"][0]["kind"], "file")
        self.assertEqual([item["operator"] for item in report["ir"]["instructions"] if item["op"] == "binary"], ["*", "+"])

    def test_real_worker_returns_partial_reports_for_source_errors(self):
        for source, phase, syntax in (
            ("int f(void) { return @; }", "lexical", False),
            ("int f(void) { return 1+; }", "syntax", False),
            ("int f(void) { return missing; }", "semantic", True),
        ):
            with self.subTest(phase=phase):
                response = self.post(source)
                self.assertEqual(response.status_code, 200, response.content)
                report = response.json()
                self.assertEqual(report["syntax_valid"], syntax)
                self.assertEqual(report["semantic_valid"], False if syntax else None)
                self.assertEqual(report["ast"] is not None, syntax)
                self.assertIsNone(report["ir"])
                self.assertTrue(report["tokens"])
                self.assertEqual([item["phase"] for item in report["diagnostics"]], [phase])

    def test_ast_resource_errors_are_reported_as_request_limits(self):
        source = "void f(void) {" + "{" * 130 + "}" * 131
        response = self.post(source)
        self.assertEqual(response.status_code, 422, response.content)
        self.assertEqual(response.json()["error"]["code"], "analysis_limit")

    def test_analysis_does_not_run_source_and_native_execution_supports_pointers(self):
        response = self.post("int main(void) { for (;;) ; }")
        self.assertTrue(response.json()["semantic_valid"])

        source = "int main(void) { int value=4; int *pointer=&value; return *pointer-4; }"
        report = self.post(source).json()
        self.assertFalse(report["syntax_valid"])
        self.assertIn("unsupported-syntax", [error["code"] for error in report["diagnostics"]])
        job = prepare_native(NativeLanguage.C, [SourceFile("main.c", source)], entry_file="main.c")
        result = job.run()
        self.assertEqual(result.outcome.state, ExecutionState.COMPLETED, result)
        self.assertEqual(result.outcome.exit_code, 0)


@skipUnless(os.environ.get("ARCLIS_TEST_WORKER") == "1", "requires local rootless Docker images")
@override_settings(LOCAL_ANALYSIS_ENABLED=True)
class DockerPythonAnalysisTests(AnalysisRequests):
    def report(self, source):
        response = self.post(source, language="python")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_stdlib_tokens_ast_symbols_and_original_utf8_ranges(self):
        source = (
            '\ufeff# leading\r\nfrom example import item as alias\r\n'
            'def outer(value):\r\n    π = "😀"; result = value + 1\r\n'
            '    def inner():\r\n        return f"{result}"\r\n    return inner'
        )
        report = self.report(source)
        self.assertTrue(report["syntax_valid"] and report["semantic_valid"])
        self.assertEqual(report["diagnostics"], [])
        self.assertIsNone(report["ir"])
        raw = source.encode()
        quoted = next(token for token in report["tokens"] if token["kind"] == "string")
        self.assertEqual(quoted["lexeme"], '"😀"')
        self.assertEqual(quoted["range"]["start"]["offset"], raw.index(b'"'))
        self.assertEqual(report["tokens"][0]["range"]["start"]["offset"], 3)
        self.assertTrue(any(token["kind"] == "fstring_start" for token in report["tokens"]))
        self.assertTrue(any(token["exact_kind"] == "lpar" for token in report["tokens"]))
        self.assertTrue(any(token["lexeme"] == "\r\n" for token in report["tokens"]))
        self.assertEqual(report["tokens"][-1]["range"]["end"]["offset"], len(raw))
        root = report["ast"]
        self.assertEqual(root["kind"], "Module")
        function = root["fields"]["body"][1]
        assignment = function["fields"]["body"][1]
        operation = assignment["fields"]["value"]
        self.assertEqual(operation["fields"]["op"], {"kind": "Add", "fields": {}})
        self.assertEqual(assignment["range"]["start"]["offset"], raw.index(b"result"))
        scopes = {entry["name"]: entry for entry in report["scopes"]}
        self.assertEqual(scopes["inner"]["parent"], scopes["outer"]["id"])
        names = {(entry["name"], entry["scope"]): entry for entry in report["symbols"]}
        self.assertIn("imported", names[("alias", 1)]["flags"])
        self.assertIn("parameter", names[("value", scopes["outer"]["id"])]["flags"])
        self.assertIn("free", names[("result", scopes["inner"]["id"])]["flags"])

    def test_partial_tokens_and_unicode_scope_diagnostics(self):
        syntax = self.report("first = 1\r\ndef broken(:\r\n    pass\r\n")
        self.assertFalse(syntax["syntax_valid"])
        self.assertTrue(any(token["lexeme"] == "first" for token in syntax["tokens"]))
        self.assertIsNone(syntax["ast"])
        self.assertEqual(syntax["diagnostics"][0]["code"], "python-syntax-error")
        self.assertEqual(syntax["diagnostics"][0]["range"]["start"]["line"], 2)

        source = '"😀"; nonlocal name'
        semantic = self.report(source)
        self.assertTrue(semantic["syntax_valid"])
        self.assertFalse(semantic["semantic_valid"])
        self.assertIsNotNone(semantic["ast"])
        self.assertIsNone(semantic["ir"])
        error = semantic["diagnostics"][0]
        self.assertEqual(error["code"], "python-semantic-error")
        self.assertEqual(error["range"]["start"]["offset"], source.encode().index(b"nonlocal"))
        self.assertIn("outside function", self.report("return 1")["diagnostics"][0]["message"])

    def test_analysis_never_runs_imports_or_module_code(self):
        report = self.report('import unavailable_arclis_fixture\nlarge = 9007199254740993\nraise RuntimeError("analysis should succeed")\n')
        self.assertTrue(report["semantic_valid"])
        self.assertEqual(report["diagnostics"], [])
        value = report["ast"]["fields"]["body"][1]["fields"]["value"]
        self.assertEqual(value["fields"]["value"], "9007199254740993")
        self.assertTrue(self.report('x = "\\q"')["semantic_valid"])

    def test_ast_limit_is_structured_and_empty_source_is_valid(self):
        self.assertTrue(self.report("")["semantic_valid"])
        response = self.post("x=0\n" * 1100, language="python")
        self.assertEqual(response.status_code, 422, response.content)
        self.assertEqual(response.json()["error"]["code"], "analysis_limit")
