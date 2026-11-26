#ifndef ARCLIS_AST_H
#define ARCLIS_AST_H

#include "lexer.h"

#include <stdbool.h>

enum {
    AST_SOURCE_LIMIT = 1024 * 1024,
    AST_NODE_LIMIT = 4096,
    AST_DEPTH_LIMIT = 128,
};

typedef enum {
    AST_PROGRAM,
    AST_INCLUDE,
    AST_FUNCTION,
    AST_PARAMETER,
    AST_BLOCK,
    AST_DECLARATION,
    AST_DECLARATOR,
    AST_ASSIGNMENT,
    AST_BINARY,
    AST_UNARY,
    AST_IDENTIFIER,
    AST_LITERAL,
    AST_STRING_LITERAL,
    AST_IF,
    AST_WHILE,
    AST_FOR,
    AST_RETURN,
    AST_CALL,
    AST_PARENTHESIZED,
    AST_EXPRESSION_STATEMENT,
    AST_EMPTY_STATEMENT,
} AstKind;

typedef enum {
    AST_TYPE_INT,
    AST_TYPE_FLOAT,
    AST_TYPE_DOUBLE,
    AST_TYPE_CHAR,
    AST_TYPE_VOID,
} AstType;

typedef enum {
    AST_INTEGER,
    AST_FLOATING,
    AST_CHARACTER,
    AST_STRING,
} AstLiteralKind;

typedef struct {
    const char *data;
    size_t length;
} AstText;

typedef struct {
    AstType type;
    bool is_static;
} AstTypeSpecifiers;

typedef struct AstNode AstNode;

typedef struct {
    AstNode *first;
    AstNode *last;
    size_t depth;
} AstList;

struct AstNode {
    AstKind kind;
    LexerRange range;
    /* Sibling link for the node's containing list. */
    AstNode *next;
    size_t depth;
    union {
        AstList list;
        AstText text;
        struct {
            AstTypeSpecifiers specifiers;
            AstText name;
            AstList parameters;
            AstNode *body;
        } function;
        struct { AstType type; AstText name; } parameter;
        struct { AstTypeSpecifiers specifiers; AstList declarators; } declaration;
        struct { AstText name; AstNode *initializer; } declarator;
        struct { AstLiteralKind kind; AstText text; } literal;
        struct { const char *operator; AstNode *left; AstNode *right; } binary;
        struct { const char *operator; AstNode *operand; bool postfix; } unary;
        struct { AstNode *condition; AstNode *then_branch; AstNode *else_branch; } conditional;
        struct { AstNode *condition; AstNode *body; } while_loop;
        struct { AstNode *initializer; AstNode *condition; AstNode *step; AstNode *body; } for_loop;
        struct { AstNode *callee; AstList arguments; } call;
        AstNode *expression;
    } as;
};

typedef struct AstTree AstTree;

typedef enum {
    AST_BUILD_OK,
    AST_BUILD_DEPTH,
    AST_BUILD_NODES,
    AST_BUILD_MEMORY,
} AstBuildError;

/* The tree owns the input on success. Node text slices remain valid until destruction. */
AstTree *ast_create(char *input);
AstNode *ast_add(AstTree *tree, AstNode node);
AstList ast_append(AstList list, AstNode *node);
AstBuildError ast_error(const AstTree *tree);
void ast_set_root(AstTree *tree, AstNode *root);
const AstNode *ast_root(const AstTree *tree);
size_t ast_node_count(const AstTree *tree);
const char *ast_type_name(AstType type);
void ast_destroy(AstTree *tree);
void ast_write_json(FILE *output, const AstTree *tree);

#endif
