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
#include <stdlib.h>
#include <string.h>

struct SyntaxContext {
    Lexer *lexer;
    SyntaxDiagnosticSink sink;
    void *user;
    AstTree *tree;
    AstNode *root;
    const char *input;
    LexerPosition input_end;
    int lookahead;
    bool had_error;
    bool resource_failure;
};

static int yylex(YYSTYPE *value, YYLTYPE *location, SyntaxContext *context);
static void yyerror(const YYLTYPE *location, SyntaxContext *context, const char *message);
static void report(SyntaxContext *context, SyntaxPhase phase, const char *code,
                   const char *message, LexerRange range);
static void report_ast_failure(SyntaxContext *context, LexerRange range);

/* Nodes belong to the parse arena, including values Bison discards during recovery. */
#define MAKE_NODE(Result, Location, ...)                                             \
    do {                                                                             \
        (Result) = ast_add(context->tree, (AstNode){.range = (Location), __VA_ARGS__}); \
        if (context->tree != NULL && (Result) == NULL) {                              \
            report_ast_failure(context, Location);                                   \
            YYABORT;                                                                 \
        }                                                                            \
    } while (0)

#define MAKE_BINARY(Result, Location, Kind, Operator, Left, Right) \
    MAKE_NODE(Result, Location, .kind = Kind, .as.binary = {Operator, Left, Right})

#define MAKE_UNARY(Result, Location, Operator, Operand, Postfix) \
    MAKE_NODE(Result, Location, .kind = AST_UNARY, .as.unary = {Operator, Operand, Postfix})
}

%initial-action {
    @$ = (LexerRange){
        .start = {.line = 1, .column = 1},
        .end = {.line = 1, .column = 1},
    };
}

%union {
    AstNode *node;
    AstList list;
    AstText text;
    AstType type;
    AstTypeSpecifiers specifiers;
    const char *operator;
}

%token <text> IDENTIFIER "identifier"
%token <text> INTEGER "integer literal"
%token <text> FLOATING "floating-point literal"
%token <text> CHARACTER "character literal"
%token <text> STRING "string literal"
%token <text> INCLUDE "include directive"
%token INT "int" FLOAT "float" DOUBLE "double" CHAR "char" VOID "void" STATIC "static"
%token IF "if" ELSE "else" WHILE "while" FOR "for" RETURN "return"
%token EQ "==" NE "!=" LE "<=" GE ">=" AND "&&" OR "||" INC "++" DEC "--"
%token ADD_ASSIGN "+=" SUB_ASSIGN "-=" MUL_ASSIGN "*=" DIV_ASSIGN "/=" MOD_ASSIGN "%="

%type <list> translation_unit parameter_clause parameter_list declarators block_items
%type <list> arguments_opt arguments string_literals
%type <node> external_item function_end parameter declaration declarator initializer_opt
%type <node> compound_statement statement for_initializer expression_opt expression
%type <node> assignment_expression logical_or_expression logical_and_expression equality_expression
%type <node> relational_expression additive_expression multiplicative_expression unary_expression
%type <node> postfix_expression primary_expression string_segment
%type <type> type_specifier value_type
%type <specifiers> declaration_specifiers
%type <operator> assignment_operator

/* Resolve the dangling else in favor of the closest unmatched if. */
%precedence IF_WITHOUT_ELSE
%precedence ELSE

%%

program:
    translation_unit {
        MAKE_NODE(context->root, @$, .kind = AST_PROGRAM, .as.list = $1);
    }
  ;

translation_unit:
    %empty { $$ = (AstList){0}; }
  | translation_unit external_item { $$ = ast_append($1, $2); }
  | translation_unit error ';' { $$ = $1; yyerrok; }
  ;

external_item:
    INCLUDE { MAKE_NODE($$, @$, .kind = AST_INCLUDE, .as.text = $1); }
  | declaration_specifiers IDENTIFIER '(' parameter_clause ')' function_end {
        MAKE_NODE($$, @$, .kind = AST_FUNCTION, .as.function = {$1, $2, $4, $6});
    }
  | declaration
  ;

function_end:
    ';' { $$ = NULL; }
  | compound_statement
  ;

