FLEX ?= flex
PYTHON ?= python3
CFLAGS ?= -std=c17 -Wall -Wextra -Wpedantic -O2
BUILD_DIR ?= build
SCANNER := $(BUILD_DIR)/lexer.yy.c
TARGET := $(BUILD_DIR)/arclis-lex
API_TEST := $(BUILD_DIR)/test-lexer-api

.PHONY: all test clean

all: $(TARGET)

$(SCANNER): lexer.l
	mkdir -p "$(@D)"
	$(FLEX) -o "$@" "$<"

$(TARGET): lex_main.c lexer.h $(SCANNER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" lex_main.c "$(SCANNER)" $(LDLIBS)

$(API_TEST): ../tests/test_lexer_api.c lexer.h $(SCANNER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" "$<" "$(SCANNER)" $(LDLIBS)

test: $(TARGET) $(API_TEST)
	$(PYTHON) ../tests/test_lexer.py "$(TARGET)"
	"$(API_TEST)"

clean:
	$(RM) -- "$(SCANNER)" "$(TARGET)" "$(API_TEST)"
