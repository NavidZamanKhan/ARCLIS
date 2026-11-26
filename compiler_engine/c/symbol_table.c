#include "symbol_table.h"
#include "cli_io.h"

#include <stdlib.h>
#include <string.h>

bool symbol_table_create(SymbolTable *table, size_t node_count)
{
    *table = (SymbolTable){0};
    table->scopes = calloc(node_count, sizeof(*table->scopes));
    table->symbols = calloc(node_count, sizeof(*table->symbols));
    if (table->scopes == NULL || table->symbols == NULL) {
        symbol_table_destroy(table);
        return false;
    }
    return true;
}

void symbol_table_destroy(SymbolTable *table)
{
    free(table->scopes);
    free(table->symbols);
    *table = (SymbolTable){0};
}

size_t symbol_scope_add(SymbolTable *table, ScopeKind kind, size_t parent, LexerRange range)
{
    table->scopes[table->scope_count] = (SymbolScope){.kind = kind, .parent = parent, .range = range};
    return ++table->scope_count;
}

Symbol *symbol_find_local(const SymbolTable *table, size_t scope, AstText name)
{
    for (size_t id = table->scopes[scope - 1].last_symbol; id != 0;) {
        Symbol *symbol = &table->symbols[id - 1];
        if (name.length == symbol->name.length && memcmp(name.data, symbol->name.data, name.length) == 0) {
            return symbol;
        }
        id = symbol->previous;
    }
    return NULL;
}

const Symbol *symbol_resolve(const SymbolTable *table, size_t scope, AstText name)
{
    for (; scope != 0; scope = table->scopes[scope - 1].parent) {
        const Symbol *symbol = symbol_find_local(table, scope, name);
        if (symbol != NULL) {
            return symbol;
        }
    }
    return NULL;
}

void symbol_add(SymbolTable *table, Symbol symbol)
{
    SymbolScope *scope = &table->scopes[symbol.scope - 1];
    symbol.previous = scope->last_symbol;
    table->symbols[table->symbol_count] = symbol;
    scope->last_symbol = ++table->symbol_count;
}

static void write_parameter_types(FILE *output, const AstNode *parameter)
{
    fputs(",\"parameterTypes\":[", output);
    for (; parameter != NULL; parameter = parameter->next) {
        fprintf(output, "\"%s\"%s", ast_type_name(parameter->as.parameter.type), parameter->next == NULL ? "" : ",");
    }
    fputc(']', output);
}

void symbol_table_write_json(FILE *output, const SymbolTable *table)
{
    static const char *const scope_names[] = {"file", "function", "prototype", "block", "for"};
    static const char *const symbol_names[] = {"variable", "parameter", "function"};

    fputs("{\"kind\":\"symbols\",\"scopes\":[", output);
    for (size_t index = 0; index < table->scope_count; ++index) {
        const SymbolScope *scope = &table->scopes[index];
        fprintf(output, "%s{\"id\":%zu,\"kind\":\"%s\",\"parent\":", index ? "," : "", index + 1,
                scope_names[scope->kind]);
        if (scope->parent == 0) {
            fputs("null", output);
        } else {
            fprintf(output, "%zu", scope->parent);
        }
        fputs(",\"range\":", output);
        cli_write_range(output, scope->range);
        fputc('}', output);
    }

    fputs("],\"symbols\":[", output);
    for (size_t index = 0; index < table->symbol_count; ++index) {
        const Symbol *symbol = &table->symbols[index];
        fprintf(output, "%s{\"scope\":%zu,\"kind\":\"%s\",\"name\":", index ? "," : "", symbol->scope,
                symbol_names[symbol->kind]);
        cli_write_string(output, symbol->name.data, symbol->name.length);
        fprintf(output, ",\"type\":\"%s\",\"static\":%s,\"range\":", ast_type_name(symbol->type),
                symbol->is_static ? "true" : "false");
        cli_write_range(output, symbol->declaration->range);
        if (symbol->kind == SYMBOL_FUNCTION) {
            write_parameter_types(output, symbol->declaration->as.function.parameters.first);
        }
        fputs(",\"definitionRange\":", output);
        if (symbol->definition == NULL) {
            fputs("null", output);
        } else {
            cli_write_range(output, symbol->definition->range);
        }
        fputc('}', output);
    }
    fputs("]}", output);
}
