#include "cli_io.h"

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

static void write_record(LexerToken token)
{
    printf("{\"kind\":\"%s\",\"lexeme\":", kind_names[token.kind]);
    cli_write_string(token.lexeme, token.length);
    fputs(",\"range\":", stdout);
    cli_write_range(token.range);
    if (token.kind == LEX_ERROR) {
        const LexerDiagnosticInfo *info = lexer_diagnostic_info(token.diagnostic);
        printf(",\"severity\":\"error\",\"code\":\"%s\",\"message\":", info->code);
        cli_write_string(info->message, strlen(info->message));
    }
    puts("}");
}

int main(int argc, char **argv)
{
    const char *tool = "arclis-lex";
    FILE *source = cli_open_source(argc, argv, tool);
    if (source == NULL) {
        return 2;
    }
    Lexer *lexer;
    if (lexer_init(&lexer, source) != 0) {
        fputs("arclis-lex: could not initialize the scanner\n", stderr);
        return cli_finish(source, 2, tool);
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
    return cli_finish(source, result, tool);
}
