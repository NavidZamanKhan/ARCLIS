#include "semantic.h"

#include <string.h>

typedef struct {
    SymbolTable *table;
    SemanticDiagnosticSink sink;
    void *user;
    AstType return_type;
    bool invalid;
} Analysis;

typedef enum {
    VALUE_INVALID,
    VALUE_TYPED,
    VALUE_STRING,
    VALUE_FUNCTION,
} ValueKind;

typedef struct {
    ValueKind kind;
    AstType type;
    bool modifiable;
    const Symbol *function;
} Value;

static Value expression(Analysis *analysis, size_t scope, const AstNode *node);
static void statement(Analysis *analysis, size_t scope, const AstNode *node);

static void report(Analysis *analysis, const AstNode *node, const char *code, const char *message)
{
    analysis->invalid = true;
    if (analysis->sink != NULL) {
        const SemanticDiagnostic diagnostic = {code, message, node->range};
        analysis->sink(&diagnostic, analysis->user);
    }
}

static Value typed(AstType type)
{
    return (Value){.kind = VALUE_TYPED, .type = type};
}

static bool is_numeric(Value value)
{
    return value.kind == VALUE_TYPED && value.type != AST_TYPE_VOID;
}

static bool is_integral(Value value)
{
    return is_numeric(value) && (value.type == AST_TYPE_INT || value.type == AST_TYPE_CHAR);
}

static bool is_scalar(Value value)
{
    return is_numeric(value) || value.kind == VALUE_STRING || value.kind == VALUE_FUNCTION;
}

static Value arithmetic_result(Value left, Value right)
{
    if (left.type == AST_TYPE_DOUBLE || right.type == AST_TYPE_DOUBLE) {
        return typed(AST_TYPE_DOUBLE);
    }
    if (left.type == AST_TYPE_FLOAT || right.type == AST_TYPE_FLOAT) {
        return typed(AST_TYPE_FLOAT);
    }
    return typed(AST_TYPE_INT);
}

static bool check_numeric_conversion(Analysis *analysis, const AstNode *node, Value value,
                                     const char *code, const char *message)
{
    if (value.kind == VALUE_INVALID) {
        return false;
    }
    if (!is_numeric(value)) {
        report(analysis, node, code, message);
        return false;
    }
    return true;
}

static Value identifier(Analysis *analysis, size_t scope, const AstNode *node)
{
    const Symbol *symbol = symbol_resolve(analysis->table, scope, node->as.text);
    if (symbol == NULL) {
        report(analysis, node, "undeclared-identifier", "Identifier has no visible declaration");
        return (Value){0};
    }
    if (symbol->kind == SYMBOL_FUNCTION) {
        return (Value){.kind = VALUE_FUNCTION, .function = symbol};
    }
    if (symbol->type == AST_TYPE_VOID) {
        return (Value){0};
    }
    return (Value){.kind = VALUE_TYPED, .type = symbol->type, .modifiable = true};
}

static Value call(Analysis *analysis, size_t scope, const AstNode *node)
{
    const AstNode *callee = node->as.call.callee;
    const Value target = expression(analysis, scope, callee);
    const Symbol *function = target.function;
    const AstNode *parameter = NULL;
    bool wrong_count = false;
    if (function != NULL) {
        parameter = function->declaration->as.function.parameters.first;
    } else if (target.kind != VALUE_INVALID) {
        report(analysis, callee, "not-callable", "Call target must be a function");
    }

    for (const AstNode *argument = node->as.call.arguments.first; argument != NULL; argument = argument->next) {
        const Value value = expression(analysis, scope, argument);
        if (parameter == NULL) {
            wrong_count = true;
            continue;
        }
        if (parameter->as.parameter.type != AST_TYPE_VOID) {
            check_numeric_conversion(analysis, argument, value, "invalid-argument-type",
                                     "Argument must be convertible to the parameter's numeric type");
        }
        parameter = parameter->next;
    }
    if (function == NULL) {
        return (Value){0};
    }
    if (wrong_count || parameter != NULL) {
        report(analysis, node, "argument-count", "Argument count does not match the function declaration");
    }
    return typed(function->type);
}

