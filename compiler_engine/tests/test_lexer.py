import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


SCANNER = Path(sys.argv.pop(1)).resolve()
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def position(source, offset):
    prefix = source[:offset].removeprefix(b"\xef\xbb\xbf")
    lines = re.split(rb"\r\n|\r|\n", prefix)
    return {"line": len(lines), "column": len(lines[-1]) + 1, "offset": offset}


def source_range(source, start, end):
    return {"start": position(source, start), "end": position(source, end)}


class LexerTests(unittest.TestCase):
    def run_lexer(self, source=None, *args):
        process = subprocess.run(
            [str(SCANNER), *map(str, args)], input=source,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False,
        )
        records = [json.loads(line) for line in process.stdout.decode("utf-8").split("\n") if line]
        return process, records

    def assert_tokens(self, source, expected):
        process, records = self.run_lexer(source)
        self.assertEqual(process.stderr, b"")
        self.assertEqual(process.returncode, 0, records)
        self.assertEqual([(item["kind"], item["lexeme"]) for item in records], [*expected, ("eof", "")])
        cursor = 0
        for record, (_, lexeme) in zip(records, expected):
            raw = lexeme.encode("utf-8")
            start = source.index(raw, cursor)
            cursor = start + len(raw)
            self.assertEqual(record["range"], source_range(source, start, cursor), record)
        self.assertEqual(records[-1]["range"], source_range(source, len(source), len(source)))

    def test_complete_valid_fixture(self):
        expected = [
            ("include", "# include <stdio.h>"),
            ("keyword", "static"), ("keyword", "int"), ("identifier", "demo"),
            ("delimiter", "("), ("keyword", "int"), ("identifier", "n"), ("delimiter", ")"),
            ("delimiter", "{"), ("keyword", "for"), ("delimiter", "("), ("delimiter", ";"),
            ("identifier", "n"), ("operator", ">"), ("integer", "0"), ("delimiter", ";"),
            ("operator", "--"), ("identifier", "n"), ("delimiter", ")"), ("identifier", "n"),
            ("operator", "+="), ("integer", "0x2"), ("delimiter", ";"),
            ("keyword", "return"), ("identifier", "n"), ("operator", "&&"), ("floating", ".5e1"),
            ("operator", "!="), ("integer", "0"), ("operator", "&&"), ("character", "'a'"),
            ("operator", "=="), ("character", r"'\x61'"), ("delimiter", ";"), ("delimiter", "}"),
        ]
        self.assert_tokens((FIXTURES / "valid.c").read_bytes(), expected)

    def test_keywords_identifiers_and_maximal_operator_matches(self):
        self.assert_tokens(
            b"float double char void if else while _int float2",
            [("keyword", name) for name in ("float", "double", "char", "void", "if", "else", "while")]
            + [("identifier", "_int"), ("identifier", "float2")],
        )
        self.assert_tokens(
            b"v+=a--->b&&c<<=2||!d!=e++;",
            [("identifier", "v"), ("operator", "+="), ("identifier", "a"), ("operator", "--"),
             ("operator", "->"), ("identifier", "b"), ("operator", "&&"), ("identifier", "c"),
             ("operator", "<<="), ("integer", "2"), ("operator", "||"), ("operator", "!"),
             ("identifier", "d"), ("operator", "!="), ("identifier", "e"), ("operator", "++"), ("delimiter", ";")],
        )

    def test_numeric_character_and_string_literals(self):
        integers = ["0", "075", "0xFF", "7u", "8LL", "9UL"]
        floating = ["1.", ".5", "1e-3", "3.0F", "0x1.fp2", "0X1P-3L"]
        characters = ["'x'", r"'\n'", r"'\x41'", r"'\123'", r"'\''", "'π'"]
        strings = [r'"a\"b"', '"é𝄞😀"', r'"unicode:\u00E9"']
        expected = [
            (kind, literal)
            for kind, group in (
                ("integer", integers), ("floating", floating), ("character", characters), ("string", strings),
            )
            for literal in group
        ]
        self.assert_tokens(" ".join(literal for _, literal in expected).encode(), expected)

    def test_malformed_fixture_recovers_and_preserves_error_order(self):
        source = (FIXTURES / "malformed.c").read_bytes()
        process, records = self.run_lexer(source)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(process.stderr, b"")
        expected = [
            ("unsupported-directive", "#define"), ("invalid-include", "#include"),
            ("invalid-number", "09"), ("invalid-character-literal", "'ab'"), ("invalid-string", r'"\q"'),
            ("unterminated-string", '"broken'), ("unterminated-character", "'z"),
            ("invalid-character", "@"), ("unterminated-comment", "/*"),
        ]
        diagnostics = [item for item in records if item["kind"] == "diagnostic"]
        self.assertEqual([(item["code"], item["lexeme"]) for item in diagnostics], expected)
        self.assertTrue(all(item["severity"] == "error" and item["message"] for item in diagnostics))
        cursor = 0
        for diagnostic, (code, lexeme) in zip(diagnostics, expected):
            start = source.index(lexeme.encode(), cursor)
            cursor = len(source) if code == "unterminated-comment" else start + len(lexeme)
            self.assertEqual(diagnostic["range"], source_range(source, start, cursor))
        self.assertEqual([(item["kind"], item["lexeme"]) for item in records[-5:]], [
            ("keyword", "return"), ("integer", "0"), ("delimiter", ";"), ("diagnostic", "/*"), ("eof", ""),
        ])

    def test_invalid_numbers_are_single_diagnostics(self):
        malformed = ["0x", "09", "1.2.3", "6e-", "2foo", "0b10", "0xe+1"]
        process, records = self.run_lexer(" ".join(malformed).encode())
        self.assertEqual(process.returncode, 1)
        self.assertEqual([(item["code"], item["lexeme"]) for item in records[:-1]],
                         [("invalid-number", lexeme) for lexeme in malformed])
        self.assertEqual(records[-1]["kind"], "eof")

    def test_include_recovery_and_comment_context(self):
        source = (
            b'#include "local.h" /* one-line comment */ // tail\r'
            b'#include <stdio.h> /* multi\r\nline */ int valid;\n'
            b'int x; #include "bad.h"\n'
            b'#include "extra.h" trailing\r'
            b'int y;\n'
        )
        process, records = self.run_lexer(source)
        self.assertEqual(process.returncode, 1)
        self.assertEqual([item["lexeme"] for item in records if item["kind"] == "include"],
                         ['#include "local.h"', "#include <stdio.h>", '#include "extra.h"'])
        errors = [item for item in records if item["kind"] == "diagnostic"]
        self.assertEqual([item["code"] for item in errors], ["misplaced-directive", "trailing-include-text"])
        for item, needle in zip(errors, [b'#include "bad.h"', b"trailing"]):
            self.assertEqual(item["range"]["start"], position(source, source.index(needle)))
        self.assertEqual([item["lexeme"] for item in records if item["kind"] == "identifier"], ["valid", "x", "y"])

    def test_byte_columns_with_bom_tabs_and_mixed_newlines(self):
        self.assert_tokens(
            b'\xef\xbb\xbf\tint;\r\n/*\rnote\n*/ "a\xc3\xa9";\rreturn 0;',
            [("keyword", "int"), ("delimiter", ";"), ("string", '"aé"'), ("delimiter", ";"),
             ("keyword", "return"), ("integer", "0"), ("delimiter", ";")],
        )
        self.assert_tokens(b"\xef\xbb\xbf", [])

    def test_binary_input_and_unsupported_words_have_safe_diagnostics(self):
        source = b'\x00\xff \xcf\x80 struct ... "bad\x00"'
        process, records = self.run_lexer(source)
        self.assertEqual(process.returncode, 1)
        self.assertEqual([(item["code"], item["lexeme"]) for item in records[:-1]], [
            ("invalid-character", "\x00"), ("invalid-character", "\xff"), ("invalid-character", "π"),
            ("unsupported-keyword", "struct"), ("unsupported-operator", "..."), ("invalid-string", '"bad\x00"'),
        ])
        self.assertEqual(records[2]["range"], source_range(source, 3, 5))
        self.assertIn(b"\\u0000", process.stdout)
        self.assertIn(b"\\u00ff", process.stdout)
        self.assertNotIn(b"\0", process.stdout)

    def test_empty_and_comment_only_input(self):
        for source in (b"", b" // comment without a newline", b"/* outer ***/ \r\n\t"):
            with self.subTest(source=source):
                self.assert_tokens(source, [])

    def test_output_is_identical_for_file_path_and_repeated_stdin_reads(self):
        for path in (FIXTURES / "valid.c", FIXTURES / "malformed.c"):
            with self.subTest(path=path.name):
                data = path.read_bytes()
                first, _ = self.run_lexer(data)
                second, _ = self.run_lexer(data, "-")
                file_result, _ = self.run_lexer(b"", path)
                self.assertEqual(first.stdout, second.stdout)
                self.assertEqual(first.stdout, file_result.stdout)
                self.assertEqual(first.returncode, file_result.returncode)

    def test_usage_and_missing_file_report_driver_errors(self):
        for args in (("first", "second"), (FIXTURES / "missing.c",)):
            with self.subTest(args=args):
                process, records = self.run_lexer(b"", *args)
                self.assertEqual(process.returncode, 2)
                self.assertTrue(process.stderr)
                self.assertEqual(records, [])


if __name__ == "__main__":
    unittest.main()
