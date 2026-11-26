#include "cli_io.h"
#include "syntax.h"

#include <string.h>

static void write_diagnostic(const SyntaxDiagnostic *diagnostic, void *user)
{
    size_t *count = user;
    ++*count;
    printf("{\"kind\":\"diagnostic\",\"phase\":\"%s\",\"severity\":\"error\",\"code\":",
           diagnostic->phase == SYNTAX_PHASE_LEXICAL ? "lexical" : "syntax");
    cli_write_string(stdout, diagnostic->code, strlen(diagnostic->code));
    fputs(",\"message\":", stdout);
    cli_write_string(stdout, diagnostic->message, strlen(diagnostic->message));
    fputs(",\"range\":", stdout);
    cli_write_range(stdout, diagnostic->range);
    puts("}");
}

int main(int argc, char **argv)
{
    const char *tool = "arclis-parse";
    const bool with_ast = argc > 1 && strcmp(argv[1], "--ast") == 0;
    if (argc > (with_ast ? 3 : 2)) {
        fputs("Usage: arclis-parse [--ast] [source-file|-]\n", stderr);
        return SYNTAX_FAILURE;
    }
    FILE *source = cli_open_source(argc - with_ast, argv + with_ast, tool);
    if (source == NULL) {
        return SYNTAX_FAILURE;
    }

    size_t count = 0;
    AstTree *tree = NULL;
    const SyntaxStatus status = with_ast
        ? syntax_analyze_ast(source, &tree, write_diagnostic, &count)
        : syntax_analyze(source, write_diagnostic, &count);
    if (tree != NULL) {
        fputs("{\"kind\":\"ast\",\"root\":", stdout);
        ast_write_json(stdout, tree);
        puts("}");
        ast_destroy(tree);
    }
    if (status == SYNTAX_FAILURE && count == 0) {
        fputs("arclis-parse: could not initialize the parser\n", stderr);
    }
    printf("{\"kind\":\"syntax-result\",\"valid\":%s,\"diagnostics\":%zu}\n",
           status == SYNTAX_VALID ? "true" : "false", count);
    return cli_finish(source, status, tool);
}