static Value unary(Analysis *analysis, size_t scope, const AstNode *node)
{
    const AstNode *operand = node->as.unary.operand;
    const Value value = expression(analysis, scope, operand);
    if (value.kind == VALUE_INVALID) {
        return (Value){0};
    }
    const char *operator = node->as.unary.operator;
    if (operator[1] != '\0') {
        if (!value.modifiable) {
            report(analysis, operand, "invalid-assignment-target", "Increment or decrement requires a modifiable object");
            return (Value){0};
        }
        return typed(value.type);
    }
    if (operator[0] == '!' && is_scalar(value)) {
        return typed(AST_TYPE_INT);
    }
    if (operator[0] != '!' && is_numeric(value)) {
        return arithmetic_result(value, value);
    }
    report(analysis, operand, "invalid-operand-type", "Operand has an incompatible type for the unary operator");
    return (Value){0};
}

static Value assignment(Analysis *analysis, size_t scope, const AstNode *node)
{
    const AstNode *target = node->as.binary.left;
    const AstNode *source = node->as.binary.right;
    const Value left = expression(analysis, scope, target);
    if (left.kind != VALUE_INVALID && !left.modifiable) {
        report(analysis, target, "invalid-assignment-target", "Assignment requires a modifiable object");
    }
    const Value right = expression(analysis, scope, source);
    if (!left.modifiable || right.kind == VALUE_INVALID) {
        return (Value){0};
    }
    if (node->as.binary.operator[0] == '%') {
        if (!is_integral(left) || !is_integral(right)) {
            report(analysis, node, "invalid-operand-type", "Remainder assignment requires integral operands");
            return (Value){0};
        }
    } else if (!check_numeric_conversion(analysis, source, right, "invalid-assignment-type",
                                         "Assigned value must be convertible to the target's numeric type")) {
        return (Value){0};
    }
    return typed(left.type);
}

static Value binary(Analysis *analysis, size_t scope, const AstNode *node)
{
    const Value left = expression(analysis, scope, node->as.binary.left);
    Value right = expression(analysis, scope, node->as.binary.right);
    if (left.kind == VALUE_INVALID || right.kind == VALUE_INVALID) {
        return (Value){0};
    }
    switch (node->as.binary.operator[0]) {
    case ',':
        right.modifiable = false;
        return right;
    case '&':
    case '|':
        if (is_scalar(left) && is_scalar(right)) {
            return typed(AST_TYPE_INT);
        }
        break;
    case '%':
        if (is_integral(left) && is_integral(right)) {
            return typed(AST_TYPE_INT);
        }
        break;
    case '=':
    case '!':
    case '<':
    case '>':
        if ((is_numeric(left) && is_numeric(right)) || (left.kind == VALUE_STRING && right.kind == VALUE_STRING)) {
            return typed(AST_TYPE_INT);
        }
        break;
    default:
        if (is_numeric(left) && is_numeric(right)) {
            return arithmetic_result(left, right);
        }
        break;
    }
    report(analysis, node, "invalid-operand-type", "Operands have incompatible types for the binary operator");
    return (Value){0};
}

static Value expression(Analysis *analysis, size_t scope, const AstNode *node)
{
    if (node == NULL) {
        return (Value){0};
    }
    switch (node->kind) {
    case AST_IDENTIFIER:
        return identifier(analysis, scope, node);
    case AST_LITERAL:
        if (node->as.literal.kind == AST_FLOATING) {
            const AstText text = node->as.literal.text;
            const char suffix = text.data[text.length - 1];
            return typed(suffix == 'f' || suffix == 'F' ? AST_TYPE_FLOAT : AST_TYPE_DOUBLE);
        }
        return typed(AST_TYPE_INT);
    case AST_STRING_LITERAL:
        return (Value){.kind = VALUE_STRING};
    case AST_PARENTHESIZED:
        return expression(analysis, scope, node->as.expression);
    case AST_CALL:
        return call(analysis, scope, node);
    case AST_UNARY:
        return unary(analysis, scope, node);
    case AST_ASSIGNMENT:
        return assignment(analysis, scope, node);
    case AST_BINARY:
        return binary(analysis, scope, node);
    default:
        return (Value){0};
    }
}

