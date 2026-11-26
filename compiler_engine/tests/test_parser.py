import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


PARSER, TRACE, REPORT = (Path(arg).resolve() for arg in sys.argv[1:4])
del sys.argv[1:4]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
REDUCTION = re.compile(
    r"Reducing stack by rule [^\n]+:\n((?:   \$\d+ = [^\n]+\n)+)"
    r"-> \$\$ = nterm ([a-z_]+) \(@(\d+)-(\d+): \)"
)


def position(source, offset):
    prefix = source[:offset].removeprefix(b"\xef\xbb\xbf")
    lines = re.split(rb"\r\n|\r|\n", prefix)
    return {"line": len(lines), "column": len(lines[-1]) + 1, "offset": offset}


class ParserTests(unittest.TestCase):
    def run_parser(self, source=b"", *args):
        process = subprocess.run(
            [str(PARSER), *map(str, args)], input=source,
            capture_output=True, timeout=5, check=False,
        )
        records = [json.loads(line) for line in process.stdout.splitlines()]
        return process, records

    def invalid(self, source):
        process, records = self.run_parser(source)
        self.assertEqual(process.stderr, b"")
        self.assertEqual(process.returncode, 1, records)
        self.assertGreater(len(records), 1, records)
        self.assertEqual(records[-1], {"kind": "syntax-result", "valid": False, "diagnostics": len(records) - 1})
        for record in records[:-1]:
            self.assertEqual((record["kind"], record["severity"]), ("diagnostic", "error"))
        return records[:-1]

    def assert_at(self, record, source, lexeme, offset=None):
        start = source.index(lexeme) if offset is None else offset
        self.assertEqual(record["range"], {
            "start": position(source, start), "end": position(source, start + len(lexeme)),
        })

    def reductions(self, source, categories):
        process = subprocess.run([str(TRACE)], input=source, capture_output=True, timeout=5, check=False)
        self.assertEqual(process.returncode, 0, process.stderr)
        return [
            (category, source[int(start):int(end)])
            for rhs, category, start, end in REDUCTION.findall(process.stderr.decode())
            if len(rhs.splitlines()) == 3 and category in categories
        ]

    def test_valid_programs(self):
        for source in (
            b"", b"/* nothing */\r\n", b'#include "local.h"\n',
            b"void idle(void) { for (;;) ; }\nvoid log(char, double x);\n",
            (FIXTURES / "syntax_valid.c").read_bytes(), (FIXTURES / "valid.c").read_bytes(),
        ):
            with self.subTest(source=source[:50]):
                process, records = self.run_parser(source)
                self.assertEqual(process.returncode, 0, records)
                self.assertEqual(process.stderr, b"")
                self.assertEqual(records, [{"kind": "syntax-result", "valid": True, "diagnostics": 0}])

    def test_arithmetic_and_assignment_grouping(self):
        source = b"int main(void) { a += b = 3 + 4 * 5 - 2; return a; }\n"
        self.assertEqual(self.reductions(source, {
            "multiplicative_expression", "additive_expression", "assignment_expression",
        }), [
            ("multiplicative_expression", b"4 * 5"),
            ("additive_expression", b"3 + 4 * 5"),
            ("additive_expression", b"3 + 4 * 5 - 2"),
            ("assignment_expression", b"b = 3 + 4 * 5 - 2"),
            ("assignment_expression", b"a += b = 3 + 4 * 5 - 2"),
        ])

    def test_logical_equality_relational_and_arithmetic_grouping(self):
        source = b"int f(void) { return a || b && c == 3 < d + 1; }\n"
        self.assertEqual(self.reductions(source, {
            "additive_expression", "relational_expression", "equality_expression",
            "logical_and_expression", "logical_or_expression",
        }), [
            ("additive_expression", b"d + 1"),
            ("relational_expression", b"3 < d + 1"),
            ("equality_expression", b"c == 3 < d + 1"),
            ("logical_and_expression", b"b && c == 3 < d + 1"),
            ("logical_or_expression", b"a || b && c == 3 < d + 1"),
        ])

    def test_bison_report_has_only_the_explicit_dangling_else_resolution(self):
        report = REPORT.read_text()
        self.assertNotRegex(report, r"(?m)^State \d+ conflicts:")
        resolutions = re.findall(r"Conflict between [^\n]+", report)
        self.assertEqual(len(resolutions), 1, resolutions)
        self.assertIn('token "else" resolved as shift', resolutions[0])

    def test_recovers_at_semicolons_and_preserves_lexical_diagnostics(self):
        source = (FIXTURES / "syntax_invalid.c").read_bytes()
        records = self.invalid(source)
        self.assertEqual([(record["phase"], record["code"]) for record in records], [
            ("syntax", "syntax-error"), ("lexical", "invalid-number"), ("syntax", "unsupported-syntax"),
        ])
        for record, lexeme in zip(records, (b";", b"09", b"*")):
            self.assert_at(record, source, lexeme)

    def test_unexpected_end_of_input_has_a_zero_width_range(self):
        source = b"int f(void) {\r\n  return 3;"
        records = self.invalid(source)
        self.assertIn("end of file", records[0]["message"])
        self.assert_at(records[0], source, b"", len(source))

    def test_reports_unexpected_token_after_bom_and_crlf(self):
        source = b"\xef\xbb\xbf// header\r\nint main(void) {\r\n\treturn 0\r\n}\r\n"
        records = self.invalid(source)
        self.assertEqual(records[0]["code"], "syntax-error")
        self.assertIn("unexpected '}'", records[0]["message"])
        self.assert_at(records[0], source, b"}")

    def test_rejects_malformed_declarations_control_flow_and_expressions(self):
        for source in (
            b"int main(void) { 1 + 2 = 3; }",
            b"int main(void) { if () return 0; }",
            b"int main(void) { while (1 return 0; }",
            b"int main(void) { for (int n = 0 n < 2; ++n) ; }",
            b"int f(int first, );",
            b"int a, ;",
        ):
            with self.subTest(source=source):
                self.assertEqual(self.invalid(source)[0]["code"], "syntax-error")

    def test_unsupported_constructs_are_reported_at_their_tokens(self):
        cases = (
            (b"int *pointer;", b"*", "syntax", "unsupported-syntax", "Pointer"),
            (b"int values[3];", b"[", "syntax", "unsupported-syntax", "Array"),
            (b"int f(void) { return item.member; }", b".", "syntax", "unsupported-syntax", "Member access"),
            (b"struct Record;", b"struct", "lexical", "unsupported-keyword", "supported C subset"),
            (b"int f(int first, ...);", b"...", "lexical", "unsupported-operator", "Variadic"),
        )
        for source, token, phase, code, message in cases:
            with self.subTest(source=source):
                first = self.invalid(source)[0]
                self.assertEqual((first["phase"], first["code"]), (phase, code))
                self.assertIn(message, first["message"])
                self.assert_at(first, source, token)

    def test_repeated_runs_and_file_input_produce_identical_output(self):
        path = FIXTURES / "syntax_invalid.c"
        source = path.read_bytes()
        runs = [self.run_parser(source), self.run_parser(source, "-"), self.run_parser(b"", path)]
        self.assertTrue(all(item[0].returncode == 1 for item in runs))
        self.assertEqual([item[0].stdout for item in runs], [runs[0][0].stdout] * 3)

    def test_invalid_cli_arguments_and_missing_file_return_driver_error(self):
        for args in (("first", "second"), (FIXTURES / "missing.c",)):
            with self.subTest(args=args):
                process, records = self.run_parser(b"", *args)
                self.assertEqual(process.returncode, 2)
                self.assertTrue(process.stderr)
                self.assertEqual(records, [])


if __name__ == "__main__":
    unittest.main()
