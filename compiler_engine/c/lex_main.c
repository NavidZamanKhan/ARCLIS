#include "lexer.h"

#include <string.h>

static const char *const kind_names[] = {
    [LEX_EOF] = "eof",
    [LEX_KEYWORD] = "keyword",
    [LEX_IDENTIFIER] = "identifier",
    [LEX_INTEGER] = "integer",
    [LEX_FLOATING] = "floating",
    [LEX_CHARACTER] = "character",
    [LEX_STRING] = "string",
    [LEX_OPERATOR] = "operator",
    [LEX_DELIMITER] = "delimiter",
    [LEX_INCLUDE] = "include",
    [LEX_ERROR] = "diagnostic",
};

static const struct {
    const char *code;
    const char *message;
} diagnostics[] = {
    [LEX_INVALID_CHARACTER] = {"invalid-character", "Unexpected character in C source."},
    [LEX_INVALID_NUMBER] = {"invalid-number", "Invalid integer or floating-point literal."},
    [LEX_INVALID_STRING] = {"invalid-string", "Invalid character or escape in string literal."},
    [LEX_INVALID_CHARACTER_LITERAL] = {"invalid-character-literal", "Use one character or escape in a character literal."},
    [LEX_UNTERMINATED_STRING] = {"unterminated-string", "Expected a closing double quote before the end of the line."},
    [LEX_UNTERMINATED_CHARACTER] = {"unterminated-character", "Expected a closing single quote before the end of the line."},
    [LEX_UNTERMINATED_COMMENT] = {"unterminated-comment", "Expected */ before the end of input."},
    [LEX_UNSUPPORTED_KEYWORD] = {"unsupported-keyword", "This keyword is outside the supported C subset."},
    [LEX_UNSUPPORTED_OPERATOR] = {"unsupported-operator", "Variadic declarations are outside the supported C subset."},
    [LEX_UNSUPPORTED_DIRECTIVE] = {"unsupported-directive", "Only simple #include directives are supported."},
    [LEX_INVALID_INCLUDE] = {"invalid-include", "Expected a nonempty quoted or angle-bracket header name."},
    [LEX_MISPLACED_DIRECTIVE] = {"misplaced-directive", "A directive must start before other tokens on its line."},
    [LEX_TRAILING_INCLUDE_TEXT] = {"trailing-include-text", "Only whitespace or comments may follow an include header."},
};

static size_t utf8_width(const unsigned char *bytes, size_t length)
{
    const unsigned char first = bytes[0];
    if (first < 0xc2 || first > 0xf4) {
        return 0;
    }

    const size_t width = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
    if (length < width) {
        return 0;
    }
    for (size_t index = 1; index < width; ++index) {
        if ((bytes[index] & 0xc0) != 0x80) {
            return 0;
        }
    }

    const unsigned char second = bytes[1];
    if ((first == 0xe0 && second < 0xa0) || (first == 0xed && second >= 0xa0)
        || (first == 0xf0 && second < 0x90) || (first == 0xf4 && second >= 0x90)) {
        return 0;
    }
    return width;
}

static void write_json_string(const char *text, size_t length)
{
    const unsigned char *bytes = (const unsigned char *)text;
    putchar('"');
    for (size_t index = 0; index < length; ++index) {
        const unsigned char byte = bytes[index];
        if (byte == '"' || byte == '\\') {
            putchar('\\');
            putchar(byte);
        } else if (byte >= 0x20 && byte <= 0x7e) {
            putchar(byte);
        } else {
            const size_t width = utf8_width(bytes + index, length - index);
            if (width != 0) {
                fwrite(bytes + index, 1, width, stdout);
                index += width - 1;
            } else {
                printf("\\u%04x", (unsigned int)byte);
            }
        }
    }
    putchar('"');
}

static void write_position(LexerPosition position)
{
    printf("{\"line\":%zu,\"column\":%zu,\"offset\":%zu}", position.line, position.column, position.offset);
}

static void write_record(LexerToken token)
{
    printf("{\"kind\":\"%s\",\"lexeme\":", kind_names[token.kind]);
    write_json_string(token.lexeme, token.length);
    fputs(",\"range\":{\"start\":", stdout);
    write_position(token.range.start);
    fputs(",\"end\":", stdout);
    write_position(token.range.end);
    putchar('}');
    if (token.kind == LEX_ERROR) {
        const char *code = diagnostics[token.diagnostic].code;
        const char *message = diagnostics[token.diagnostic].message;
        printf(",\"severity\":\"error\",\"code\":\"%s\",\"message\":", code);
        write_json_string(message, strlen(message));
    }
    puts("}");
}

int main(int argc, char **argv)
{
    if (argc > 2) {
        fputs("Usage: arclis-lex [source-file|-]\n", stderr);
        return 2;
    }
    FILE *source = stdin;
    if (argc == 2 && strcmp(argv[1], "-") != 0) {
        source = fopen(argv[1], "rb");
        if (source == NULL) {
            perror("arclis-lex");
            return 2;
        }
    }

    Lexer *lexer;
    if (lexer_init(&lexer, source) != 0) {
        fputs("arclis-lex: could not initialize the scanner\n", stderr);
        if (source != stdin) {
            fclose(source);
        }
        return 2;
    }

    int result = 0;
    for (;;) {
        const LexerToken token = lexer_next(lexer);
        write_record(token);
        if (token.kind == LEX_EOF) {
            break;
        }
        if (token.kind == LEX_ERROR) {
            result = 1;
        }
    }
    lexer_destroy(lexer);
    if (source != stdin && fclose(source) != 0) {
        perror("arclis-lex: close input");
        result = 2;
    }
    if (fflush(stdout) == EOF || ferror(stdout)) {
        fputs("arclis-lex: could not write scanner output\n", stderr);
        result = 2;
    }
    return result;
}
