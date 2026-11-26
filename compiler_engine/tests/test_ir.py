import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PARSER = Path(sys.argv.pop(1)).resolve()


def symbol_id(operand):
    if operand["kind"] != "symbol":
        raise ValueError(operand)
    return operand["id"]


class IrTests(unittest.TestCase):
    def run_parser(self, source=b"", *arguments):
        process = subprocess.run(
            [str(PARSER), *arguments], input=source, capture_output=True, check=False, timeout=5,
        )
        self.assertEqual(process.stderr, b"")
        return process, [json.loads(row) for row in process.stdout.splitlines()]

    def check_references(self, instructions, symbols, source):
        labels = {}
        targets = []
        calls = {}
        arguments = {}
        temporaries = set()
        function = None
        for index, item in enumerate(instructions):
            start, end = (item["range"][endpoint]["offset"] for endpoint in ("start", "end"))
            self.assertTrue(0 <= start < end <= len(source), item)
            if item["op"] == "function":
                self.assertIsNone(function)
                function = symbol_id(item["symbol"])
            elif item["op"] == "end-function":
                self.assertEqual(function, symbol_id(item["symbol"]))
            elif item["op"] == "label":
                self.assertNotIn(item["label"], labels)
                labels[item["label"]] = function
            elif item["op"] in ("branch-zero", "branch-nonzero", "jump"):
                targets.append((item["target"], function))
            elif item["op"] == "argument":
                arguments.setdefault(item["callSite"], []).append((index, item["index"], function))
            elif item["op"] == "call":
                self.assertNotIn(item["callSite"], calls)
                calls[item["callSite"]] = (index, item["argumentCount"], function)
            for field, operand in item.items():
                if not isinstance(operand, dict):
                    continue
                if operand.get("kind") == "symbol":
                    self.assertTrue(0 < operand["id"] <= len(symbols), item)
                if operand.get("kind") == "temp":
                    if field == "result":
                        temporaries.add((function, operand["id"]))
                    else:
                        self.assertIn((function, operand["id"]), temporaries)
            if item["op"] == "end-function":
                function = None
        self.assertIsNone(function)
        for label, owner in targets:
            self.assertIn(label, labels)
            self.assertEqual(labels[label], owner)
        self.assertTrue(arguments.keys() <= calls.keys())
        for site, (call_index, count, owner) in calls.items():
            operands = arguments.get(site, [])
            self.assertEqual([argument for _, argument, _ in operands], list(range(count)))
            self.assertTrue(all(position < call_index and scope == owner for position, _, scope in operands))

    def generate(self, source):
        process, records = self.run_parser(source, "--ir")
        self.assertEqual(process.returncode, 0, records)
        self.assertEqual(
            [row["kind"] for row in records], ["syntax-result", "symbols", "semantic-result", "ir", "ir-result"],
        )
        self.assertEqual(records[-1], {"kind": "ir-result", "generated": True})
        symbols = records[1]["symbols"]
        for section in ("initializers", "instructions"):
            self.check_references(records[-2][section], symbols, source)
        return records[-2], symbols

    def test_precedence_and_unary_operands(self):
        ir, _ = self.generate(b"int f(void) { return -(1 + 2 * 3); }")
        self.assertEqual(ir["initializers"], [])
        begin, product, total, negative, returned, end = ir["instructions"]
        self.assertEqual((begin["op"], end["op"]), ("function", "end-function"))
        self.assertEqual((product["op"], total["op"], negative["op"]), ("binary", "binary", "unary"))
        self.assertEqual((product["operator"], total["operator"], negative["operator"]), ("*", "+", "-"))
        self.assertEqual((product["left"]["text"], product["right"]["text"], total["left"]["text"]), ("2", "3", "1"))
        self.assertEqual(total["right"], product["result"])
        self.assertEqual(negative["operand"], total["result"])
        self.assertEqual(returned["value"], negative["result"])

    def test_assignment_result_and_pre_post_increment(self):
        ir, symbols = self.generate(b"int f(int a) { char b; b = a++; b %= 3; return (b = ++a); }")
        instructions = ir["instructions"]
        stores = [index for index, item in enumerate(instructions) if item["op"] == "store"]
        post, assignment, compound, pre, last = stores
        self.assertEqual([symbols[symbol_id(instructions[index]["target"]) - 1]["name"] for index in stores],
                         ["a", "b", "b", "a", "b"])
        self.assertEqual(instructions[assignment]["value"], instructions[post - 1]["left"])
        self.assertEqual(instructions[compound - 1]["operator"], "%")
        self.assertEqual(instructions[last]["value"], instructions[pre + 1]["result"])
        self.assertEqual(instructions[last + 1]["source"], instructions[last]["target"])
        self.assertEqual(instructions[last + 2]["value"], instructions[last + 1]["result"])

    def test_if_else_labels(self):
        ir, _ = self.generate(b"int f(int c) { int n; if (c) n = 1; else n = 2; if (!c) n += 3; return n; }")
        code = ir["instructions"]
        branches = [index for index, item in enumerate(code) if item["op"] == "branch-zero"]
        first, second = branches
        labels = {item["label"]: index for index, item in enumerate(code) if item["op"] == "label"}
        alternative = labels[code[first]["target"]]
        self.assertEqual(code[alternative - 1]["op"], "jump")
        self.assertEqual(code[alternative + 1]["value"]["text"], "2")
        self.assertEqual(code[first + 1]["value"]["text"], "1")
        self.assertGreater(labels[code[alternative - 1]["target"]], alternative)
        self.assertGreater(labels[code[second]["target"]], second)

    def test_while_for_and_infinite_loop(self):
        source = (
            b"int f(int n) { while (n > 3) --n; for (int i=0; i<n; i++) n -= 1; "
            b"return n; } void forever(void) { for (;;) ; }"
        )
        ir, _ = self.generate(source)
        code = ir["instructions"]
        labels = {item["label"]: index for index, item in enumerate(code) if item["op"] == "label"}
        branches = [index for index, item in enumerate(code) if item["op"] == "branch-zero"]
        back_edges = [index for index, item in enumerate(code) if item["op"] == "jump"]
        self.assertEqual((len(branches), len(back_edges)), (2, 3))
        for branch, back in zip(branches, back_edges):
            self.assertLess(labels[code[back]["target"]], branch)
            self.assertLess(branch, back)
            self.assertEqual(labels[code[branch]["target"]], back + 1)
        self.assertEqual(code[back_edges[1] - 1]["op"], "store")
        self.assertEqual(labels[code[back_edges[2]]["target"]], back_edges[2] - 1)

    def test_short_circuit_calls_and_boolean_results(self):
        ir, _ = self.generate(b"int side(void); int f(int n) { return n && side() || side(); }")
        code = ir["instructions"]
        labels = {item["label"]: index for index, item in enumerate(code) if item["op"] == "label"}
        calls = [index for index, item in enumerate(code) if item["op"] == "call"]
        branches = [index for index, item in enumerate(code) if item["op"].startswith("branch-")]
        self.assertEqual([code[index]["op"] for index in branches], ["branch-zero", "branch-nonzero"])
        for branch, call, boolean in zip(branches, calls, ("0", "1")):
            shortcut = labels[code[branch]["target"]]
            self.assertLess(branch, call)
            self.assertLess(call, shortcut)
            self.assertEqual(code[call + 1]["op"], "truth")
            self.assertEqual(code[call + 2]["op"], "jump")
            self.assertEqual(code[shortcut + 1]["op"], "move")
            self.assertEqual(code[shortcut + 1]["value"]["text"], boolean)
            self.assertEqual(code[call + 1]["result"], code[shortcut + 1]["result"])

    def test_nested_calls_parameters_and_void_result(self):
        source = (
            b"double add(int first, double second); int make(void); void log(int v); "
            b"int f(int x) { log(add(x, make())); return (0, make)(); }"
        )
        ir, symbols = self.generate(source)
        code = ir["instructions"]
        self.assertEqual([item["op"] for item in code[:2]], ["function", "parameter"])
        self.assertEqual(code[1]["index"], 0)
        calls = [item for item in code if item["op"] == "call"]
        self.assertEqual([symbols[symbol_id(item["callee"]) - 1]["name"] for item in calls],
                         ["make", "add", "log", "make"])
        self.assertEqual([item["argumentCount"] for item in calls], [0, 2, 1, 0])
        self.assertIsNone(calls[2]["result"])
        self.assertEqual(code[-2]["value"], calls[-1]["result"])

    def test_source_order_bindings_and_shadowed_operands(self):
        source = (
            b"int x; int x=4; int x; int f(void) { int y=x; int x=1; "
            b"{ int z=x; double x=2; z+=x; } return y+x; }"
        )
        ir, symbols = self.generate(source)
        globals_ = ir["initializers"]
        self.assertEqual([item["op"] for item in globals_], ["global", "store"])
        self.assertEqual(globals_[1]["target"], globals_[0]["symbol"])
        loads = [symbol_id(item["source"]) for item in ir["instructions"] if item["op"] == "load"]
        scopes = [symbols[index - 1]["scope"] for index in loads if symbols[index - 1]["name"] == "x"]
        self.assertEqual(scopes, [1, 2, 3, 2])

    def test_static_initializers_are_outside_function_bodies(self):
        source = b"static int base=7; int f(void) { static int count=2*3; int y=7; return count++ + base + y; }"
        ir, symbols = self.generate(source)
        initializers = ir["initializers"]
        self.assertEqual([item["op"] for item in initializers], ["global", "store", "global", "binary", "store"])
        allocated = [symbol_id(item["symbol"]) for item in initializers if item["op"] == "global"]
        self.assertEqual([symbols[index - 1]["name"] for index in allocated], ["base", "count"])
        code = ir["instructions"]
        self.assertTrue(all(item["op"] != "global" for item in code))
        stored = [symbol_id(item["target"]) for item in code if item["op"] == "store"]
        self.assertEqual([symbols[index - 1]["name"] for index in stored], ["y", "count"])

    def test_returns_raw_strings_and_byte_ranges(self):
        source = '\ufeff// α\r\nvoid f(void) { if ("π" "\\n") return; }\r\n'.encode()
        ir, _ = self.generate(source)
        branch = ir["instructions"][1]
        self.assertEqual(branch["value"], {"kind": "literal", "literalKind": "string", "segments": ['"π"', r'"\n"']})
        self.assertEqual(branch["range"]["start"], {"line": 2, "column": 20, "offset": source.index(b'"')})
        self.assertEqual(ir["instructions"][2]["op"], "return")
        self.assertIsNone(ir["instructions"][2]["value"])

    def test_invalid_or_oversized_source_yields_no_ir(self):
        cases = (
            (b"int f(void) { return @; }", 1, "lexical"),
            (b"int f(void) { return 1+; }", 1, "syntax"),
            (b"int f(void) { return missing; }", 1, "semantic"),
            (b" " * (1024 * 1024 + 1), 2, "syntax"),
        )
        for source, status, phase in cases:
            with self.subTest(status=status, phase=phase):
                process, records = self.run_parser(source, "--ir")
                self.assertEqual(process.returncode, status)
                self.assertTrue(any(record.get("phase") == phase for record in records))
                self.assertFalse(any(record["kind"] == "ir" for record in records))
                self.assertEqual(records[-1], {"kind": "ir-result", "generated": False})

    def test_stable_across_file_and_stdin_and_preserves_semantic_records(self):
        source = b"int f(int n) { int s=0; for (int i=0; i<n; ++i) s+=i; return s; }"
        process, records = self.run_parser(source, "--ir")
        explicit, _ = self.run_parser(source, "--ir", "-")
        _, semantics = self.run_parser(source, "--semantic")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.c"
            path.write_bytes(source)
            from_file, _ = self.run_parser(b"", "--ir", str(path))
        self.assertEqual(process.stdout, explicit.stdout)
        self.assertEqual(process.stdout, from_file.stdout)
        self.assertEqual(semantics, records[:-2])

    def test_empty_unit_and_near_limit_instruction_stream(self):
        ir, symbols = self.generate(b"/* empty */")
        self.assertEqual(symbols, [])
        self.assertEqual(ir, {"kind": "ir", "initializers": [], "instructions": []})
        ir, _ = self.generate(b"int f(void) {" + b"1 || 0;" * 950 + b"return 0;}")
        self.assertEqual(len(ir["instructions"]), 6 * 950 + 3)


if __name__ == "__main__":
    unittest.main()
