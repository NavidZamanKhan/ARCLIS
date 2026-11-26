#include "ir.h"
#include "cli_io.h"

#include <stdlib.h>
#include <string.h>

typedef enum {
    OPERAND_NONE,
    OPERAND_TEMPORARY,
    OPERAND_SYMBOL,
    OPERAND_LITERAL,
    OPERAND_BOOLEAN,
} OperandKind;

typedef struct {
    OperandKind kind;
    size_t number;
    const AstNode *literal;
} Operand;

typedef enum {
    IR_GLOBAL,
    IR_LOCAL,
    IR_FUNCTION,
    IR_PARAMETER,
    IR_END_FUNCTION,
    IR_LOAD,
    IR_STORE,
    IR_BINARY,
    IR_UNARY,
    IR_MOVE,
    IR_TRUTH,
    IR_LABEL,
    IR_JUMP,
    IR_BRANCH_ZERO,
    IR_BRANCH_NONZERO,
    IR_ARGUMENT,
    IR_CALL,
    IR_RETURN,
} IrOp;

typedef struct {
    IrOp op;
    const AstNode *source;
    bool initializer;
    Operand result;
    Operand left;
    Operand right;
    AstText operator;
    size_t label;
    size_t call_site;
    size_t argument;
} Instruction;

struct IrProgram {
    Instruction *instructions;
    size_t count;
    size_t capacity;
};

typedef struct {
    IrProgram *program;
    const SymbolTable *symbols;
    size_t temporaries;
    size_t labels;
    size_t calls;
    bool initializer;
    bool failed;
} Lowering;

static Operand lower_expression(Lowering *lowering, const AstNode *node);
static void lower_statement(Lowering *lowering, const AstNode *node);

static void emit(Lowering *lowering, const AstNode *source, Instruction instruction)
{
    IrProgram *program = lowering->program;
    if (program->count == program->capacity) {
        lowering->failed = true;
        return;
    }
    instruction.source = source;
    instruction.initializer = lowering->initializer;
    program->instructions[program->count++] = instruction;
}

static Operand temporary(Lowering *lowering)
{
    return (Operand){.kind = OPERAND_TEMPORARY, .number = ++lowering->temporaries};
}

static Operand boolean(bool value)
{
    return (Operand){.kind = OPERAND_BOOLEAN, .number = value};
}

static Operand bound_operand(const Lowering *lowering, const AstNode *node)
{
    const Symbol *symbol = lowering->symbols->bindings[node->index];
    return (Operand){.kind = OPERAND_SYMBOL, .number = (size_t)(symbol - lowering->symbols->symbols) + 1};
}

static Operand assignment_target(const Lowering *lowering, const AstNode *node)
{
    while (node->kind == AST_PARENTHESIZED) {
        node = node->as.expression;
    }
    /* Semantic analysis accepts only identifiers as modifiable objects. */
    return bound_operand(lowering, node);
}

static Operand load_object(Lowering *lowering, const AstNode *node, Operand object)
{
    const Operand result = temporary(lowering);
    emit(lowering, node, (Instruction){.op = IR_LOAD, .result = result, .left = object});
    return result;
}

static void store_object(Lowering *lowering, const AstNode *node, Operand object, Operand value)
{
    emit(lowering, node, (Instruction){.op = IR_STORE, .result = object, .left = value});
}

static Operand binary(Lowering *lowering, const AstNode *node, AstText operator, Operand left, Operand right)
{
    const Operand result = temporary(lowering);
    emit(lowering, node, (Instruction){.op = IR_BINARY, .operator = operator, .result = result, .left = left, .right = right});
    return result;
}

