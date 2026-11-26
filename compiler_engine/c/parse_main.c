#include "cli_io.h"
#include "syntax.h"

#include <string.h>

static void write_diagnostic(const SyntaxDiagnostic *diagnostic, void *user)
{
    size_t *count = user;
    ++*count;
    printf("{\"kind\":\"diagnostic\",\"phase\":\"%s\",\"severity\":\"error\",\"code\":",
           diagnostic->phase == SYNTAX_PHASE_LEXICAL ? "lexical" : "syntax");
    cli_write_string(diagnostic->code, strlen(diagnostic->code));
    fputs(",\"message\":", stdout);
    cli_write_string(diagnostic->message, strlen(diagnostic->message));
    fputs(",\"range\":", stdout);
    cli_write_range(diagnostic->range);
    puts("}");
}

int main(int argc, char **argv)
{
    const char *tool = "arclis-parse";
    FILE *source = cli_open_source(argc, argv, tool);
    if (source == NULL) {
        return SYNTAX_FAILURE;
    }

    size_t count = 0;
    const SyntaxStatus status = syntax_analyze(source, write_diagnostic, &count);
    if (status == SYNTAX_FAILURE && count == 0) {
        fputs("arclis-parse: could not initialize the parser\n", stderr);
    }
    printf("{\"kind\":\"syntax-result\",\"valid\":%s,\"diagnostics\":%zu}\n",
           status == SYNTAX_VALID ? "true" : "false", count);
    return cli_finish(source, status, tool);
}
