#include "cli_io.h"

#include <string.h>

FILE *cli_open_source(int argc, char **argv, const char *tool)
{
    if (argc > 2) {
        fprintf(stderr, "Usage: %s [source-file|-]\n", tool);
        return NULL;
    }
    if (argc < 2 || strcmp(argv[1], "-") == 0) {
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

void cli_write_string(FILE *output, const char *text, size_t length)
{
    const unsigned char *bytes = (const unsigned char *)text;
    fputc('"', output);
    for (size_t index = 0; index < length; ++index) {
        const unsigned char byte = bytes[index];
        if (byte == '"' || byte == '\\') {
            fputc('\\', output);
            fputc(byte, output);
        } else if (byte >= 0x20 && byte <= 0x7e) {
            fputc(byte, output);
        } else {
            const size_t width = utf8_width(bytes + index, length - index);
            if (width != 0) {
                fwrite(bytes + index, 1, width, output);
                index += width - 1;
            } else {
                fprintf(output, "\\u%04x", (unsigned int)byte);
            }
        }
    }
    fputc('"', output);
}

static void write_position(FILE *output, LexerPosition position)
{
    fprintf(output, "{\"line\":%zu,\"column\":%zu,\"offset\":%zu}", position.line, position.column, position.offset);
}

void cli_write_range(FILE *output, LexerRange range)
{
    fputs("{\"start\":", output);
    write_position(output, range.start);
    fputs(",\"end\":", output);
    write_position(output, range.end);
    fputc('}', output);
}
