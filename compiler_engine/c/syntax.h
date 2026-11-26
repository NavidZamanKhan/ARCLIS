#ifndef ARCLIS_SYNTAX_H
#define ARCLIS_SYNTAX_H

#include "ast.h"

typedef enum {
    SYNTAX_VALID = 0,
    SYNTAX_INVALID = 1,
    SYNTAX_FAILURE = 2,
} SyntaxStatus;

typedef enum {
    SYNTAX_PHASE_LEXICAL,
    SYNTAX_PHASE_GRAMMAR,
} SyntaxPhase;

typedef struct {
    SyntaxPhase phase;
    const char *code;
    const char *message;
    LexerRange range;
} SyntaxDiagnostic;

/* The diagnostic and its strings are valid for the duration of the callback. */
typedef void (*SyntaxDiagnosticSink)(const SyntaxDiagnostic *diagnostic, void *user);

/* The caller retains ownership of source. A null sink still detects errors. */
SyntaxStatus syntax_analyze(FILE *source, SyntaxDiagnosticSink sink, void *user);
/* On success the caller owns *tree. On failure *tree is null. */
SyntaxStatus syntax_analyze_ast(FILE *source, AstTree **tree, SyntaxDiagnosticSink sink, void *user);

#endif