declaration_specifiers:
    type_specifier { $$ = (AstTypeSpecifiers){.type = $1}; }
  | STATIC type_specifier { $$ = (AstTypeSpecifiers){.type = $2, .is_static = true}; }
  ;

type_specifier:
    value_type
  | VOID { $$ = AST_TYPE_VOID; }
  ;

value_type:
    INT { $$ = AST_TYPE_INT; }
  | FLOAT { $$ = AST_TYPE_FLOAT; }
  | DOUBLE { $$ = AST_TYPE_DOUBLE; }
  | CHAR { $$ = AST_TYPE_CHAR; }
  ;

parameter_clause:
    %empty { $$ = (AstList){0}; }
  | VOID { $$ = (AstList){0}; }
  | parameter_list
  ;

parameter_list:
    parameter { $$ = ast_append((AstList){0}, $1); }
  | parameter_list ',' parameter { $$ = ast_append($1, $3); }
  ;

parameter:
    value_type { MAKE_NODE($$, @$, .kind = AST_PARAMETER, .as.parameter = {.type = $1}); }
  | value_type IDENTIFIER { MAKE_NODE($$, @$, .kind = AST_PARAMETER, .as.parameter = {$1, $2}); }
  | VOID IDENTIFIER { MAKE_NODE($$, @$, .kind = AST_PARAMETER, .as.parameter = {AST_TYPE_VOID, $2}); }
  ;

declaration:
    declaration_specifiers declarators ';' {
        MAKE_NODE($$, @$, .kind = AST_DECLARATION, .as.declaration = {$1, $2});
    }
  ;

declarators:
    declarator { $$ = ast_append((AstList){0}, $1); }
  | declarators ',' declarator { $$ = ast_append($1, $3); }
  ;

declarator:
    IDENTIFIER initializer_opt {
        MAKE_NODE($$, @$, .kind = AST_DECLARATOR, .as.declarator = {$1, $2});
    }
  ;

initializer_opt:
    %empty { $$ = NULL; }
  | '=' assignment_expression { $$ = $2; }
  ;

compound_statement:
    '{' block_items '}' { MAKE_NODE($$, @$, .kind = AST_BLOCK, .as.list = $2); }
  ;

block_items:
    %empty { $$ = (AstList){0}; }
  | block_items declaration { $$ = ast_append($1, $2); }
  | block_items statement { $$ = ast_append($1, $2); }
  | block_items error ';' { $$ = $1; yyerrok; }
  ;

statement:
    compound_statement
  | ';' { MAKE_NODE($$, @$, .kind = AST_EMPTY_STATEMENT); }
  | expression ';' { MAKE_NODE($$, @$, .kind = AST_EXPRESSION_STATEMENT, .as.expression = $1); }
  | RETURN expression_opt ';' { MAKE_NODE($$, @$, .kind = AST_RETURN, .as.expression = $2); }
  | IF '(' expression ')' statement %prec IF_WITHOUT_ELSE {
        MAKE_NODE($$, @$, .kind = AST_IF, .as.conditional = {$3, $5, NULL});
    }
  | IF '(' expression ')' statement ELSE statement {
        MAKE_NODE($$, @$, .kind = AST_IF, .as.conditional = {$3, $5, $7});
    }
  | WHILE '(' expression ')' statement {
        MAKE_NODE($$, @$, .kind = AST_WHILE, .as.while_loop = {$3, $5});
    }
  | FOR '(' for_initializer expression_opt ';' expression_opt ')' statement {
        MAKE_NODE($$, @$, .kind = AST_FOR, .as.for_loop = {$3, $4, $6, $8});
    }
  ;

for_initializer:
    declaration
  | expression_opt ';' { $$ = $1; }
  ;

expression_opt:
    %empty { $$ = NULL; }
  | expression
  ;

expression:
    assignment_expression
  | expression ',' assignment_expression { MAKE_BINARY($$, @$, AST_BINARY, ",", $1, $3); }
  ;

assignment_expression:
    logical_or_expression
  | unary_expression assignment_operator assignment_expression { MAKE_BINARY($$, @$, AST_ASSIGNMENT, $2, $1, $3); }
  ;

