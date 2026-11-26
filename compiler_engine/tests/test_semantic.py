import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PARSER = Path(sys.argv.pop(1)).resolve()


class SemanticTests(unittest.TestCase):
    def run_parser(self, source=b"", *arguments):
        process = subprocess.run(
            [str(PARSER), *arguments], input=source, capture_output=True, check=False, timeout=5,
        )
        records = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(process.stderr, b"")
        return process, records

    def analyze(self, source, expected=()):
        process, records = self.run_parser(source, "--semantic")
        self.assertEqual(process.returncode, int(bool(expected)), records)
        self.assertEqual(records[0], {"kind": "syntax-result", "valid": True, "diagnostics": 0})
        diagnostics = records[1:-2]
        self.assertEqual([record["code"] for record in diagnostics], list(expected), records)
        for diagnostic in diagnostics:
            self.assertEqual(
                (diagnostic["kind"], diagnostic["phase"], diagnostic["severity"]),
                ("diagnostic", "semantic", "error"),
            )
            self.assertTrue(diagnostic["message"])
            start = diagnostic["range"]["start"]["offset"]
            end = diagnostic["range"]["end"]["offset"]
            self.assertTrue(0 <= start < end <= len(source), diagnostic)
        self.assertEqual(records[-2]["kind"], "symbols")
        self.assertEqual(
            records[-1], {"kind": "semantic-result", "valid": not expected, "diagnostics": len(expected)},
        )
        return records[-2], diagnostics

    def test_empty_translation_unit(self):
        for source in (b"", b"/* empty */\r\n", b"#include <stdio.h>\n"):
            with self.subTest(source=source):
                table, _ = self.analyze(source)
                self.assertEqual(table["symbols"], [])
                self.assertEqual(len(table["scopes"]), 1)
                scope = table["scopes"][0]
                self.assertEqual((scope["id"], scope["parent"], scope["kind"]), (1, None, "file"))
                self.assertEqual(scope["range"]["end"]["offset"], len(source))

    def test_nested_scopes_and_shadowing(self):
        source = (
            b"int value; double run(char value) { double total=0; "
            b"{ double value=2; total += value; } "
            b"for (int i = value; i < 3; ++i) { float i = 0.5f; total += i; } "
            b"return total + value; }"
        )
        table, _ = self.analyze(source)
        self.assertEqual(
            [(scope["id"], scope["parent"], scope["kind"]) for scope in table["scopes"]],
            [(1, None, "file"), (2, 1, "function"), (3, 2, "block"), (4, 2, "for"), (5, 4, "block")],
        )
        self.assertEqual(
            [(item["name"], item["type"], item["kind"], item["scope"]) for item in table["symbols"]],
            [
                ("value", "int", "variable", 1), ("run", "double", "function", 1),
                ("value", "char", "parameter", 2), ("total", "double", "variable", 2),
                ("value", "double", "variable", 3), ("i", "int", "variable", 4), ("i", "float", "variable", 5),
            ],
        )
        for scope in table["scopes"][1:]:
            parent = table["scopes"][scope["parent"] - 1]["range"]
            self.assertLessEqual(parent["start"]["offset"], scope["range"]["start"]["offset"])
            self.assertLessEqual(scope["range"]["end"]["offset"], parent["end"]["offset"])
        shadow = b"int f(int outer) { { double outer=2; outer %= 2; } outer %= 2; return outer; }"
        _, diagnostics = self.analyze(shadow, ("invalid-operand-type",))
        self.assertEqual(diagnostics[0]["range"]["start"]["offset"], shadow.index(b"outer %="))

    def test_same_scope_duplicates_include_parameters(self):
        source = b"int p(int a, char a); int f(int v) { int v; int same, same; { char v; } return v; }"
        table, diagnostics = self.analyze(source, ("duplicate-declaration",) * 3)
        self.assertEqual(
            [diagnostic["range"]["start"]["offset"] for diagnostic in diagnostics],
            [source.index(b"char a"), source.index(b"v;"), source.index(b"same;")],
        )
        self.assertEqual(
            [(item["name"], item["scope"]) for item in table["symbols"]],
            [("p", 1), ("a", 2), ("f", 1), ("v", 3), ("same", 3), ("v", 4)],
        )

    def test_use_order_and_scope_exit(self):
        source = (
            b"int compute(int in_proto); int f(void) { "
            b"int a=b, b=1; missing(); { int ended; } ended=2; "
            b"for (int i=0; i<2; ++i) ; i=3; return a+in_proto+later; } int later;"
        )
        _, diagnostics = self.analyze(source, ("undeclared-identifier",) * 6)
        self.assertEqual(
            [source[item["range"]["start"]["offset"]:item["range"]["end"]["offset"]] for item in diagnostics],
            [b"b", b"missing", b"ended", b"i", b"in_proto", b"later"],
        )
        self.analyze(b"int f(void) { int a=1, b=a; { float a=2; } return a+b; }")

    def test_prototypes_recursion_and_tentative_definitions(self):
        source = (
            b"static int value; static int value=4; static int value; "
            b"static double calc(int input, double); double calc(int n, double delta) { "
            b"if (n) return calc(n-1, delta); return value+delta; } "
            b"double calc(int, double); int main() { return (calc)(2, 3.0); }"
        )
        table, _ = self.analyze(source)
        by_name = {item["name"]: item for item in table["symbols"]}
        self.assertEqual(by_name["calc"]["parameterTypes"], ["int", "double"])
        self.assertEqual(by_name["main"]["parameterTypes"], [])
        self.assertTrue(by_name["calc"]["static"])
        self.assertEqual(by_name["value"]["range"]["start"]["offset"], source.index(b"value;"))
        self.assertEqual(by_name["value"]["definitionRange"]["start"]["offset"], source.index(b"value=4"))
        self.assertEqual(by_name["calc"]["definitionRange"]["start"]["offset"], source.index(b"double calc(int n"))
        self.assertIsNone(by_name["input"]["definitionRange"])
        self.assertIn("delta", by_name)
        self.assertNotIn(None, by_name)

    def test_conflicting_declarations_and_multiple_definitions(self):
        source = (
            b"int n=1; int n=2; double n; int make(int); double make(int); int make(double); "
            b"int make(int n) { return n; } int make(int n) { return 0; } int make; int g(); static int g();"
        )
        table, _ = self.analyze(source, (
            "duplicate-definition", "conflicting-declaration", "conflicting-declaration", "conflicting-declaration",
            "duplicate-definition", "conflicting-declaration", "conflicting-declaration",
        ))
        globals_ = [item for item in table["symbols"] if item["scope"] == 1]
        self.assertEqual([(item["kind"], item["name"], item["type"]) for item in globals_],
                         [("variable", "n", "int"), ("function", "make", "int"), ("function", "g", "int")])
        self.assertEqual(globals_[1]["definitionRange"]["start"]["offset"], source.index(b"int make(int n)"))

    def test_modifiable_targets_and_numeric_operators(self):
        source = (
            b"int f(int n) { char c = 'a'; double x=1e0; float y=0x1.fp2f; "
            b"(n)++; ++c; n += y * x; n %= c; if (!n || y && c) n = n / 2; "
            b"(1+n)=2; (n,c)++; ++f; n = \"text\"; n %= y; x = 3 % x; return n; }"
        )
        self.analyze(source, (
            "invalid-assignment-target", "invalid-assignment-target", "invalid-assignment-target",
            "invalid-assignment-type", "invalid-operand-type", "invalid-operand-type",
        ))
        self.analyze(b"int f(void) { if (\"ok\" && \"yes\") return 1; return 0; }")

    def test_invalid_declaration_condition_and_return_types(self):
        source = (
            b"void object; void sink(void) { return; } int invalid(void named, int) { "
            b"char a=sink(); if (sink()) ; while (sink()) ; for (; sink(); ) ; "
            b"for (static int i=0; i<1; ++i) ; if (a) return; return \"bad\"; } "
            b"void returns_value(void) { return sink(); }"
        )
        self.analyze(source, (
            "invalid-object-type", "invalid-parameter-type", "missing-parameter-name", "invalid-initializer-type",
            "invalid-condition-type", "invalid-condition-type", "invalid-condition-type", "invalid-loop-storage",
            "missing-return-value", "invalid-return-type", "unexpected-return-value",
        ))

    def test_call_arity_type_and_shadowing(self):
        source = (
            b"void sink(void); int calc(int n, double x); int main(void) { "
            b"calc('a', 3); calc(\"bad\", sink()); calc(1); calc(1, 2, 3); sink(1); "
            b"{ int calc; calc(1); } missing(unknown); return 0; }"
        )
        self.analyze(source, (
            "invalid-argument-type", "invalid-argument-type", "argument-count", "argument-count",
            "argument-count", "not-callable", "undeclared-identifier", "undeclared-identifier",
        ))

    def test_diagnostic_crlf_bom_and_utf8_coordinates(self):
        source = '\ufeff// π\r\nint main(void) {\r\n\t"π", missing;\r\n}\r\n'.encode()
        _, diagnostics = self.analyze(source, ("undeclared-identifier",))
        offset = source.index(b"missing")
        self.assertEqual(diagnostics[0]["range"], {
            "start": {"line": 3, "column": 8, "offset": offset},
            "end": {"line": 3, "column": 15, "offset": offset + 7},
        })

    def test_deterministic_modes_and_failed_syntax(self):
        source = b"int main(void) { return missing; }"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.c"
            path.write_bytes(source)
            process, _ = self.run_parser(source, "--semantic")
            explicit_stdin, _ = self.run_parser(source, "--semantic", "-")
            from_file, _ = self.run_parser(b"", "--semantic", str(path))
        self.assertEqual(process.stdout, explicit_stdin.stdout)
        self.assertEqual(process.stdout, from_file.stdout)
        simple, simple_records = self.run_parser(source)
        ast, ast_records = self.run_parser(source, "--ast")
        self.assertEqual((simple.returncode, ast.returncode), (0, 0))
        self.assertEqual(simple_records, [{"kind": "syntax-result", "valid": True, "diagnostics": 0}])
        self.assertEqual([record["kind"] for record in ast_records], ["ast", "syntax-result"])

        invalid, records = self.run_parser(b"int main(void) { return @; }", "--semantic")
        self.assertEqual(invalid.returncode, 1)
        self.assertTrue(any(record.get("phase") == "lexical" for record in records))
        self.assertFalse(any(record.get("phase") == "semantic" or record["kind"] == "symbols" for record in records))
        self.assertFalse(records[-2]["valid"])
        self.assertEqual(records[-1], {"kind": "semantic-result", "valid": None, "diagnostics": 0})

    def test_resource_limits_and_large_symbol_table(self):
        source = b"".join(f"int name_{index};\n".encode() for index in range(1800))
        table, _ = self.analyze(source)
        self.assertEqual(len(table["symbols"]), 1800)
        self.assertEqual(table["symbols"][-1]["name"], "name_1799")
        for source in (b" " * (1024 * 1024 + 1), b"int x;\n" * 2500, b"int f() {" + b"{" * 130 + b"}" * 131):
            process, records = self.run_parser(source, "--semantic")
            self.assertEqual(process.returncode, 2)
            self.assertFalse(any(record["kind"] == "symbols" for record in records))
            self.assertIsNone(records[-1]["valid"])


if __name__ == "__main__":
    unittest.main()