static Operand lower_logical(Lowering *lowering, const AstNode *node, bool is_or)
{
    const AstNode *left = node->as.binary.left;
    const Operand first = lower_expression(lowering, left);
    const size_t shortcut = ++lowering->labels;
    const size_t end = ++lowering->labels;
    emit(lowering, left, (Instruction){.op = is_or ? IR_BRANCH_NONZERO : IR_BRANCH_ZERO, .left = first, .label = shortcut});

    const AstNode *right = node->as.binary.right;
    const Operand second = lower_expression(lowering, right);
    const Operand result = temporary(lowering);
    emit(lowering, right, (Instruction){.op = IR_TRUTH, .result = result, .left = second});
    emit(lowering, node, (Instruction){.op = IR_JUMP, .label = end});
    emit(lowering, node, (Instruction){.op = IR_LABEL, .label = shortcut});
    emit(lowering, node, (Instruction){.op = IR_MOVE, .result = result, .left = boolean(is_or)});
    emit(lowering, node, (Instruction){.op = IR_LABEL, .label = end});
    return result;
}

static Operand lower_binary(Lowering *lowering, const AstNode *node)
{
    const char *operator = node->as.binary.operator;
    if (operator[0] == '&' || operator[0] == '|') {
        return lower_logical(lowering, node, operator[0] == '|');
    }
    const Operand left = lower_expression(lowering, node->as.binary.left);
    const Operand right = lower_expression(lowering, node->as.binary.right);
    if (operator[0] == ',') {
        return right;
    }
    return binary(lowering, node, (AstText){operator, strlen(operator)}, left, right);
}

static Operand lower_assignment(Lowering *lowering, const AstNode *node)
{
    const AstNode *left = node->as.binary.left;
    const Operand object = assignment_target(lowering, left);
    const char *operator = node->as.binary.operator;
    Operand value;
    if (operator[0] == '=') {
        value = lower_expression(lowering, node->as.binary.right);
    } else {
        const Operand old = load_object(lowering, left, object);
        const Operand right = lower_expression(lowering, node->as.binary.right);
        value = binary(lowering, node, (AstText){operator, 1}, old, right);
    }
    store_object(lowering, node, object, value);
    /* The value of assignment is the value after conversion to the target type. */
    return load_object(lowering, node, object);
}

static Operand lower_unary(Lowering *lowering, const AstNode *node)
{
    const char *operator = node->as.unary.operator;
    const AstNode *operand = node->as.unary.operand;
    if (operator[1] != '\0') {
        const Operand object = assignment_target(lowering, operand);
        const Operand old = load_object(lowering, operand, object);
        const Operand value = binary(lowering, node, (AstText){operator, 1}, old, boolean(true));
        store_object(lowering, node, object, value);
        return node->as.unary.postfix ? old : load_object(lowering, node, object);
    }
    const Operand input = lower_expression(lowering, operand);
    const Operand result = temporary(lowering);
    emit(lowering, node, (Instruction){.op = IR_UNARY, .operator = {operator, 1}, .result = result, .left = input});
    return result;
}

static Operand lower_call(Lowering *lowering, const AstNode *node)
{
    const Operand callee = lower_expression(lowering, node->as.call.callee);
    const Symbol *function = &lowering->symbols->symbols[callee.number - 1];
    const size_t call_site = ++lowering->calls;
    size_t count = 0;
    for (const AstNode *argument = node->as.call.arguments.first; argument != NULL; argument = argument->next) {
        const Operand value = lower_expression(lowering, argument);
        emit(lowering, argument, (Instruction){.op = IR_ARGUMENT, .left = value, .call_site = call_site, .argument = count++});
    }
    const Operand result = function->type == AST_TYPE_VOID ? (Operand){0} : temporary(lowering);
    emit(lowering, node, (Instruction){.op = IR_CALL, .result = result, .left = callee, .call_site = call_site, .argument = count});
    return result;
}

