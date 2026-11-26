FLEX ?= flex
BISON ?= bison
PYTHON ?= python3
CFLAGS ?= -std=c17 -Wall -Wextra -Wpedantic -O2
BUILD_DIR ?= build
SCANNER := $(BUILD_DIR)/lexer.yy.c
TARGET := $(BUILD_DIR)/arclis-lex
PARSER_SOURCE := $(BUILD_DIR)/parser.tab.c
PARSER_HEADER := $(BUILD_DIR)/parser.tab.h
PARSER_REPORT := $(BUILD_DIR)/parser.output
PARSER_TARGET := $(BUILD_DIR)/arclis-parse
API_TEST := $(BUILD_DIR)/test-lexer-api
PARSER_TRACE_TEST := $(BUILD_DIR)/test-parser-trace
AST_API_TEST := $(BUILD_DIR)/test-ast-api
CLI_SOURCES := cli_io.c lexer_diagnostics.c
SEMANTIC_SOURCES := semantic.c symbol_table.c
SEMANTIC_HEADERS := semantic.h symbol_table.h

.PHONY: all test clean

all: $(TARGET) $(PARSER_TARGET)

$(SCANNER): lexer.l
	mkdir -p "$(@D)"
	$(FLEX) -o "$@" "$<"

$(TARGET): lex_main.c lexer.h cli_io.h $(CLI_SOURCES) $(SCANNER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" lex_main.c $(CLI_SOURCES) "$(SCANNER)" $(LDLIBS)

$(PARSER_SOURCE) $(PARSER_HEADER) $(PARSER_REPORT) &: parser.y
	mkdir -p "$(BUILD_DIR)"
	$(BISON) -Wall -Werror=conflicts-sr -Werror=conflicts-rr --report=states,solved \
		--report-file="$(PARSER_REPORT)" --defines="$(PARSER_HEADER)" -o "$(PARSER_SOURCE)" "$<"

$(PARSER_TARGET): parse_main.c syntax.h ast.h ast.c ast_json.c lexer.h cli_io.h $(CLI_SOURCES) $(SEMANTIC_SOURCES) $(SEMANTIC_HEADERS) $(SCANNER) $(PARSER_SOURCE) $(PARSER_HEADER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" parse_main.c ast.c ast_json.c $(CLI_SOURCES) $(SEMANTIC_SOURCES) "$(SCANNER)" "$(PARSER_SOURCE)" $(LDLIBS)

$(API_TEST): ../tests/test_lexer_api.c lexer.h $(SCANNER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" "$<" "$(SCANNER)" $(LDLIBS)

$(PARSER_TRACE_TEST): ../tests/test_parser_trace.c syntax.h ast.h ast.c lexer.h lexer_diagnostics.c $(SCANNER) $(PARSER_SOURCE) $(PARSER_HEADER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -DARCLIS_SYNTAX_DEBUG=1 -I. -I"$(BUILD_DIR)" $(LDFLAGS) \
		-o "$@" "$<" ast.c lexer_diagnostics.c "$(SCANNER)" "$(PARSER_SOURCE)" $(LDLIBS)

$(AST_API_TEST): ../tests/test_ast_api.c syntax.h ast.h ast.c lexer.h lexer_diagnostics.c $(SCANNER) $(PARSER_SOURCE) $(PARSER_HEADER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) \
		-o "$@" "$<" ast.c lexer_diagnostics.c "$(SCANNER)" "$(PARSER_SOURCE)" $(LDLIBS)

test: $(TARGET) $(API_TEST) $(PARSER_TARGET) $(PARSER_TRACE_TEST) $(PARSER_REPORT) $(AST_API_TEST)
	$(PYTHON) ../tests/test_lexer.py "$(TARGET)"
	"$(API_TEST)"
	$(PYTHON) ../tests/test_parser.py "$(PARSER_TARGET)" "$(PARSER_TRACE_TEST)" "$(PARSER_REPORT)"
	$(PYTHON) ../tests/test_ast.py "$(PARSER_TARGET)"
	"$(AST_API_TEST)"

clean:
	$(RM) -- "$(SCANNER)" "$(TARGET)" "$(API_TEST)" \
		"$(PARSER_SOURCE)" "$(PARSER_HEADER)" "$(PARSER_REPORT)" "$(PARSER_TARGET)" "$(PARSER_TRACE_TEST)" "$(AST_API_TEST)"