assignment_operator:
    '=' { $$ = "="; }
  | ADD_ASSIGN { $$ = "+="; }
  | SUB_ASSIGN { $$ = "-="; }
  | MUL_ASSIGN { $$ = "*="; }
  | DIV_ASSIGN { $$ = "/="; }
  | MOD_ASSIGN { $$ = "%="; }
  ;

logical_or_expression:
    logical_and_expression
  | logical_or_expression OR logical_and_expression { MAKE_BINARY($$, @$, AST_BINARY, "||", $1, $3); }
  ;

logical_and_expression:
    equality_expression
  | logical_and_expression AND equality_expression { MAKE_BINARY($$, @$, AST_BINARY, "&&", $1, $3); }
  ;

equality_expression:
    relational_expression
  | equality_expression EQ relational_expression { MAKE_BINARY($$, @$, AST_BINARY, "==", $1, $3); }
  | equality_expression NE relational_expression { MAKE_BINARY($$, @$, AST_BINARY, "!=", $1, $3); }
  ;

relational_expression:
    additive_expression
  | relational_expression '<' additive_expression { MAKE_BINARY($$, @$, AST_BINARY, "<", $1, $3); }
  | relational_expression '>' additive_expression { MAKE_BINARY($$, @$, AST_BINARY, ">", $1, $3); }
  | relational_expression LE additive_expression { MAKE_BINARY($$, @$, AST_BINARY, "<=", $1, $3); }
  | relational_expression GE additive_expression { MAKE_BINARY($$, @$, AST_BINARY, ">=", $1, $3); }
  ;

additive_expression:
    multiplicative_expression
  | additive_expression '+' multiplicative_expression { MAKE_BINARY($$, @$, AST_BINARY, "+", $1, $3); }
  | additive_expression '-' multiplicative_expression { MAKE_BINARY($$, @$, AST_BINARY, "-", $1, $3); }
  ;

multiplicative_expression:
    unary_expression
  | multiplicative_expression '*' unary_expression { MAKE_BINARY($$, @$, AST_BINARY, "*", $1, $3); }
  | multiplicative_expression '/' unary_expression { MAKE_BINARY($$, @$, AST_BINARY, "/", $1, $3); }
  | multiplicative_expression '%' unary_expression { MAKE_BINARY($$, @$, AST_BINARY, "%", $1, $3); }
  ;

unary_expression:
    postfix_expression
  | '+' unary_expression { MAKE_UNARY($$, @$, "+", $2, false); }
  | '-' unary_expression { MAKE_UNARY($$, @$, "-", $2, false); }
  | '!' unary_expression { MAKE_UNARY($$, @$, "!", $2, false); }
  | INC unary_expression { MAKE_UNARY($$, @$, "++", $2, false); }
  | DEC unary_expression { MAKE_UNARY($$, @$, "--", $2, false); }
  ;

postfix_expression:
    primary_expression
  | postfix_expression '(' arguments_opt ')' {
        MAKE_NODE($$, @$, .kind = AST_CALL, .as.call = {$1, $3});
    }
  | postfix_expression INC { MAKE_UNARY($$, @$, "++", $1, true); }
  | postfix_expression DEC { MAKE_UNARY($$, @$, "--", $1, true); }
  ;

arguments_opt:
    %empty { $$ = (AstList){0}; }
  | arguments
  ;

arguments:
    assignment_expression { $$ = ast_append((AstList){0}, $1); }
  | arguments ',' assignment_expression { $$ = ast_append($1, $3); }
  ;

primary_expression:
    IDENTIFIER { MAKE_NODE($$, @$, .kind = AST_IDENTIFIER, .as.text = $1); }
  | INTEGER { MAKE_NODE($$, @$, .kind = AST_LITERAL, .as.literal = {AST_INTEGER, $1}); }
  | FLOATING { MAKE_NODE($$, @$, .kind = AST_LITERAL, .as.literal = {AST_FLOATING, $1}); }
  | CHARACTER { MAKE_NODE($$, @$, .kind = AST_LITERAL, .as.literal = {AST_CHARACTER, $1}); }
  | string_literals { MAKE_NODE($$, @$, .kind = AST_STRING_LITERAL, .as.list = $1); }
  | '(' expression ')' { MAKE_NODE($$, @$, .kind = AST_PARENTHESIZED, .as.expression = $2); }
  ;