static Operand lower_expression(Lowering *lowering, const AstNode *node)
{
    switch (node->kind) {
    case AST_IDENTIFIER: {
        const Operand binding = bound_operand(lowering, node);
        const Symbol *symbol = lowering->symbols->bindings[node->index];
        return symbol->kind == SYMBOL_FUNCTION ? binding : load_object(lowering, node, binding);
    }
    case AST_LITERAL:
    case AST_STRING_LITERAL:
        return (Operand){.kind = OPERAND_LITERAL, .literal = node};
    case AST_PARENTHESIZED:
        return lower_expression(lowering, node->as.expression);
    case AST_BINARY:
        return lower_binary(lowering, node);
    case AST_ASSIGNMENT:
        return lower_assignment(lowering, node);
    case AST_UNARY:
        return lower_unary(lowering, node);
    case AST_CALL:
        return lower_call(lowering, node);
    default:
        lowering->failed = true;
        return (Operand){0};
    }
}

static void lower_declaration(Lowering *lowering, const AstNode *node)
{
    const bool outer_section = lowering->initializer;
    for (const AstNode *item = node->as.declaration.declarators.first; item != NULL; item = item->next) {
        const Symbol *symbol = lowering->symbols->bindings[item->index];
        const Operand object = bound_operand(lowering, item);
        lowering->initializer = outer_section || symbol->is_static;
        if (symbol->declaration == item) {
            emit(lowering, item, (Instruction){.op = lowering->initializer ? IR_GLOBAL : IR_LOCAL, .result = object});
        }
        if (item->as.declarator.initializer != NULL) {
            const Operand value = lower_expression(lowering, item->as.declarator.initializer);
            store_object(lowering, item, object, value);
        }
    }
    lowering->initializer = outer_section;
}

static void branch_if_zero(Lowering *lowering, const AstNode *condition, size_t label)
{
    const Operand value = lower_expression(lowering, condition);
    emit(lowering, condition, (Instruction){.op = IR_BRANCH_ZERO, .left = value, .label = label});
}

static void lower_if(Lowering *lowering, const AstNode *node)
{
    size_t end = ++lowering->labels;
    branch_if_zero(lowering, node->as.conditional.condition, end);
    lower_statement(lowering, node->as.conditional.then_branch);
    if (node->as.conditional.else_branch != NULL) {
        const size_t otherwise = end;
        end = ++lowering->labels;
        emit(lowering, node, (Instruction){.op = IR_JUMP, .label = end});
        emit(lowering, node, (Instruction){.op = IR_LABEL, .label = otherwise});
        lower_statement(lowering, node->as.conditional.else_branch);
    }
    emit(lowering, node, (Instruction){.op = IR_LABEL, .label = end});
}

static void lower_loop(Lowering *lowering, const AstNode *node, const AstNode *condition, const AstNode *body,
                       const AstNode *step)
{
    const size_t head = ++lowering->labels;
    const size_t end = condition == NULL ? 0 : ++lowering->labels;
    emit(lowering, node, (Instruction){.op = IR_LABEL, .label = head});
    if (condition != NULL) {
        branch_if_zero(lowering, condition, end);
    }
    lower_statement(lowering, body);
    if (step != NULL) {
        lower_expression(lowering, step);
    }
    emit(lowering, node, (Instruction){.op = IR_JUMP, .label = head});
    if (condition != NULL) {
        emit(lowering, node, (Instruction){.op = IR_LABEL, .label = end});
    }
}

static void lower_statement(Lowering *lowering, const AstNode *node)
{
    if (node == NULL) {
        return;
    }
    switch (node->kind) {
    case AST_DECLARATION:
        lower_declaration(lowering, node);
        break;
    case AST_BLOCK:
        for (const AstNode *item = node->as.list.first; item != NULL; item = item->next) {
            lower_statement(lowering, item);
        }
        break;
    case AST_IF:
        lower_if(lowering, node);
        break;
    case AST_WHILE:
        lower_loop(lowering, node, node->as.while_loop.condition, node->as.while_loop.body, NULL);
        break;
    case AST_FOR:
        lower_statement(lowering, node->as.for_loop.initializer);
        lower_loop(lowering, node, node->as.for_loop.condition, node->as.for_loop.body, node->as.for_loop.step);
        break;
    case AST_RETURN: {
        const AstNode *value = node->as.expression;
        const Operand returned = value == NULL ? (Operand){0} : lower_expression(lowering, value);
        emit(lowering, node, (Instruction){.op = IR_RETURN, .left = returned});
        break;
    }
    case AST_EXPRESSION_STATEMENT:
        lower_expression(lowering, node->as.expression);
        break;
    case AST_EMPTY_STATEMENT:
        break;
    default:
        lower_expression(lowering, node);
        break;
    }
}

