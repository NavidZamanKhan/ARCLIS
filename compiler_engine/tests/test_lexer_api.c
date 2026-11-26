#include "lexer.h"

#include <stdbool.h>
#include <string.h>

static FILE *source(const char *text)
{
    FILE *file = tmpfile();
    if (file == NULL) {
        return NULL;
    }
    if (fputs(text, file) == EOF || fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        return NULL;
    }
    return file;
}

static bool expect(Lexer *lexer, LexerTokenKind kind, const char *lexeme, size_t line, size_t column)
{
    const LexerToken token = lexer_next(lexer);
    return token.kind == kind && token.length == strlen(lexeme)
        && memcmp(token.lexeme, lexeme, token.length) == 0
        && token.range.start.line == line && token.range.start.column == column;
}

int main(void)
{
    FILE *first_source = source("int\r\nx");
    FILE *second_source = source("/* a comment */\t5");
    Lexer *first = NULL;
    Lexer *second = NULL;
    bool passed = first_source != NULL && second_source != NULL
        && lexer_init(&first, first_source) == 0 && lexer_init(&second, second_source) == 0
        && expect(first, LEX_KEYWORD, "int", 1, 1) && expect(second, LEX_INTEGER, "5", 1, 17)
        && expect(first, LEX_IDENTIFIER, "x", 2, 1) && expect(second, LEX_EOF, "", 1, 18)
        && expect(first, LEX_EOF, "", 2, 2);
    if (first != NULL) {
        lexer_destroy(first);
    }
    if (second != NULL) {
        lexer_destroy(second);
    }
    if (first_source != NULL) {
        fclose(first_source);
    }
    if (second_source != NULL) {
        fclose(second_source);
    }
    puts(passed ? "Interleaved lexer instances passed." : "Interleaved lexer instances failed.");
    return passed ? 0 : 1;
}
