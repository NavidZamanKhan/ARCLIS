#ifndef ARCLIS_LEXER_H
#define ARCLIS_LEXER_H

#include <stddef.h>
#include <stdio.h>

typedef struct {
    size_t offset;
    size_t line;
    size_t column;
} LexerPosition;

typedef struct {
    LexerPosition start;
    LexerPosition end;
} LexerRange;

typedef enum {
    LEX_EOF = 0,
    LEX_KEYWORD,
    LEX_IDENTIFIER,
    LEX_INTEGER,
    LEX_FLOATING,
    LEX_CHARACTER,
    LEX_STRING,
    LEX_OPERATOR,
    LEX_DELIMITER,
    LEX_INCLUDE,
    LEX_ERROR,
} LexerTokenKind;

typedef enum {
    LEX_NO_DIAGNOSTIC = 0,
    LEX_INVALID_CHARACTER,
    LEX_INVALID_NUMBER,
    LEX_INVALID_STRING,
    LEX_INVALID_CHARACTER_LITERAL,
    LEX_UNTERMINATED_STRING,
    LEX_UNTERMINATED_CHARACTER,
    LEX_UNTERMINATED_COMMENT,
    LEX_UNSUPPORTED_KEYWORD,
    LEX_UNSUPPORTED_OPERATOR,
    LEX_UNSUPPORTED_DIRECTIVE,
    LEX_INVALID_INCLUDE,
    LEX_MISPLACED_DIRECTIVE,
    LEX_TRAILING_INCLUDE_TEXT,
} LexerDiagnostic;

typedef struct {
    const char *code;
    const char *message;
} LexerDiagnosticInfo;

const LexerDiagnosticInfo *lexer_diagnostic_info(LexerDiagnostic diagnostic);

typedef struct {
    LexerTokenKind kind;
    LexerDiagnostic diagnostic;
    const char *lexeme;
    size_t length;
    LexerRange range;
} LexerToken;

typedef struct Lexer Lexer;

/* The caller retains ownership of source. */
int lexer_init(Lexer **lexer, FILE *source);
/* The scanner copies the source bytes during initialization. */
int lexer_init_bytes(Lexer **lexer, const char *source, size_t length);
/* Lexeme bytes are borrowed until the next call to lexer_next or lexer_destroy. */
LexerToken lexer_next(Lexer *lexer);
void lexer_destroy(Lexer *lexer);

#endif