static void lower_function(Lowering *lowering, const AstNode *node)
{
    const Operand function = bound_operand(lowering, node);
    emit(lowering, node, (Instruction){.op = IR_FUNCTION, .result = function});
    size_t index = 0;
    for (const AstNode *parameter = node->as.function.parameters.first; parameter != NULL; parameter = parameter->next) {
        emit(lowering, parameter, (Instruction){.op = IR_PARAMETER, .result = bound_operand(lowering, parameter), .argument = index++});
    }
    lower_statement(lowering, node->as.function.body);
    emit(lowering, node, (Instruction){.op = IR_END_FUNCTION, .result = function});
}

IrProgram *ir_generate(const AstTree *tree, const SymbolTable *symbols)
{
    IrProgram *program = malloc(sizeof(*program));
    if (program == NULL) {
        return NULL;
    }
    /* Short-circuit operators emit the most instructions per node (six). */
    *program = (IrProgram){.capacity = 6 * ast_node_count(tree)};
    program->instructions = malloc(program->capacity * sizeof(*program->instructions));
    if (program->instructions == NULL) {
        ir_destroy(program);
        return NULL;
    }
    Lowering lowering = {.program = program, .symbols = symbols};
    for (const AstNode *item = ast_root(tree)->as.list.first; item != NULL; item = item->next) {
        if (item->kind == AST_DECLARATION) {
            lowering.initializer = true;
            lower_declaration(&lowering, item);
            lowering.initializer = false;
        } else if (item->kind == AST_FUNCTION && item->as.function.body != NULL) {
            lower_function(&lowering, item);
        }
    }
    if (lowering.failed) {
        ir_destroy(program);
        return NULL;
    }
    return program;
}

void ir_destroy(IrProgram *program)
{
    if (program != NULL) {
        free(program->instructions);
        free(program);
    }
}

static void write_literal(FILE *output, const AstNode *node)
{
    static const char *const names[] = {
        [AST_INTEGER] = "integer", [AST_FLOATING] = "floating", [AST_CHARACTER] = "character", [AST_STRING] = "string",
    };
    if (node->kind == AST_STRING_LITERAL) {
        fputs("{\"kind\":\"literal\",\"literalKind\":\"string\",\"segments\":[", output);
        for (const AstNode *segment = node->as.list.first; segment != NULL; segment = segment->next) {
            const AstText text = segment->as.literal.text;
            cli_write_string(output, text.data, text.length);
            if (segment->next != NULL) {
                fputc(',', output);
            }
        }
        fputs("]}", output);
        return;
    }
    fprintf(output, "{\"kind\":\"literal\",\"literalKind\":\"%s\",\"text\":", names[node->as.literal.kind]);
    const AstText text = node->as.literal.text;
    cli_write_string(output, text.data, text.length);
    fputc('}', output);
}

static void write_operand(FILE *output, const char *field, Operand operand)
{
    fprintf(output, ",\"%s\":", field);
    switch (operand.kind) {
    case OPERAND_NONE:
        fputs("null", output);
        break;
    case OPERAND_TEMPORARY:
    case OPERAND_SYMBOL:
        fprintf(output, "{\"kind\":\"%s\",\"id\":%zu}", operand.kind == OPERAND_SYMBOL ? "symbol" : "temp", operand.number);
        break;
    case OPERAND_LITERAL:
        write_literal(output, operand.literal);
        break;
    case OPERAND_BOOLEAN:
        fprintf(output, "{\"kind\":\"literal\",\"literalKind\":\"integer\",\"text\":\"%zu\"}", operand.number);
        break;
    }
}

