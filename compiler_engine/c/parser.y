%require "3.8"
%define api.prefix {arclis_syntax_}
%define api.pure full
%define api.location.type {LexerRange}
%define parse.error detailed
%define parse.lac full
%locations
%expect 0
%parse-param {SyntaxContext *context}
%lex-param {SyntaxContext *context}

%code requires {
#include "syntax.h"

typedef struct SyntaxContext SyntaxContext;
}

%code top {
#define YYLOCATION_PRINT(Stream, Location)                         \
    fprintf(Stream, "@%zu-%zu", (Location)->start.offset, (Location)->end.offset)

#define YYLLOC_DEFAULT(Current, Rhs, Count)                         \
    do {                                                          \
        (Current).start = (Count) ? YYRHSLOC(Rhs, 1).start          \
                                  : YYRHSLOC(Rhs, 0).end;          \
        (Current).end = YYRHSLOC(Rhs, Count).end;                   \
    } while (0)
}

%code {
#include <stdbool.h>
#include <string.h>

struct SyntaxContext {
    Lexer *lexer;
    SyntaxDiagnosticSink sink;
    void *user;
    int lookahead;
    bool had_error;
};

static int yylex(YYSTYPE *value, YYLTYPE *location, SyntaxContext *context);
static void yyerror(const YYLTYPE *location, SyntaxContext *context, const char *message);
}

%initial-action {
    @$ = (LexerRange){
        .start = {.line = 1, .column = 1},
        .end = {.line = 1, .column = 1},
    };
}

%token IDENTIFIER "identifier"
%token INTEGER "integer literal"
%token FLOATING "floating-point literal"
%token CHARACTER "character literal"
%token STRING "string literal"
%token INCLUDE "include directive"
%token INT "int" FLOAT "float" DOUBLE "double" CHAR "char" VOID "void" STATIC "static"
%token IF "if" ELSE "else" WHILE "while" FOR "for" RETURN "return"
%token EQ "==" NE "!=" LE "<=" GE ">=" AND "&&" OR "||" INC "++" DEC "--"
%token ADD_ASSIGN "+=" SUB_ASSIGN "-=" MUL_ASSIGN "*=" DIV_ASSIGN "/=" MOD_ASSIGN "%="

/* Resolve the dangling else in favor of the closest unmatched if. */
%precedence IF_WITHOUT_ELSE
%precedence ELSE

%%

translation_unit:
    %empty
  | translation_unit external_item
  | translation_unit error ';' { yyerrok; }
  ;

external_item:
    INCLUDE
  | declaration_specifiers IDENTIFIER external_suffix
  ;

external_suffix:
    '(' parameter_clause ')' function_end
  | initializer_opt additional_declarators ';'
  ;

function_end:
    ';'
  | compound_statement
  ;

declaration_specifiers:
    type_specifier
  | STATIC type_specifier
  ;

type_specifier:
    value_type
  | VOID
  ;

value_type:
    INT
  | FLOAT
  | DOUBLE
  | CHAR
  ;

parameter_clause:
    %empty
  | VOID
  | parameter_list
  ;

parameter_list:
    parameter
  | parameter_list ',' parameter
  ;

parameter:
    value_type
  | value_type IDENTIFIER
  | VOID IDENTIFIER
  ;

declaration:
    declaration_specifiers IDENTIFIER initializer_opt additional_declarators ';'
  ;

initializer_opt:
    %empty
  | '=' assignment_expression
  ;

additional_declarators:
    %empty
  | additional_declarators ',' IDENTIFIER initializer_opt
  ;

compound_statement:
    '{' block_items '}'
  ;

block_items:
    %empty
  | block_items declaration
  | block_items statement
  | block_items error ';' { yyerrok; }
  ;

statement:
    compound_statement
  | expression_opt ';'
  | RETURN expression_opt ';'
  | IF '(' expression ')' statement %prec IF_WITHOUT_ELSE
  | IF '(' expression ')' statement ELSE statement
  | WHILE '(' expression ')' statement
  | FOR '(' for_initializer expression_opt ';' expression_opt ')' statement
  ;

for_initializer:
    declaration
  | expression_opt ';'
  ;

expression_opt:
    %empty
  | expression
  ;

expression:
    assignment_expression
  | expression ',' assignment_expression
  ;

assignment_expression:
    logical_or_expression
  | unary_expression assignment_operator assignment_expression
  ;

assignment_operator:
    '='
  | ADD_ASSIGN
  | SUB_ASSIGN
  | MUL_ASSIGN
  | DIV_ASSIGN
  | MOD_ASSIGN
  ;

logical_or_expression:
    logical_and_expression
  | logical_or_expression OR logical_and_expression
  ;

logical_and_expression:
    equality_expression
  | logical_and_expression AND equality_expression
  ;

equality_expression:
    relational_expression
  | equality_expression EQ relational_expression
  | equality_expression NE relational_expression
  ;

relational_expression:
    additive_expression
  | relational_expression '<' additive_expression
  | relational_expression '>' additive_expression
  | relational_expression LE additive_expression
  | relational_expression GE additive_expression
  ;

additive_expression:
    multiplicative_expression
  | additive_expression '+' multiplicative_expression
  | additive_expression '-' multiplicative_expression
  ;

multiplicative_expression:
    unary_expression
  | multiplicative_expression '*' unary_expression
  | multiplicative_expression '/' unary_expression
  | multiplicative_expression '%' unary_expression
  ;

