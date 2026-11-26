FLEX ?= flex
PYTHON ?= python3
CFLAGS ?= -std=c17 -Wall -Wextra -Wpedantic -O2
BUILD_DIR ?= build
SCANNER := $(BUILD_DIR)/lexer.yy.c
TARGET := $(BUILD_DIR)/arclis-lex

.PHONY: all clean

all: $(TARGET)

$(SCANNER): lexer.l
	mkdir -p "$(@D)"
	$(FLEX) -o "$@" "$<"

$(TARGET): lex_main.c lexer.h $(SCANNER)
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. $(LDFLAGS) -o "$@" lex_main.c "$(SCANNER)" $(LDLIBS)

clean:
	$(RM) -- "$(SCANNER)" "$(TARGET)"
