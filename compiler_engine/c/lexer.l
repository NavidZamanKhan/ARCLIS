%option reentrant noyywrap nodefault nounput noinput never-interactive 8bit
%option prefix="arclis_" extra-type="LexerState *"
%x COMMENT AFTER_INCLUDE SKIP_DIRECTIVE

%{
#include "lexer.h"

#include <stdbool.h>
#include <stdlib.h>

typedef struct {
    LexerPosition next;
    LexerPosition comment_start;
    LexerToken token;
    bool line_has_token;
    bool comment_after_include;
} LexerState;

static void record_match(LexerState *state, const char *text, size_t length)
{
    LexerPosition start = state->next;
    LexerPosition end = start;
    end.offset += length;

    for (size_t index = 0; index < length; ++index) {
        if (text[index] == '\r' || text[index] == '\n') {
            if (text[index] == '\r' && index + 1 < length && text[index + 1] == '\n') {
                ++index;
            }
            ++end.line;
            end.column = 1;
            state->line_has_token = false;
        } else {
            ++end.column;
        }
    }

    state->next = end;
    state->token = (LexerToken){.lexeme = text, .length = length, .range = {start, end}};
}

static int emit(LexerState *state, LexerTokenKind kind)
{
    state->token.kind = kind;
    state->line_has_token = true;
    return kind;
}

static int reject(LexerState *state, LexerDiagnostic diagnostic)
{
    state->token.diagnostic = diagnostic;
    return emit(state, LEX_ERROR);
}

static int reject_directive(LexerState *state, LexerDiagnostic diagnostic)
{
    return reject(state, state->line_has_token ? LEX_MISPLACED_DIRECTIVE : diagnostic);
}

#define YY_USER_ACTION record_match(yyextra, yytext, (size_t)yyleng);
%}

