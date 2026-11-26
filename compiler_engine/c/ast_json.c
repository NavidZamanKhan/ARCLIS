#include "ast.h"
#include "cli_io.h"

#include <string.h>

static const char *const node_names[] = {
    [AST_PROGRAM] = "Program",
    [AST_INCLUDE] = "IncludeDirective",
    [AST_FUNCTION] = "FunctionDeclaration",
    [AST_PARAMETER] = "Parameter",
    [AST_BLOCK] = "Block",
    [AST_DECLARATION] = "VariableDeclaration",
    [AST_DECLARATOR] = "Declarator",
    [AST_ASSIGNMENT] = "Assignment",
    [AST_BINARY] = "BinaryExpression",
    [AST_UNARY] = "UnaryExpression",
    [AST_IDENTIFIER] = "Identifier",
    [AST_LITERAL] = "Literal",
    [AST_STRING_LITERAL] = "StringLiteral",
    [AST_IF] = "IfStatement",
    [AST_WHILE] = "WhileStatement",
    [AST_FOR] = "ForStatement",
    [AST_RETURN] = "ReturnStatement",
    [AST_CALL] = "CallExpression",
    [AST_PARENTHESIZED] = "ParenthesizedExpression",
    [AST_EXPRESSION_STATEMENT] = "ExpressionStatement",
    [AST_EMPTY_STATEMENT] = "EmptyStatement",
};

static const char *const type_names[] = {
    [AST_TYPE_INT] = "int",
    [AST_TYPE_FLOAT] = "float",
    [AST_TYPE_DOUBLE] = "double",
    [AST_TYPE_CHAR] = "char",
    [AST_TYPE_VOID] = "void",
};

static const char *const literal_names[] = {
    [AST_INTEGER] = "integer",
    [AST_FLOATING] = "floating",
    [AST_CHARACTER] = "character",
    [AST_STRING] = "string",
};

static void write_node(FILE *output, const AstNode *node);

static void write_key(FILE *output, const char *name)
{
    fprintf(output, ",\"%s\":", name);
}

static void write_text(FILE *output, const char *name, AstText text)
{
    write_key(output, name);
    if (text.data == NULL) {
        fputs("null", output);
    } else {
        cli_write_string(output, text.data, text.length);
    }
}

static void write_word(FILE *output, const char *name, const char *value)
{
    write_text(output, name, (AstText){value, strlen(value)});
}

static void write_bool(FILE *output, const char *name, bool value)
{
    write_key(output, name);
    fputs(value ? "true" : "false", output);
}

static void write_child(FILE *output, const char *name, const AstNode *child)
{
    write_key(output, name);
    write_node(output, child);
}

static void write_list(FILE *output, const char *name, AstList list)
{
    write_key(output, name);
    fputc('[', output);
    for (const AstNode *node = list.first; node != NULL; node = node->next) {
        if (node != list.first) {
            fputc(',', output);
        }
        write_node(output, node);
    }
    fputc(']', output);
}

static void write_node(FILE *output, const AstNode *node)
{
    if (node == NULL) {
        fputs("null", output);
        return;
    }

    fprintf(output, "{\"kind\":\"%s\",\"range\":", node_names[node->kind]);
    cli_write_range(output, node->range);
    switch (node->kind) {
    case AST_PROGRAM:
        write_list(output, "items", node->as.list);
        break;
    case AST_INCLUDE:
        write_text(output, "text", node->as.text);
        break;
    case AST_FUNCTION:
        write_text(output, "name", node->as.function.name);
        write_word(output, "returnType", type_names[node->as.function.specifiers.type]);
        write_bool(output, "static", node->as.function.specifiers.is_static);
        write_list(output, "parameters", node->as.function.parameters);
        write_child(output, "body", node->as.function.body);
        break;
    case AST_PARAMETER:
        write_word(output, "type", type_names[node->as.parameter.type]);
        write_text(output, "name", node->as.parameter.name);
        break;
    case AST_BLOCK:
        write_list(output, "items", node->as.list);
        break;
    case AST_DECLARATION:
        write_word(output, "type", type_names[node->as.declaration.specifiers.type]);
        write_bool(output, "static", node->as.declaration.specifiers.is_static);
        write_list(output, "declarators", node->as.declaration.declarators);
        break;
    case AST_DECLARATOR:
        write_text(output, "name", node->as.declarator.name);
        write_child(output, "initializer", node->as.declarator.initializer);
        break;
    case AST_ASSIGNMENT:
    case AST_BINARY:
        write_word(output, "operator", node->as.binary.operator);
        write_child(output, "left", node->as.binary.left);
        write_child(output, "right", node->as.binary.right);
        break;
    case AST_UNARY:
        write_word(output, "operator", node->as.unary.operator);
        write_child(output, "operand", node->as.unary.operand);
        write_bool(output, "postfix", node->as.unary.postfix);
        break;
    case AST_IDENTIFIER:
        write_text(output, "name", node->as.text);
        break;
    case AST_LITERAL:
        write_word(output, "literalKind", literal_names[node->as.literal.kind]);
        write_text(output, "text", node->as.literal.text);
        break;
    case AST_STRING_LITERAL:
        write_list(output, "segments", node->as.list);
        break;
    case AST_IF:
        write_child(output, "condition", node->as.conditional.condition);
        write_child(output, "thenBranch", node->as.conditional.then_branch);
        write_child(output, "elseBranch", node->as.conditional.else_branch);
        break;
    case AST_WHILE:
        write_child(output, "condition", node->as.while_loop.condition);
        write_child(output, "body", node->as.while_loop.body);
        break;
    case AST_FOR:
        write_child(output, "initializer", node->as.for_loop.initializer);
        write_child(output, "condition", node->as.for_loop.condition);
        write_child(output, "step", node->as.for_loop.step);
        write_child(output, "body", node->as.for_loop.body);
        break;
    case AST_RETURN:
    case AST_PARENTHESIZED:
    case AST_EXPRESSION_STATEMENT:
        write_child(output, "expression", node->as.expression);
        break;
    case AST_CALL:
        write_child(output, "callee", node->as.call.callee);
        write_list(output, "arguments", node->as.call.arguments);
        break;
    case AST_EMPTY_STATEMENT:
        break;
    }
    fputc('}', output);
}

void ast_write_json(FILE *output, const AstTree *tree)
{
    write_node(output, ast_root(tree));
}
