import json

from apps.execution.sandbox import SandboxLimits, Toolchain
from apps.execution.states import ExecutionState
from apps.execution.worker import run_job
from apps.execution.workspace import SourceFile

MAX_SOURCE_BYTES = 64 * 1024


class AnalyzerLimits(SandboxLimits):
    MAX_OUTPUT_BYTES = 2 * 1024 * 1024


LIMITS = AnalyzerLimits(cpu_millis=500, memory_mib=64, processes=16, scratch_mib=1,
                        output_bytes=AnalyzerLimits.MAX_OUTPUT_BYTES, timeout_seconds=5)
COMMAND = (
    "/bin/sh", "-c",
    '/opt/arclis/arclis-lex /workspace/input.c; status=$?; '
    'if [ "$status" -gt 1 ]; then exit "$status"; fi; '
    'exec /opt/arclis/arclis-parse --analysis /workspace/input.c',
)
PYTHON_COMMAND = ("python3", "-I", "-B", "/opt/arclis/python_analysis.py")
_TOKENS = {"keyword", "identifier", "integer", "floating", "character", "string",
           "operator", "delimiter", "include", "eof"}
_DIAGNOSTIC_PHASES = {"lexical", "syntax", "semantic"}
_PARSER_RECORDS = {"ast", "syntax-result", "symbols", "semantic-result", "ir", "ir-result"}
_PARSER_LIMITS = {"ast-resource-limit", "parser-resource-limit", "ast-source-limit"}


class AnalysisUnavailable(RuntimeError):
    pass


class AnalysisLimit(RuntimeError):
    pass


def _decode_records(output):
    if not output.endswith(b"\n"):
        raise ValueError("Incomplete JSON Lines report")
    for line in output.split(b"\n")[:-1]:
        record = json.loads(line)
        if not isinstance(record, dict) or not isinstance(record.get("kind"), str):
            raise ValueError("Invalid record")
        yield record


def _offsets(record, source_size):
    span = record["range"]
    start, end = span["start"], span["end"]
    for point in (start, end):
        if (type(point["line"]) is not int or point["line"] < 1
                or type(point["column"]) is not int or point["column"] < 1
                or type(point["offset"]) is not int):
            raise ValueError("Invalid source position")
    if not 0 <= start["offset"] <= end["offset"] <= source_size:
        raise ValueError("Invalid source range")
    return start["offset"], end["offset"]


def _diagnostic(record, source_size):
    if (record.get("phase") not in _DIAGNOSTIC_PHASES or record.get("severity") != "error"
            or not isinstance(record.get("code"), str) or not isinstance(record.get("message"), str)):
        raise ValueError("Invalid diagnostic")
    return record["phase"], record["code"], *_offsets(record, source_size)


def _located_array(record, field, source_size):
    entries = record[field]
    if not isinstance(entries, list):
        raise ValueError("Expected an array")
    for entry in entries:
        _offsets(entry, source_size)
    return entries


def _collect_report(output, source_size, exit_code):
    records = iter(_decode_records(output))
    tokens, diagnostics = [], {}
    last_offset = 0
    for token in records:
        kind = token["kind"]
        if not isinstance(token.get("lexeme"), str):
            raise ValueError("Invalid token text")
        start, end = _offsets(token, source_size)
        if start < last_offset:
            raise ValueError("Unordered tokens")
        last_offset = end
        if kind == "diagnostic":
            error = {key: value for key, value in token.items() if key != "lexeme"}
            error["phase"] = "lexical"
            diagnostics[_diagnostic(error, source_size)] = error
        elif kind in _TOKENS:
            tokens.append(token)
        else:
            raise ValueError("Unknown token kind")
        if kind == "eof":
            if start != source_size:
                raise ValueError("Invalid end-of-file range")
            break
    else:
        raise ValueError("Missing end-of-file token")

    report = {}
    syntax_errors = semantic_errors = 0
    for record in records:
        kind = record["kind"]
        if kind == "diagnostic":
            key = _diagnostic(record, source_size)
            diagnostics.setdefault(key, record)
            if record["phase"] == "semantic":
                semantic_errors += 1
            else:
                syntax_errors += 1
        elif kind in _PARSER_RECORDS and kind not in report:
            report[kind] = record
        else:
            raise ValueError("Unexpected parser record")

    syntax = report["syntax-result"]["valid"]
    semantic = report["semantic-result"]["valid"]
    generated = report["ir-result"]["generated"]
    if (type(syntax) is not bool or type(generated) is not bool
            or (type(semantic) is not bool if syntax else semantic is not None)
            or report["syntax-result"]["diagnostics"] != syntax_errors
            or report["semantic-result"]["diagnostics"] != semantic_errors
            or syntax != (syntax_errors == 0) or (syntax and semantic != (semantic_errors == 0))
            or ("ast" in report) != syntax or ("symbols" in report) != syntax
            or ("ir" in report) != generated or generated != (semantic is True)):
        raise ValueError("Inconsistent analysis results")
    if exit_code == 2 and not syntax and any(code in _PARSER_LIMITS for _, code, _, _ in diagnostics):
        raise AnalysisLimit("The source exceeds the compiler's analysis limits.")
    if exit_code != (0 if generated else 1) or (not generated and not diagnostics):
        raise ValueError("Unexpected analyzer exit status")

    ast = report["ast"]["root"] if syntax else None
    if syntax and (ast.get("kind") != "Program" or _offsets(ast, source_size) != (0, source_size)):
        raise ValueError("Invalid AST root")
    symbols = report.get("symbols", {"symbols": [], "scopes": []})
    ir = None
    if generated:
        ir = {field: _located_array(report["ir"], field, source_size) for field in ("initializers", "instructions")}
    return {
        "syntax_valid": syntax, "semantic_valid": semantic,
        "tokens": tokens, "ast": ast, "scopes": _located_array(symbols, "scopes", source_size),
        "symbols": _located_array(symbols, "symbols", source_size), "ir": ir,
        "diagnostics": [diagnostics[key] for key in sorted(diagnostics, key=lambda key: key[2:])],
    }