string_literals:
    string_segment { $$ = ast_append((AstList){0}, $1); }
  | string_literals string_segment { $$ = ast_append($1, $2); }
  ;

string_segment:
    STRING { MAKE_NODE($$, @$, .kind = AST_LITERAL, .as.literal = {AST_STRING, $1}); }
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
    *value = (YYSTYPE){0};
    if (context->tree != NULL) {
        value->text = (AstText){
            context->input + token.range.start.offset,
            token.range.end.offset - token.range.start.offset,
        };
        context->input_end = token.range.end;
    }
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

static SyntaxStatus parse(SyntaxContext *context)
{
    const int status = yyparse(context);
    lexer_destroy(context->lexer);
    if (status == 2 || context->resource_failure) {
        return SYNTAX_FAILURE;
    }
    return status != 0 || context->had_error ? SYNTAX_INVALID : SYNTAX_VALID;
}

SyntaxStatus syntax_analyze(FILE *source, SyntaxDiagnosticSink sink, void *user)
{
    SyntaxContext context = {.sink = sink, .user = user};
    if (lexer_init(&context.lexer, source) != 0) {
        return SYNTAX_FAILURE;
    }
    return parse(&context);
}

static void report_ast_failure(SyntaxContext *context, LexerRange range)
{
    context->resource_failure = true;
    switch (ast_error(context->tree)) {
    case AST_BUILD_DEPTH:
        report(context, SYNTAX_PHASE_GRAMMAR, "ast-resource-limit", "The AST nesting limit was exceeded.", range);
        break;
    case AST_BUILD_NODES:
        report(context, SYNTAX_PHASE_GRAMMAR, "ast-resource-limit", "The AST node limit was exceeded.", range);
        break;
    default:
        report(context, SYNTAX_PHASE_GRAMMAR, "ast-resource-error", "Could not allocate an AST node.", range);
        break;
    }
}

SyntaxStatus syntax_analyze_ast(FILE *source, AstTree **tree, SyntaxDiagnosticSink sink, void *user)
{
    *tree = NULL;
    const LexerPosition first = {.line = 1, .column = 1};
    const LexerRange first_point = {first, first};
    SyntaxContext context = {.sink = sink, .user = user, .input_end = first};
    char *input = malloc(AST_SOURCE_LIMIT + 1);
    if (input == NULL) {
        report(&context, SYNTAX_PHASE_GRAMMAR, "ast-resource-error", "Could not allocate the AST source buffer.", first_point);
        return SYNTAX_FAILURE;
    }

    const size_t length = fread(input, 1, AST_SOURCE_LIMIT + 1, source);
    if (ferror(source) || length > AST_SOURCE_LIMIT) {
        if (ferror(source)) {
            report(&context, SYNTAX_PHASE_GRAMMAR, "source-read-error", "Could not read the source.", first_point);
        } else {
            report(&context, SYNTAX_PHASE_GRAMMAR, "ast-source-limit", "AST input is limited to 1 MiB.", first_point);
        }
        free(input);
        return SYNTAX_FAILURE;
    }

    context.tree = ast_create(input);
    if (context.tree == NULL) {
        report(&context, SYNTAX_PHASE_GRAMMAR, "ast-resource-error", "Could not allocate an AST.", first_point);
        free(input);
        return SYNTAX_FAILURE;
    }
    if (lexer_init_bytes(&context.lexer, input, length) != 0) {
        ast_destroy(context.tree);
        return SYNTAX_FAILURE;
    }
    context.input = input;

    const SyntaxStatus status = parse(&context);
    if (status != SYNTAX_VALID) {
        ast_destroy(context.tree);
        return status;
    }
    context.root->range = (LexerRange){first, context.input_end};
    ast_set_root(context.tree, context.root);
    *tree = context.tree;
    return SYNTAX_VALID;
}