static void write_instruction(FILE *output, const Instruction *instruction)
{
    static const char *const operations[] = {
        [IR_GLOBAL] = "global", [IR_LOCAL] = "local", [IR_FUNCTION] = "function", [IR_PARAMETER] = "parameter",
        [IR_END_FUNCTION] = "end-function", [IR_LOAD] = "load", [IR_STORE] = "store", [IR_BINARY] = "binary",
        [IR_UNARY] = "unary", [IR_MOVE] = "move", [IR_TRUTH] = "truth", [IR_LABEL] = "label", [IR_JUMP] = "jump",
        [IR_BRANCH_ZERO] = "branch-zero", [IR_BRANCH_NONZERO] = "branch-nonzero", [IR_ARGUMENT] = "argument",
        [IR_CALL] = "call", [IR_RETURN] = "return",
    };
    fprintf(output, "{\"op\":\"%s\",\"range\":", operations[instruction->op]);
    cli_write_range(output, instruction->source->range);
    switch (instruction->op) {
    case IR_PARAMETER:
        fprintf(output, ",\"index\":%zu", instruction->argument);
        /* fall through */
    case IR_GLOBAL:
    case IR_LOCAL:
    case IR_FUNCTION:
    case IR_END_FUNCTION:
        write_operand(output, "symbol", instruction->result);
        break;
    case IR_LOAD:
        write_operand(output, "result", instruction->result);
        write_operand(output, "source", instruction->left);
        break;
    case IR_STORE:
        write_operand(output, "target", instruction->result);
        write_operand(output, "value", instruction->left);
        break;
    case IR_BINARY:
    case IR_UNARY:
        write_operand(output, "result", instruction->result);
        fputs(",\"operator\":", output);
        cli_write_string(output, instruction->operator.data, instruction->operator.length);
        if (instruction->op == IR_BINARY) {
            write_operand(output, "left", instruction->left);
            write_operand(output, "right", instruction->right);
        } else {
            write_operand(output, "operand", instruction->left);
        }
        break;
    case IR_MOVE:
    case IR_TRUTH:
        write_operand(output, "result", instruction->result);
        write_operand(output, "value", instruction->left);
        break;
    case IR_LABEL:
        fprintf(output, ",\"label\":%zu", instruction->label);
        break;
    case IR_BRANCH_ZERO:
    case IR_BRANCH_NONZERO:
        write_operand(output, "value", instruction->left);
        /* fall through */
    case IR_JUMP:
        fprintf(output, ",\"target\":%zu", instruction->label);
        break;
    case IR_ARGUMENT:
        fprintf(output, ",\"callSite\":%zu,\"index\":%zu", instruction->call_site, instruction->argument);
        write_operand(output, "value", instruction->left);
        break;
    case IR_CALL:
        fprintf(output, ",\"callSite\":%zu,\"argumentCount\":%zu", instruction->call_site, instruction->argument);
        write_operand(output, "result", instruction->result);
        write_operand(output, "callee", instruction->left);
        break;
    case IR_RETURN:
        write_operand(output, "value", instruction->left);
        break;
    }
    fputc('}', output);
}

static void write_section(FILE *output, const IrProgram *program, bool initializer)
{
    bool first = true;
    for (size_t index = 0; index < program->count; ++index) {
        const Instruction *instruction = &program->instructions[index];
        if (instruction->initializer == initializer) {
            if (!first) {
                fputc(',', output);
            }
            write_instruction(output, instruction);
            first = false;
        }
    }
}

void ir_write_json(FILE *output, const IrProgram *program)
{
    fputs("{\"kind\":\"ir\",\"initializers\":[", output);
    write_section(output, program, true);
    fputs("],\"instructions\":[", output);
    write_section(output, program, false);
    fputs("]}", output);
}
