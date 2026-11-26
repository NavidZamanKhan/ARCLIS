#include "cli_io.h"
#include "ir.h"
#include "semantic.h"
#include "syntax.h"

#include <string.h>

static void write_diagnostic(const char *phase, const char *code, const char *message, LexerRange range, size_t *count)
{
    ++*count;
    printf("{\"kind\":\"diagnostic\",\"phase\":\"%s\",\"severity\":\"error\",\"code\":", phase);
    cli_write_string(stdout, code, strlen(code));
    fputs(",\"message\":", stdout);
    cli_write_string(stdout, message, strlen(message));
    fputs(",\"range\":", stdout);
    cli_write_range(stdout, range);
    puts("}");
}

static void write_syntax_diagnostic(const SyntaxDiagnostic *diagnostic, void *user)
{
    const char *phase = diagnostic->phase == SYNTAX_PHASE_LEXICAL ? "lexical" : "syntax";
    write_diagnostic(phase, diagnostic->code, diagnostic->message, diagnostic->range, user);
}

static void write_semantic_diagnostic(const SemanticDiagnostic *diagnostic, void *user)
{
    write_diagnostic("semantic", diagnostic->code, diagnostic->message, diagnostic->range, user);
}

static int write_semantic_analysis(SyntaxStatus syntax_status, const AstTree *tree, bool with_ir)
{
    size_t count = 0;
    const char *valid = "null";
    int exit_code = syntax_status;
    IrProgram *ir = NULL;
    if (syntax_status == SYNTAX_VALID) {
        SymbolTable table;
        const SemanticStatus status = semantic_analyze(tree, &table, write_semantic_diagnostic, &count);
        if (status == SEMANTIC_FAILURE) {
            fputs("arclis-parse: could not allocate the symbol table\n", stderr);
        } else {
            valid = status == SEMANTIC_VALID ? "true" : "false";
            symbol_table_write_json(stdout, &table);
            putchar('\n');
        }
        exit_code = status;
        if (with_ir && status == SEMANTIC_VALID) {
            ir = ir_generate(tree, &table);
            if (ir == NULL) {
                fputs("arclis-parse: could not generate intermediate code\n", stderr);
                exit_code = SYNTAX_FAILURE;
            }
        }
        symbol_table_destroy(&table);
    }
    printf("{\"kind\":\"semantic-result\",\"valid\":%s,\"diagnostics\":%zu}\n", valid, count);
    if (with_ir) {
        if (ir != NULL) {
            ir_write_json(stdout, ir);
            putchar('\n');
            ir_destroy(ir);
        }
        printf("{\"kind\":\"ir-result\",\"generated\":%s}\n", exit_code == SYNTAX_VALID ? "true" : "false");
    }
    return exit_code;
}

int main(int argc, char **argv)
{
    const char *tool = "arclis-parse";
    const bool with_ast = argc > 1 && strcmp(argv[1], "--ast") == 0;
    const bool with_ir = argc > 1 && strcmp(argv[1], "--ir") == 0;
    const bool with_semantics = with_ir || (argc > 1 && strcmp(argv[1], "--semantic") == 0);
    const bool has_mode = with_ast || with_semantics;
    if (argc > 2 + has_mode) {
        fputs("Usage: arclis-parse [--ast | --semantic | --ir] [source-file|-]\n", stderr);
        return SYNTAX_FAILURE;
    }
    FILE *source = cli_open_source(argc - has_mode, argv + has_mode, tool);
    if (source == NULL) {
        return SYNTAX_FAILURE;
    }

    size_t count = 0;
    AstTree *tree = NULL;
    const SyntaxStatus status = has_mode
        ? syntax_analyze_ast(source, &tree, write_syntax_diagnostic, &count)
        : syntax_analyze(source, write_syntax_diagnostic, &count);
    if (with_ast && tree != NULL) {
        fputs("{\"kind\":\"ast\",\"root\":", stdout);
        ast_write_json(stdout, tree);
        puts("}");
    }
    if (status == SYNTAX_FAILURE && count == 0) {
        fputs("arclis-parse: could not initialize the parser\n", stderr);
    }
    printf("{\"kind\":\"syntax-result\",\"valid\":%s,\"diagnostics\":%zu}\n",
           status == SYNTAX_VALID ? "true" : "false", count);
    const int exit_code = with_semantics ? write_semantic_analysis(status, tree, with_ir) : (int)status;
    ast_destroy(tree);
    return cli_finish(source, exit_code, tool);
}
