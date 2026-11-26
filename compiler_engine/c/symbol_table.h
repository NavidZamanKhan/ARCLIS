#ifndef ARCLIS_SYMBOL_TABLE_H
#define ARCLIS_SYMBOL_TABLE_H

#include "ast.h"

typedef enum {
    SCOPE_FILE,
    SCOPE_FUNCTION,
    SCOPE_PROTOTYPE,
    SCOPE_BLOCK,
    SCOPE_FOR,
} ScopeKind;

typedef enum {
    SYMBOL_VARIABLE,
    SYMBOL_PARAMETER,
    SYMBOL_FUNCTION,
} SymbolKind;

typedef struct {
    ScopeKind kind;
    size_t parent;
    LexerRange range;
    size_t last_symbol;
} SymbolScope;

typedef struct {
    SymbolKind kind;
    AstText name;
    AstType type;
    bool is_static;
    size_t scope;
    const AstNode *declaration;
    const AstNode *definition;
    size_t previous;
} Symbol;

typedef struct {
    SymbolScope *scopes;
    Symbol *symbols;
    size_t scope_count;
    size_t symbol_count;
} SymbolTable;

/* Scope and symbol IDs are one-based. Each AST node contributes at most one
 * scope and one symbol. Text and declaration pointers borrow the AST. */
bool symbol_table_create(SymbolTable *table, size_t node_count);
void symbol_table_destroy(SymbolTable *table);
size_t symbol_scope_add(SymbolTable *table, ScopeKind kind, size_t parent, LexerRange range);
Symbol *symbol_find_local(const SymbolTable *table, size_t scope, AstText name);
const Symbol *symbol_resolve(const SymbolTable *table, size_t scope, AstText name);
void symbol_add(SymbolTable *table, Symbol symbol);
void symbol_table_write_json(FILE *output, const SymbolTable *table);

#endif
