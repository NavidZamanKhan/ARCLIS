#include "lexer.h"

static const LexerDiagnosticInfo diagnostics[] = {
    [LEX_INVALID_CHARACTER] = {"invalid-character", "Unexpected character in C source."},
    [LEX_INVALID_NUMBER] = {"invalid-number", "Invalid integer or floating-point literal."},
    [LEX_INVALID_STRING] = {"invalid-string", "Invalid character or escape in string literal."},
    [LEX_INVALID_CHARACTER_LITERAL] = {"invalid-character-literal", "Use one character or escape in a character literal."},
    [LEX_UNTERMINATED_STRING] = {"unterminated-string", "Expected a closing double quote before the end of the line."},
    [LEX_UNTERMINATED_CHARACTER] = {"unterminated-character", "Expected a closing single quote before the end of the line."},
    [LEX_UNTERMINATED_COMMENT] = {"unterminated-comment", "Expected */ before the end of input."},
    [LEX_UNSUPPORTED_KEYWORD] = {"unsupported-keyword", "This keyword is outside the supported C subset."},
    [LEX_UNSUPPORTED_OPERATOR] = {"unsupported-operator", "Variadic declarations are outside the supported C subset."},
    [LEX_UNSUPPORTED_DIRECTIVE] = {"unsupported-directive", "Only simple #include directives are supported."},
    [LEX_INVALID_INCLUDE] = {"invalid-include", "Expected a nonempty quoted or angle-bracket header name."},
    [LEX_MISPLACED_DIRECTIVE] = {"misplaced-directive", "A directive must start before other tokens on its line."},
    [LEX_TRAILING_INCLUDE_TEXT] = {"trailing-include-text", "Only whitespace or comments may follow an include header."},
};

const LexerDiagnosticInfo *lexer_diagnostic_info(LexerDiagnostic diagnostic)
{
    if (diagnostic == LEX_NO_DIAGNOSTIC || (size_t)diagnostic >= sizeof(diagnostics) / sizeof(diagnostics[0])) {
        return NULL;
    }
    return &diagnostics[diagnostic];
}
