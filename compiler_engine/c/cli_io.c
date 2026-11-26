#include "cli_io.h"

#include <string.h>

FILE *cli_open_source(int argc, char **argv, const char *tool)
{
    if (argc > 2) {
        fprintf(stderr, "Usage: %s [source-file|-]\n", tool);
        return NULL;
    }
    if (argc == 1 || strcmp(argv[1], "-") == 0) {
        return stdin;
    }
    FILE *source = fopen(argv[1], "rb");
    if (source == NULL) {
        perror(tool);
    }
    return source;
}

int cli_finish(FILE *source, int status, const char *tool)
{
    if (source != stdin && fclose(source) != 0) {
        fprintf(stderr, "%s: could not close input\n", tool);
        status = 2;
    }
    if (fflush(stdout) == EOF || ferror(stdout)) {
        fprintf(stderr, "%s: could not write output\n", tool);
        status = 2;
    }
    return status;
}

static size_t utf8_width(const unsigned char *bytes, size_t length)
{
    const unsigned char first = bytes[0];
    if (first < 0xc2 || first > 0xf4) {
        return 0;
    }
    const size_t width = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
    if (length < width) {
        return 0;
    }
    for (size_t index = 1; index < width; ++index) {
        if ((bytes[index] & 0xc0) != 0x80) {
            return 0;
        }
    }
    const unsigned char second = bytes[1];
    if ((first == 0xe0 && second < 0xa0) || (first == 0xed && second >= 0xa0)
        || (first == 0xf0 && second < 0x90) || (first == 0xf4 && second >= 0x90)) {
        return 0;
    }
    return width;
}

void cli_write_string(const char *text, size_t length)
{
    const unsigned char *bytes = (const unsigned char *)text;
    putchar('"');
    for (size_t index = 0; index < length; ++index) {
        const unsigned char byte = bytes[index];
        if (byte == '"' || byte == '\\') {
            putchar('\\');
            putchar(byte);
        } else if (byte >= 0x20 && byte <= 0x7e) {
            putchar(byte);
        } else {
            const size_t width = utf8_width(bytes + index, length - index);
            if (width != 0) {
                fwrite(bytes + index, 1, width, stdout);
                index += width - 1;
            } else {
                printf("\\u%04x", (unsigned int)byte);
            }
        }
    }
    putchar('"');
}

static void write_position(LexerPosition position)
{
    printf("{\"line\":%zu,\"column\":%zu,\"offset\":%zu}", position.line, position.column, position.offset);
}

void cli_write_range(LexerRange range)
{
    fputs("{\"start\":", stdout);
    write_position(range.start);
    fputs(",\"end\":", stdout);
    write_position(range.end);
    putchar('}');
}
