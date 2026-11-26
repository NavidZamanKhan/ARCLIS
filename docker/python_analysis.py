"""Analyze a staged UTF-8 buffer with the Python standard library."""

import ast
import io
import json
import re
import symtable
import token
import tokenize
import warnings
from pathlib import Path

SOURCE_PATH = Path("/workspace/input.py")
FILENAME = "<buffer>"
MAX_NODES = 4096
MAX_DEPTH = 128
_LINE_BREAKS = re.compile(r"(\r\n|\r|\n)")
_FLAGS = ("parameter", "imported", "local", "global", "declared_global", "nonlocal", "free",
          "assigned", "referenced", "annotated", "namespace")


class AnalysisLimit(Exception):
    pass


class Source:
    def __init__(self, raw):
        self.raw = raw
        text = raw.decode("utf-8-sig")
        parts = _LINE_BREAKS.split(text)
        self.lines = parts[::2]
        self.text = "\n".join(self.lines)
        self.starts = [len(raw) - len(text.encode("utf-8"))]
        self.widths = [len(line.encode("utf-8")) for line in self.lines]
        for width, newline in zip(self.widths, parts[1::2]):
            self.starts.append(self.starts[-1] + width + len(newline))
        self.columns = {}

    def point(self, line, column, *, byte_column=False):
        row = max(0, min(line - 1, len(self.lines) - 1))
        if line > len(self.lines):
            byte = self.widths[row]
        elif byte_column:
            byte = min(max(column, 0), self.widths[row])
        elif column > len(self.lines[row]) and row + 1 < len(self.lines):
            row += 1
            byte = 0
        else:
            column = max(0, min(column, len(self.lines[row])))
            if row not in self.columns:
                offsets = [0]
                for character in self.lines[row]:
                    offsets.append(offsets[-1] + len(character.encode("utf-8")))
                self.columns[row] = offsets
            byte = self.columns[row][column]
        return {"line": row + 1, "column": byte + 1, "offset": self.starts[row] + byte}

    def span(self, start, end, *, byte_column=False):
        first = self.point(*start, byte_column=byte_column)
        last = self.point(*end, byte_column=byte_column)
        return {"start": first, "end": last if last["offset"] >= first["offset"] else first}

    def file_span(self):
        return {"start": {"line": 1, "column": 1, "offset": 0},
                "end": self.point(len(self.lines) + 1, 0)}


def read_tokens(source):
    tokens = []
    try:
        for item in tokenize.generate_tokens(io.StringIO(source.text).readline):
            span = source.span(item.start, item.end)
            start, end = span["start"]["offset"], span["end"]["offset"]
            tokens.append({"kind": token.tok_name[item.type].lower(), "exact_kind": token.tok_name[item.exact_type].lower(),
                           "lexeme": source.raw[start:end].decode("utf-8"), "range": span})
    except (SyntaxError, tokenize.TokenError) as error:
        return tokens, error
    return tokens, None


def display_value(value):
    if isinstance(value, (str, bytes)) and len(value) > 256:
        shortened = value[:256]
        return (shortened if isinstance(shortened, str) else repr(shortened)) + "…"
    if type(value) is int and value.bit_length() > 53:
        return str(value) if value.bit_length() <= 256 else f"<integer of {value.bit_length()} bits>"
    if value is None or isinstance(value, (str, int, bool)):
        return value
    return repr(value)


def serialize_ast(tree, source):
    count = 0

    def serialize(value, depth):
        nonlocal count
        if isinstance(value, list):
            return [serialize(item, depth) for item in value]
        if not isinstance(value, ast.AST):
            return display_value(value)
        count += 1
        if count > MAX_NODES or depth > MAX_DEPTH:
            raise AnalysisLimit
        node = {"kind": type(value).__name__}
        if value is tree:
            node["range"] = source.file_span()
        elif all(getattr(value, name, None) is not None for name in ("lineno", "col_offset", "end_lineno", "end_col_offset")):
            node["range"] = source.span((value.lineno, value.col_offset), (value.end_lineno, value.end_col_offset),
                                        byte_column=True)
        node["fields"] = {name: serialize(item, depth + 1) for name, item in ast.iter_fields(value)}
        return node

    return serialize(tree, 1)


def read_symbols(root, source):
    scopes, symbols = [], []

    def visit(table, parent):
        identifier = len(scopes) + 1
        line = max(table.get_lineno(), 1)
        location = (line, 0)
        span = source.span(location, location)
        scopes.append({"id": identifier, "parent": parent, "name": table.get_name(), "kind": table.get_type(), "range": span})
        for symbol in table.get_symbols():
            flags = [flag for flag in _FLAGS if getattr(symbol, "is_" + flag)()]
            symbols.append({"name": symbol.get_name(), "scope": identifier, "flags": flags, "range": span})
        for child in table.get_children():
            visit(child, identifier)

    visit(root, None)
    return scopes, symbols


def diagnostic(error, source, phase):
    if isinstance(error, SyntaxError):
        line = error.lineno or 1
        column = max((error.offset or 1) - 1, 0)
        end = (error.end_lineno or line, error.end_offset - 1) if (error.end_offset or 0) > 0 else (line, column)
        start = (line, column)
        message = error.msg
    else:
        message, start = error.args
        end = start
    # Compiler-phase errors use offsets from the AST. Parser errors use character offsets.
    return {"phase": phase, "code": "python-" + phase + "-error", "severity": "error",
            "message": message, "range": source.span(start, end, byte_column=phase == "semantic")}


def analyze(raw):
    source = Source(raw)
    tokens, token_error = read_tokens(source)
    report = {"syntax_valid": False, "semantic_valid": None, "tokens": tokens, "ast": None,
              "scopes": [], "symbols": [], "diagnostics": [], "ir": None}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SyntaxWarning)
        warnings.simplefilter("ignore", DeprecationWarning)
        try:
            tree = ast.parse(source.text, filename=FILENAME)
        except SyntaxError as error:
            report["diagnostics"].append(diagnostic(error, source, "syntax"))
            return report
        if token_error is not None:
            report["diagnostics"].append(diagnostic(token_error, source, "lexical"))
            return report

        report["syntax_valid"] = True
        report["ast"] = serialize_ast(tree, source)
        try:
            table = symtable.symtable(source.text, FILENAME, "exec")
            report["scopes"], report["symbols"] = read_symbols(table, source)
            compile(tree, FILENAME, "exec", dont_inherit=True)
        except SyntaxError as error:
            report["semantic_valid"] = False
            report["diagnostics"].append(diagnostic(error, source, "semantic"))
        else:
            report["semantic_valid"] = True
    return report


def main():
    try:
        report = analyze(SOURCE_PATH.read_bytes())
        print(json.dumps(report, separators=(",", ":")))
    except (AnalysisLimit, RecursionError, MemoryError):
        print('{"limit":true}')
        return 2
    return 0 if report["semantic_valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