static bool compatible_functions(const Symbol *existing, const Symbol *current)
{
    if (existing->type != current->type || (!existing->is_static && current->is_static)) {
        return false;
    }
    const AstNode *left = existing->declaration->as.function.parameters.first;
    const AstNode *right = current->declaration->as.function.parameters.first;
    for (; left != NULL && right != NULL; left = left->next, right = right->next) {
        if (left->as.parameter.type != right->as.parameter.type) {
            return false;
        }
    }
    return left == NULL && right == NULL;
}

static void declare(Analysis *analysis, Symbol symbol)
{
    Symbol *existing = symbol_find_local(analysis->table, symbol.scope, symbol.name);
    if (existing == NULL) {
        symbol_add(analysis->table, symbol);
        return;
    }
    if (analysis->table->scopes[symbol.scope - 1].kind != SCOPE_FILE) {
        report(analysis, symbol.declaration, "duplicate-declaration", "Name is already declared in this scope");
        return;
    }
    const bool compatible = existing->kind == symbol.kind && (symbol.kind == SYMBOL_FUNCTION
        ? compatible_functions(existing, &symbol)
        : existing->type == symbol.type && existing->is_static == symbol.is_static);
    if (!compatible) {
        report(analysis, symbol.declaration, "conflicting-declaration", "Declaration conflicts with a previous file-scope declaration");
        return;
    }
    if (symbol.definition != NULL) {
        if (existing->definition == NULL) {
            existing->definition = symbol.definition;
        } else {
            report(analysis, symbol.declaration, "duplicate-definition", "Name already has a definition in this file");
        }
    }
}

static void declaration(Analysis *analysis, size_t scope, const AstNode *node)
{
    const AstTypeSpecifiers specifiers = node->as.declaration.specifiers;
    const ScopeKind kind = analysis->table->scopes[scope - 1].kind;
    if (kind == SCOPE_FOR && specifiers.is_static) {
        report(analysis, node, "invalid-loop-storage", "A for-loop initializer cannot declare a static object");
    }
    for (const AstNode *item = node->as.declaration.declarators.first; item != NULL; item = item->next) {
        const AstNode *initializer = item->as.declarator.initializer;
        if (specifiers.type == AST_TYPE_VOID) {
            report(analysis, item, "invalid-object-type", "Objects cannot have type void");
        }
        declare(analysis, (Symbol){
            .kind = SYMBOL_VARIABLE, .name = item->as.declarator.name, .type = specifiers.type,
            .is_static = specifiers.is_static, .scope = scope, .declaration = item,
            .definition = kind != SCOPE_FILE || initializer != NULL ? item : NULL,
        });
        if (initializer != NULL) {
            const Value value = expression(analysis, scope, initializer);
            if (specifiers.type != AST_TYPE_VOID) {
                check_numeric_conversion(analysis, initializer, value, "invalid-initializer-type",
                                         "Initializer must be convertible to the object's numeric type");
            }
        }
    }
}

static void block_items(Analysis *analysis, size_t scope, const AstNode *block)
{
    for (const AstNode *item = block->as.list.first; item != NULL; item = item->next) {
        statement(analysis, scope, item);
    }
}