def _run_analyzer(content, path, toolchain, command):
    result = run_job([SourceFile(path, content)], toolchain, command, LIMITS)
    outcome = result.outcome
    if outcome.state is ExecutionState.RESOURCE_LIMIT_EXCEEDED:
        raise AnalysisLimit("The analyzer reached its resource or output limit.")
    if outcome.state is ExecutionState.TIMEOUT:
        raise AnalysisLimit("The analyzer reached its time limit.")
    if outcome.state not in (ExecutionState.COMPLETED, ExecutionState.RUNTIME_FAILED) or outcome.stderr:
        raise AnalysisUnavailable("The analyzer worker did not complete.")
    return outcome


def analyze_c(content, source_size):
    outcome = _run_analyzer(content, "input.c", Toolchain.C_ANALYZER, COMMAND)
    try:
        return _collect_report(outcome.stdout, source_size, outcome.exit_code)
    except (AttributeError, KeyError, TypeError, ValueError, RecursionError) as error:
        raise AnalysisUnavailable("The analyzer returned an invalid report.") from error


def _collect_python_report(output, source_size, exit_code):
    report = json.loads(output)
    if exit_code == 2 and report == {"limit": True}:
        raise AnalysisLimit("The source exceeds the Python analyzer's AST size or nesting limits.")
    syntax, semantic = report["syntax_valid"], report["semantic_valid"]
    if (type(syntax) is not bool or (type(semantic) is not bool if syntax else semantic is not None)
            or report["ir"] is not None or exit_code != (0 if semantic is True else 1)):
        raise ValueError("Inconsistent Python analysis results")
    ast = report["ast"]
    if syntax:
        if ast["kind"] != "Module" or _offsets(ast, source_size) != (0, source_size):
            raise ValueError("Invalid Python AST root")
    elif ast is not None:
        raise ValueError("Unexpected Python AST")
    tokens = _located_array(report, "tokens", source_size)
    for item in tokens:
        if not all(isinstance(item.get(field), str) for field in ("kind", "exact_kind", "lexeme")):
            raise ValueError("Invalid Python token")
    if syntax and (not tokens or tokens[-1]["kind"] != "endmarker" or _offsets(tokens[-1], source_size) != (source_size, source_size)):
        raise ValueError("Missing Python end marker")
    diagnostics = _located_array(report, "diagnostics", source_size)
    for item in diagnostics:
        _diagnostic(item, source_size)
    if bool(diagnostics) == (semantic is True):
        raise ValueError("Inconsistent Python diagnostics")
    return {"syntax_valid": syntax, "semantic_valid": semantic, "tokens": tokens, "ast": ast, "ir": None,
            "scopes": _located_array(report, "scopes", source_size),
            "symbols": _located_array(report, "symbols", source_size), "diagnostics": diagnostics}


def analyze_python(content, source_size):
    outcome = _run_analyzer(content, "input.py", Toolchain.PYTHON_ANALYZER, PYTHON_COMMAND)
    try:
        return _collect_python_report(outcome.stdout, source_size, outcome.exit_code)
    except (AttributeError, KeyError, TypeError, ValueError, RecursionError) as error:
        raise AnalysisUnavailable("The Python analyzer returned an invalid report.") from error