DIGIT           [0-9]
HEX             [0-9a-fA-F]
IDENTIFIER      [a-zA-Z_][a-zA-Z0-9_]*
KEYWORD         (int|float|double|char|void|static|if|else|while|for|return)
OTHER_CONTROL   (break|case|continue|default|do|goto|switch)
OTHER_TYPES     (enum|long|short|signed|struct|union|unsigned)
OTHER_SPECIFIER (auto|const|extern|inline|register|restrict|sizeof|typedef|volatile)
OTHER_C11       (_Alignas|_Alignof|_Atomic|_Bool|_Complex|_Generic|_Imaginary|_Noreturn|_Static_assert|_Thread_local)
RESERVED        ({OTHER_CONTROL}|{OTHER_TYPES}|{OTHER_SPECIFIER}|{OTHER_C11})
INTEGER_SUFFIX  ([uU]([lL]|ll|LL)?|([lL]|ll|LL)[uU]?)?
INTEGER         (0[xX]{HEX}+|0[0-7]*|[1-9]{DIGIT}*){INTEGER_SUFFIX}
DEC_EXPONENT    [eE][+-]?{DIGIT}+
BIN_EXPONENT    [pP][+-]?{DIGIT}+
DEC_FRACTION    ({DIGIT}+\.{DIGIT}*|\.{DIGIT}+)
HEX_FRACTION    ({HEX}+\.{HEX}*|\.{HEX}+|{HEX}+)
DEC_FLOAT       ({DEC_FRACTION}{DEC_EXPONENT}?|{DIGIT}+{DEC_EXPONENT})[fFlL]?
HEX_FLOAT       0[xX]{HEX_FRACTION}{BIN_EXPONENT}[fFlL]?
NUMBER          ({DIGIT}|\.{DIGIT})([a-zA-Z0-9_.]|[eEpP][+-])*
ESCAPE          \\([\\\'\"?abfnrtv]|[0-7]{1,3}|x{HEX}+|u{HEX}{4}|U{HEX}{8})
CONTINUATION    [\x80-\xbf]
UTF8_TWO        [\xc2-\xdf]{CONTINUATION}
UTF8_THREE      (\xe0[\xa0-\xbf]|[\xe1-\xec\xee-\xef]{CONTINUATION}|\xed[\x80-\x9f]){CONTINUATION}
UTF8_FOUR       (\xf0[\x90-\xbf]|[\xf1-\xf3]{CONTINUATION}|\xf4[\x80-\x8f]){CONTINUATION}{2}
UTF8            ({UTF8_TWO}|{UTF8_THREE}|{UTF8_FOUR})
STRING_CHAR     ([\t\x20-\x21\x23-\x5b\x5d-\x7e]|{UTF8}|{ESCAPE})
CHAR_VALUE      ([\x20-\x26\x28-\x5b\x5d-\x7e]|{UTF8}|{ESCAPE})
STRING_PREFIX   \"([^\"\\\r\n]|\\[^\r\n])*
CHAR_PREFIX     \'([^\'\\\r\n]|\\[^\r\n])*
NEWLINE         (\r\n|\r|\n)
SPACE           [ \t\v\f]
HEADER          (<[^>\r\n\x00]+>|\"[^\"\r\n\x00]+\")
INCLUDE         "#"{SPACE}*include

%%

<INITIAL,AFTER_INCLUDE>{SPACE}+     { /* Layout only. */ }
<INITIAL,AFTER_INCLUDE,SKIP_DIRECTIVE>{NEWLINE} { BEGIN(INITIAL); }

<INITIAL,AFTER_INCLUDE>"//"[^\r\n]* { /* Line comment. */ }
<INITIAL,AFTER_INCLUDE>"/*" {
    yyextra->comment_start = yyextra->token.range.start;
    yyextra->comment_after_include = YY_START == AFTER_INCLUDE;
    BEGIN(COMMENT);
}
<COMMENT>"*"+"/" {
    if (yyextra->comment_after_include && yyextra->next.line == yyextra->comment_start.line) {
        BEGIN(AFTER_INCLUDE);
    } else {
        BEGIN(INITIAL);
    }
}
<COMMENT>[^*\r\n]+                   { /* Comment body. */ }
<COMMENT>"*"+                        { /* Comment body. */ }
<COMMENT>{NEWLINE}                   { /* Comment newline. */ }
<COMMENT><<EOF>> {
    yyextra->token = (LexerToken){
        .lexeme = "/*",
        .length = 2,
        .range = {yyextra->comment_start, yyextra->next},
    };
    BEGIN(INITIAL);
    return reject(yyextra, LEX_UNTERMINATED_COMMENT);
}

<INITIAL>{INCLUDE}{SPACE}*{HEADER} {
    if (yyextra->line_has_token) {
        BEGIN(SKIP_DIRECTIVE);
        return reject(yyextra, LEX_MISPLACED_DIRECTIVE);
    }
    BEGIN(AFTER_INCLUDE);
    return emit(yyextra, LEX_INCLUDE);
}
<INITIAL>{INCLUDE} {
    BEGIN(SKIP_DIRECTIVE);
    return reject_directive(yyextra, LEX_INVALID_INCLUDE);
}
<INITIAL>("#"{SPACE}*{IDENTIFIER}|"#") {
    BEGIN(SKIP_DIRECTIVE);
    return reject_directive(yyextra, LEX_UNSUPPORTED_DIRECTIVE);
}
<AFTER_INCLUDE>. {
    BEGIN(SKIP_DIRECTIVE);
    return reject(yyextra, LEX_TRAILING_INCLUDE_TEXT);
}
<SKIP_DIRECTIVE>[^\r\n]+             { /* Recover at the next line. */ }

<INITIAL>\xEF\xBB\xBF {
    if (yyextra->token.range.start.offset != 0) {
        return reject(yyextra, LEX_INVALID_CHARACTER);
    }
    yyextra->next.column = 1;
}
<INITIAL>{KEYWORD}                   { return emit(yyextra, LEX_KEYWORD); }
<INITIAL>{RESERVED}                  { return reject(yyextra, LEX_UNSUPPORTED_KEYWORD); }
<INITIAL>{IDENTIFIER}                { return emit(yyextra, LEX_IDENTIFIER); }
<INITIAL>({DEC_FLOAT}|{HEX_FLOAT})     { return emit(yyextra, LEX_FLOATING); }
<INITIAL>{INTEGER}                   { return emit(yyextra, LEX_INTEGER); }
<INITIAL>{NUMBER}                    { return reject(yyextra, LEX_INVALID_NUMBER); }

<INITIAL>\"{STRING_CHAR}*\"          { return emit(yyextra, LEX_STRING); }
<INITIAL>{STRING_PREFIX}\"           { return reject(yyextra, LEX_INVALID_STRING); }
<INITIAL>{STRING_PREFIX}\\?          { return reject(yyextra, LEX_UNTERMINATED_STRING); }
<INITIAL>\'{CHAR_VALUE}\'            { return emit(yyextra, LEX_CHARACTER); }
<INITIAL>{CHAR_PREFIX}\'             { return reject(yyextra, LEX_INVALID_CHARACTER_LITERAL); }
<INITIAL>{CHAR_PREFIX}\\?            { return reject(yyextra, LEX_UNTERMINATED_CHARACTER); }

<INITIAL>"..."                       { return reject(yyextra, LEX_UNSUPPORTED_OPERATOR); }
<INITIAL>("<<="|">>="|"++"|"--"|"=="|"!="|"<="|">="|"&&"|"||"|"<<"|">>"|"->"|[+*/%&|^-]"=") {
    return emit(yyextra, LEX_OPERATOR);
}
<INITIAL>[-+*/%=<>!~&|^?:.]           { return emit(yyextra, LEX_OPERATOR); }
<INITIAL>[(){}\[\],;]                { return emit(yyextra, LEX_DELIMITER); }
<INITIAL>({UTF8}|.)                  { return reject(yyextra, LEX_INVALID_CHARACTER); }

<INITIAL,AFTER_INCLUDE,SKIP_DIRECTIVE><<EOF>> {
    yyextra->token = (LexerToken){
        .lexeme = "",
        .range = {yyextra->next, yyextra->next},
    };
    return LEX_EOF;
}

%%

struct Lexer {
    yyscan_t scanner;
    LexerState state;
};

int lexer_init(Lexer **result, FILE *source)
{
    Lexer *lexer = calloc(1, sizeof(*lexer));
    if (lexer == NULL) {
        return -1;
    }
    lexer->state.next = (LexerPosition){.line = 1, .column = 1};
    if (yylex_init_extra(&lexer->state, &lexer->scanner) != 0) {
        free(lexer);
        return -1;
    }
    yyset_in(source, lexer->scanner);
    *result = lexer;
    return 0;
}

LexerToken lexer_next(Lexer *lexer)
{
    yylex(lexer->scanner);
    return lexer->state.token;
}

void lexer_destroy(Lexer *lexer)
{
    yylex_destroy(lexer->scanner);
    free(lexer);
}