static void function(Analysis *analysis, size_t file_scope, const AstNode *node)
{
    const AstNode *body = node->as.function.body;
    const AstTypeSpecifiers specifiers = node->as.function.specifiers;
    declare(analysis, (Symbol){
        .kind = SYMBOL_FUNCTION, .scope = file_scope, .name = node->as.function.name,
        .type = specifiers.type, .is_static = specifiers.is_static,
        .declaration = node, .definition = body == NULL ? NULL : node,
    });
    const size_t scope = symbol_scope_add(analysis->table, body == NULL ? SCOPE_PROTOTYPE : SCOPE_FUNCTION,
                                          file_scope, node->range);
    for (const AstNode *parameter = node->as.function.parameters.first; parameter != NULL; parameter = parameter->next) {
        const AstText name = parameter->as.parameter.name;
        const AstType type = parameter->as.parameter.type;
        if (type == AST_TYPE_VOID) {
            report(analysis, parameter, "invalid-parameter-type", "Named parameters cannot have type void");
        }
        if (name.data != NULL) {
            declare(analysis, (Symbol){
                .kind = SYMBOL_PARAMETER, .scope = scope, .name = name, .type = type,
                .declaration = parameter, .definition = body == NULL ? NULL : parameter,
            });
        } else if (body != NULL) {
            report(analysis, parameter, "missing-parameter-name", "Function definition parameters must have names");
        }
    }
    if (body != NULL) {
        analysis->return_type = specifiers.type;
        block_items(analysis, scope, body);
    }
}

static void check_condition(Analysis *analysis, size_t scope, const AstNode *node)
{
    const Value value = expression(analysis, scope, node);
    if (value.kind != VALUE_INVALID && !is_scalar(value)) {
        report(analysis, node, "invalid-condition-type", "Condition must have a scalar type");
    }
}

static void check_return(Analysis *analysis, size_t scope, const AstNode *node)
{
    const AstNode *returned = node->as.expression;
    const Value value = expression(analysis, scope, returned);
    if (analysis->return_type == AST_TYPE_VOID) {
        if (returned != NULL) {
            report(analysis, node, "unexpected-return-value", "A void function must return without a value");
        }
    } else if (returned == NULL) {
        report(analysis, node, "missing-return-value", "A non-void function must return a value");
    } else {
        check_numeric_conversion(analysis, returned, value, "invalid-return-type",
                                 "Return value must be convertible to the function's numeric return type");
    }
}

static void statement(Analysis *analysis, size_t scope, const AstNode *node)
{
    if (node == NULL) {
        return;
    }
    switch (node->kind) {
    case AST_DECLARATION:
        declaration(analysis, scope, node);
        break;
    case AST_BLOCK:
        block_items(analysis, symbol_scope_add(analysis->table, SCOPE_BLOCK, scope, node->range), node);
        break;
    case AST_IF:
        check_condition(analysis, scope, node->as.conditional.condition);
        statement(analysis, scope, node->as.conditional.then_branch);
        statement(analysis, scope, node->as.conditional.else_branch);
        break;
    case AST_WHILE:
        check_condition(analysis, scope, node->as.while_loop.condition);
        statement(analysis, scope, node->as.while_loop.body);
        break;
    case AST_FOR:
        scope = symbol_scope_add(analysis->table, SCOPE_FOR, scope, node->range);
        statement(analysis, scope, node->as.for_loop.initializer);
        check_condition(analysis, scope, node->as.for_loop.condition);
        expression(analysis, scope, node->as.for_loop.step);
        statement(analysis, scope, node->as.for_loop.body);
        break;
    case AST_RETURN:
        check_return(analysis, scope, node);
        break;
    case AST_EXPRESSION_STATEMENT:
        expression(analysis, scope, node->as.expression);
        break;
    default:
        expression(analysis, scope, node);
        break;
    }
}

SemanticStatus semantic_analyze(const AstTree *tree, SymbolTable *table, SemanticDiagnosticSink sink, void *user)
{
    if (!symbol_table_create(table, ast_node_count(tree))) {
        return SEMANTIC_FAILURE;
    }
    Analysis analysis = {.table = table, .sink = sink, .user = user};
    const AstNode *root = ast_root(tree);
    const size_t file_scope = symbol_scope_add(table, SCOPE_FILE, 0, root->range);
    for (const AstNode *item = root->as.list.first; item != NULL; item = item->next) {
        if (item->kind == AST_FUNCTION) {
            function(&analysis, file_scope, item);
        } else if (item->kind == AST_DECLARATION) {
            declaration(&analysis, file_scope, item);
        }
    }
    return analysis.invalid ? SEMANTIC_INVALID : SEMANTIC_VALID;
}
