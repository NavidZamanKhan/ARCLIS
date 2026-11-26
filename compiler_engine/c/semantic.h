#ifndef ARCLIS_SEMANTIC_H
#define ARCLIS_SEMANTIC_H

#include "symbol_table.h"

typedef enum {
    SEMANTIC_VALID = 0,
    SEMANTIC_INVALID = 1,
    SEMANTIC_FAILURE = 2,
} SemanticStatus;

typedef struct {
    const char *code;
    const char *message;
    LexerRange range;
} SemanticDiagnostic;

/* The diagnostic is valid for the duration of the callback. */
typedef void (*SemanticDiagnosticSink)(const SemanticDiagnostic *diagnostic, void *user);

/* Pass a successfully parsed AST and an uninitialized or empty table. Destroy
 * the result with symbol_table_destroy before destroying the tree. A null
 * diagnostic sink still detects errors. */
SemanticStatus semantic_analyze(const AstTree *tree, SymbolTable *table, SemanticDiagnosticSink sink, void *user);

#endif
