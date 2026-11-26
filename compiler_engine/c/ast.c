#include "ast.h"

#include <stdlib.h>

typedef struct AstAllocation {
    AstNode node;
    struct AstAllocation *next;
} AstAllocation;

struct AstTree {
    char *input;
    AstNode *root;
    AstAllocation *allocations;
    size_t count;
    AstBuildError error;
};

AstTree *ast_create(char *input)
{
    AstTree *tree = calloc(1, sizeof(*tree));
    if (tree != NULL) {
        tree->input = input;
    }
    return tree;
}

static size_t depth(const AstNode *node)
{
    return node == NULL ? 0 : node->depth;
}

static size_t larger(size_t left, size_t right)
{
    return left > right ? left : right;
}

static size_t child_depth(const AstNode *node)
{
    switch (node->kind) {
    case AST_PROGRAM:
    case AST_BLOCK:
    case AST_STRING_LITERAL:
        return node->as.list.depth;
    case AST_FUNCTION:
        return larger(node->as.function.parameters.depth, depth(node->as.function.body));
    case AST_DECLARATION:
        return node->as.declaration.declarators.depth;
    case AST_DECLARATOR:
        return depth(node->as.declarator.initializer);
    case AST_ASSIGNMENT:
    case AST_BINARY:
        return larger(depth(node->as.binary.left), depth(node->as.binary.right));
    case AST_UNARY:
        return depth(node->as.unary.operand);
    case AST_IF:
        return larger(depth(node->as.conditional.condition),
                      larger(depth(node->as.conditional.then_branch), depth(node->as.conditional.else_branch)));
    case AST_WHILE:
        return larger(depth(node->as.while_loop.condition), depth(node->as.while_loop.body));
    case AST_FOR:
        return larger(larger(depth(node->as.for_loop.initializer), depth(node->as.for_loop.condition)),
                      larger(depth(node->as.for_loop.step), depth(node->as.for_loop.body)));
    case AST_CALL:
        return larger(depth(node->as.call.callee), node->as.call.arguments.depth);
    case AST_RETURN:
    case AST_PARENTHESIZED:
    case AST_EXPRESSION_STATEMENT:
        return depth(node->as.expression);
    default:
        return 0;
    }
}

AstNode *ast_add(AstTree *tree, AstNode node)
{
    if (tree == NULL) {
        return NULL;
    }
    node.depth = child_depth(&node) + 1;
    if (node.depth > AST_DEPTH_LIMIT) {
        tree->error = AST_BUILD_DEPTH;
        return NULL;
    }
    if (tree->count >= AST_NODE_LIMIT) {
        tree->error = AST_BUILD_NODES;
        return NULL;
    }
    AstAllocation *allocation = malloc(sizeof(*allocation));
    if (allocation == NULL) {
        tree->error = AST_BUILD_MEMORY;
        return NULL;
    }
    node.index = tree->count;
    allocation->node = node;
    allocation->next = tree->allocations;
    tree->allocations = allocation;
    ++tree->count;
    return &allocation->node;
}

AstList ast_append(AstList list, AstNode *node)
{
    if (node == NULL) {
        return list;
    }
    if (list.last == NULL) {
        list.first = node;
    } else {
        list.last->next = node;
    }
    list.last = node;
    list.depth = larger(list.depth, node->depth);
    return list;
}

AstBuildError ast_error(const AstTree *tree)
{
    return tree->error;
}

void ast_set_root(AstTree *tree, AstNode *root)
{
    tree->root = root;
}

const AstNode *ast_root(const AstTree *tree)
{
    return tree->root;
}

size_t ast_node_count(const AstTree *tree)
{
    return tree->count;
}

const char *ast_type_name(AstType type)
{
    static const char *const names[] = {
        [AST_TYPE_INT] = "int",
        [AST_TYPE_FLOAT] = "float",
        [AST_TYPE_DOUBLE] = "double",
        [AST_TYPE_CHAR] = "char",
        [AST_TYPE_VOID] = "void",
    };
    return names[type];
}

void ast_destroy(AstTree *tree)
{
    if (tree == NULL) {
        return;
    }
    while (tree->allocations != NULL) {
        AstAllocation *allocation = tree->allocations;
        tree->allocations = allocation->next;
        free(allocation);
    }
    free(tree->input);
    free(tree);
}
