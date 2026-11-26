import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


PARSER = Path(sys.argv.pop(1)).resolve()
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def position(source, offset):
    prefix = source[:offset].removeprefix(b"\xef\xbb\xbf")
    lines = re.split(rb"\r\n|\r|\n", prefix)
    return {"line": len(lines), "column": len(lines[-1]) + 1, "offset": offset}


class AstTests(unittest.TestCase):
    def run_ast(self, source=b"", *arguments):
        process = subprocess.run(
            [str(PARSER), "--ast", *map(str, arguments)], input=source,
            capture_output=True, timeout=5, check=False,
        )
        records = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(process.stderr, b"")
        return process, records

    def tree(self, source):
        process, records = self.run_ast(source)
        self.assertEqual(process.returncode, 0, records)
        self.assertEqual(len(records), 2, records)
        self.assertEqual(records[-1], {"kind": "syntax-result", "valid": True, "diagnostics": 0})
        self.assertEqual(records[0]["kind"], "ast")
        root = records[0]["root"]
        self.assertEqual(root["kind"], "Program")
        self.assertEqual(root["range"], {"start": position(source, 0), "end": position(source, len(source))})
        return root

    def assert_span(self, source, node, snippet):
        start = source.index(snippet)
        self.assertEqual(node["range"], {"start": position(source, start), "end": position(source, start + len(snippet))})

    def test_program_items_and_source_order(self):
        root = self.tree((FIXTURES / "syntax_valid.c").read_bytes())
        include, declaration, average, choose, sum_to, main = root["items"]
        self.assertEqual((include["kind"], include["text"]), ("IncludeDirective", "#include <stdio.h>"))
        self.assertEqual((declaration["kind"], declaration["type"], declaration["static"]),
                         ("VariableDeclaration", "int", True))
        total, start = declaration["declarators"]
        self.assertEqual((total["kind"], total["name"], total["initializer"]["text"]), ("Declarator", "total", "3"))
        self.assertEqual((start["name"], start["initializer"]), ("start", None))
        self.assertEqual((average["kind"], average["name"], average["returnType"], average["body"]),
                         ("FunctionDeclaration", "average", "double", None))
        self.assertEqual([(item["type"], item["name"]) for item in average["parameters"]],
                         [("int", "size"), ("double", None)])
        self.assertEqual(choose["parameters"], [])
        self.assertIsNone(choose["body"])
        self.assertTrue(sum_to["static"])
        self.assertEqual(sum_to["parameters"][0]["name"], "limit")
        self.assertEqual(main["name"], "main")
        self.assertEqual(main["body"]["items"][0]["kind"], "Block")

    def test_arithmetic_assignment_and_parentheses(self):
        source = b"int f(void) { a += b = -c + d * (e - f); }"
        statement = self.tree(source)["items"][0]["body"]["items"][0]
        self.assertEqual(statement["kind"], "ExpressionStatement")
        outer = statement["expression"]
        inner = outer["right"]
        self.assertEqual((outer["kind"], outer["operator"], outer["left"]["name"]), ("Assignment", "+=", "a"))
        self.assertEqual((inner["kind"], inner["operator"], inner["left"]["name"]), ("Assignment", "=", "b"))
        addition = inner["right"]
        self.assertEqual((addition["operator"], addition["left"]["kind"], addition["left"]["operator"]),
                         ("+", "UnaryExpression", "-"))
        product = addition["right"]
        group = product["right"]
        self.assertEqual((product["operator"], group["kind"], group["expression"]["operator"]),
                         ("*", "ParenthesizedExpression", "-"))
        self.assert_span(source, group, b"(e - f)")
        self.assert_span(source, group["expression"], b"e - f")
        self.assert_span(source, outer, b"a += b = -c + d * (e - f)")

    def test_logical_and_left_associative_grouping(self):
        source = b"int f(void) { return a || b && c == d < 4 - 2 + 1; }"
        logical_or = self.tree(source)["items"][0]["body"]["items"][0]["expression"]
        logical_and = logical_or["right"]
        equality = logical_and["right"]
        relation = equality["right"]
        addition = relation["right"]
        self.assertEqual([node["operator"] for node in (logical_or, logical_and, equality, relation, addition)],
                         ["||", "&&", "==", "<", "+"])
        self.assertEqual(addition["left"]["operator"], "-")

    def test_control_flow_loops_and_closest_else(self):
        source = (
            b"void f(int n) { for (int i=0; i<n; ++i) "
            b"while (n--) if (i) if (n) return; else i++; for (;;) ; }"
        )
        loop, empty_loop = self.tree(source)["items"][0]["body"]["items"]
        self.assertEqual((loop["kind"], loop["initializer"]["kind"], loop["condition"]["operator"]),
                         ("ForStatement", "VariableDeclaration", "<"))
        self.assertEqual((loop["step"]["operator"], loop["step"]["postfix"]), ("++", False))
        while_loop = loop["body"]
        self.assertEqual((while_loop["kind"], while_loop["condition"]["operator"], while_loop["condition"]["postfix"]),
                         ("WhileStatement", "--", True))
        outer = while_loop["body"]
        inner = outer["thenBranch"]
        self.assertEqual((outer["kind"], inner["kind"]), ("IfStatement", "IfStatement"))
        self.assertIsNone(outer["elseBranch"])
        self.assertEqual(inner["thenBranch"]["kind"], "ReturnStatement")
        self.assertIsNone(inner["thenBranch"]["expression"])
        self.assertTrue(inner["elseBranch"]["expression"]["postfix"])
        self.assertEqual([empty_loop[key] for key in ("initializer", "condition", "step")], [None, None, None])
        self.assertEqual(empty_loop["body"]["kind"], "EmptyStatement")

    def test_utf8_bom_crlf_and_literal_spelling(self):
        source = '\ufeff// leading\r\nint main(void) {\r\n\tf("π" "😀\\n", \'\\x41\', 0x1.fp2);\r\n}\r\n'.encode()
        call = self.tree(source)["items"][0]["body"]["items"][0]["expression"]
        string, character, floating = call["arguments"]
        self.assertEqual((call["kind"], call["callee"]["name"]), ("CallExpression", "f"))
        self.assertEqual(string["kind"], "StringLiteral")
        self.assertEqual([(item["kind"], item["literalKind"], item["text"]) for item in string["segments"]],
                         [("Literal", "string", '"π"'), ("Literal", "string", '"😀\\n"')])
        self.assertEqual((character["literalKind"], character["text"]), ("character", r"'\x41'"))
        self.assertEqual((floating["literalKind"], floating["text"]), ("floating", "0x1.fp2"))
        self.assert_span(source, string["segments"][1], '"😀\\n"'.encode())
        self.assert_span(source, floating, b"0x1.fp2")

    def test_empty_tree_and_stable_output(self):
        for source in (b"", b"\xef\xbb\xbf/* empty */\r\n"):
            with self.subTest(source=source):
                self.assertEqual(self.tree(source)["items"], [])
        path = FIXTURES / "syntax_valid.c"
        source = path.read_bytes()
        runs = [self.run_ast(source), self.run_ast(source, "-"), self.run_ast(b"", path)]
        self.assertTrue(all(process.returncode == 0 for process, _ in runs))
        self.assertEqual([process.stdout for process, _ in runs], [runs[0][0].stdout] * 3)

    def test_malformed_source_returns_diagnostics_without_partial_tree(self):
        source = (FIXTURES / "syntax_invalid.c").read_bytes()
        process, records = self.run_ast(source)
        self.assertEqual(process.returncode, 1)
        self.assertEqual([record["kind"] for record in records], ["diagnostic"] * 3 + ["syntax-result"])
        plain = subprocess.run([str(PARSER)], input=source, capture_output=True, timeout=5, check=False)
        self.assertEqual(process.stdout, plain.stdout)

    def test_ast_resource_limits_return_one_error_and_no_tree(self):
        cases = (
            (b" " * (1024 * 1024 + 1), "ast-source-limit", "1 MiB"),
            (b"int x;\n" * 2100, "ast-resource-limit", "node limit"),
            (b"int f(void) { return " + b"1+" * 130 + b"1; }", "ast-resource-limit", "nesting limit"),
        )
        for source, code, detail in cases:
            with self.subTest(code=code, detail=detail):
                process, records = self.run_ast(source)
                self.assertEqual(process.returncode, 2, records)
                self.assertEqual(len(records), 2)
                self.assertEqual(records[0]["code"], code)
                self.assertIn(detail, records[0]["message"])
                self.assertEqual(records[1], {"kind": "syntax-result", "valid": False, "diagnostics": 1})

    def test_syntax_only_mode_remains_available_for_large_valid_trees(self):
        source = b"int f(void) { return " + b"1+" * 130 + b"1; }"
        process = subprocess.run([str(PARSER)], input=source, capture_output=True, timeout=5, check=False)
        self.assertEqual(process.returncode, 0)
        self.assertEqual(json.loads(process.stdout), {"kind": "syntax-result", "valid": True, "diagnostics": 0})


if __name__ == "__main__":
    unittest.main()
