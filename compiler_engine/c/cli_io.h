#ifndef ARCLIS_CLI_IO_H
#define ARCLIS_CLI_IO_H

#include "lexer.h"

FILE *cli_open_source(int argc, char **argv, const char *tool);
int cli_finish(FILE *source, int status, const char *tool);
void cli_write_string(const char *text, size_t length);
void cli_write_range(LexerRange range);

#endif
