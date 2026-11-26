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
CLI_SOURCES := cli_io.c lexer_diagnostics.c

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

$(PARSER_TARGET): parse_main.c syntax.h lexer.h cli_io.h $(CLI_SOURCES) $(SCANNER) $(PARSER_SOURCE) $(PARSER_HEADER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" parse_main.c $(CLI_SOURCES) "$(SCANNER)" "$(PARSER_SOURCE)" $(LDLIBS)

$(API_TEST): ../tests/test_lexer_api.c lexer.h $(SCANNER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" "$<" "$(SCANNER)" $(LDLIBS)

test: $(TARGET) $(API_TEST)
	$(PYTHON) ../tests/test_lexer.py "$(TARGET)"
	"$(API_TEST)"

clean:
	$(RM) -- "$(SCANNER)" "$(TARGET)" "$(API_TEST)" \
		"$(PARSER_SOURCE)" "$(PARSER_HEADER)" "$(PARSER_REPORT)" "$(PARSER_TARGET)"