unary_expression:
    postfix_expression
  | '+' unary_expression
  | '-' unary_expression
  | '!' unary_expression
  | INC unary_expression
  | DEC unary_expression
  ;

postfix_expression:
    primary_expression
  | postfix_expression '(' arguments_opt ')'
  | postfix_expression INC
  | postfix_expression DEC
  ;

arguments_opt:
    %empty
  | arguments
  ;

arguments:
    assignment_expression
  | arguments ',' assignment_expression
  ;

primary_expression:
    IDENTIFIER
  | INTEGER
  | FLOATING
  | CHARACTER
  | string_literals
  | '(' expression ')'
  ;

string_literals:
    STRING
  | string_literals STRING
  ;

%%

static void report(SyntaxContext *context, SyntaxPhase phase, const char *code,
                   const char *message, LexerRange range)
{
    context->had_error = true;
    if (context->sink != NULL) {
        const SyntaxDiagnostic diagnostic = {
            .phase = phase, .code = code, .message = message, .range = range,
        };
        context->sink(&diagnostic, context->user);
    }
}

static int named_token(const char *text)
{
    static const struct {
        const char *text;
        int token;
    } tokens[] = {
        {"int", INT}, {"float", FLOAT}, {"double", DOUBLE}, {"char", CHAR}, {"void", VOID},
        {"static", STATIC}, {"if", IF}, {"else", ELSE}, {"while", WHILE}, {"for", FOR}, {"return", RETURN},
        {"==", EQ}, {"!=", NE}, {"<=", LE}, {">=", GE}, {"&&", AND}, {"||", OR}, {"++", INC}, {"--", DEC},
        {"+=", ADD_ASSIGN}, {"-=", SUB_ASSIGN}, {"*=", MUL_ASSIGN}, {"/=", DIV_ASSIGN}, {"%=", MOD_ASSIGN},
    };
    for (size_t index = 0; index < sizeof(tokens) / sizeof(tokens[0]); ++index) {
        if (strcmp(text, tokens[index].text) == 0) {
            return tokens[index].token;
        }
    }
    return 0;
}

static const char *unsupported_punctuation(const char *text)
{
    switch (text[0]) {
    case '[':
    case ']':
        return "Array declarators and subscripts are outside the supported C subset.";
    case '?':
    case ':':
        return "Conditional operators and labels are outside the supported C subset.";
    case '.':
        return "Member access is outside the supported C subset.";
    case '&':
        if (text[1] == '\0') {
            return "Address-of and bitwise operators are outside the supported C subset.";
        }
        break;
    case '-':
        if (text[1] == '>') {
            return "Member access is outside the supported C subset.";
        }
        break;
    }
    return "This operator or declarator is outside the supported C subset.";
}

static int grammar_token(LexerToken token, SyntaxContext *context)
{
    switch (token.kind) {
    case LEX_EOF:        return 0;
    case LEX_IDENTIFIER: return IDENTIFIER;
    case LEX_INTEGER:    return INTEGER;
    case LEX_FLOATING:   return FLOATING;
    case LEX_CHARACTER:  return CHARACTER;
    case LEX_STRING:     return STRING;
    case LEX_INCLUDE:    return INCLUDE;
    case LEX_ERROR: {
        const LexerDiagnosticInfo *info = lexer_diagnostic_info(token.diagnostic);
        report(context, SYNTAX_PHASE_LEXICAL, info->code, info->message, token.range);
        return ARCLIS_SYNTAX_error;
    }
    case LEX_KEYWORD:
    case LEX_OPERATOR:
    case LEX_DELIMITER: {
        if (token.length == 1 && strchr("(){};,=+-*/%<>!", token.lexeme[0]) != NULL) {
            return (unsigned char)token.lexeme[0];
        }
        const int named = named_token(token.lexeme);
        if (named != 0) {
            return named;
        }
        report(context, SYNTAX_PHASE_GRAMMAR, "unsupported-syntax", unsupported_punctuation(token.lexeme), token.range);
        return ARCLIS_SYNTAX_error;
    }
    }
    return ARCLIS_SYNTAX_UNDEF;
}

static int yylex(YYSTYPE *value, YYLTYPE *location, SyntaxContext *context)
{
    const LexerToken token = lexer_next(context->lexer);
    *location = token.range;
    *value = 0;
    context->lookahead = grammar_token(token, context);
    return context->lookahead;
}

static void yyerror(const YYLTYPE *location, SyntaxContext *context, const char *message)
{
    if (strcmp(message, "memory exhausted") == 0) {
        report(context, SYNTAX_PHASE_GRAMMAR, "parser-resource-limit", message, *location);
    } else if (context->lookahead == '*') {
        report(context, SYNTAX_PHASE_GRAMMAR, "unsupported-syntax",
               "Pointer declarators and unary dereference are outside the supported C subset.", *location);
    } else {
        report(context, SYNTAX_PHASE_GRAMMAR, "syntax-error", message, *location);
    }
}

SyntaxStatus syntax_analyze(FILE *source, SyntaxDiagnosticSink sink, void *user)
{
    SyntaxContext context = {.sink = sink, .user = user};
    if (lexer_init(&context.lexer, source) != 0) {
        return SYNTAX_FAILURE;
    }
    const int status = yyparse(&context);
    lexer_destroy(context.lexer);
    if (status == 2) {
        return SYNTAX_FAILURE;
    }
    return status != 0 || context.had_error ? SYNTAX_INVALID : SYNTAX_VALID;
}
