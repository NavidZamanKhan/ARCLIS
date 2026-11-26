#include "syntax.h"

#include <string.h>

static SyntaxStatus read_tree(const char *source, AstTree **tree)
{
    FILE *input = tmpfile();
    if (input == NULL) {
        return SYNTAX_FAILURE;
    }
    SyntaxStatus status = SYNTAX_FAILURE;
    if (fputs(source, input) != EOF && fseek(input, 0, SEEK_SET) == 0) {
        status = syntax_analyze_ast(input, tree, NULL, NULL);
    }
    fclose(input);
    return status;
}

static bool equal(AstText text, const char *expected)
{
    const size_t length = strlen(expected);
    return text.data != NULL && text.length == length && memcmp(text.data, expected, length) == 0;
}

int main(void)
{
    AstTree *first = NULL;
    AstTree *second = NULL;
    AstTree *invalid = NULL;
    const SyntaxStatus first_status = read_tree("int first(void) { return 0x2au; }", &first);
    const SyntaxStatus second_status = read_tree("int second(void) { return 100; }", &second);
    const SyntaxStatus invalid_status = read_tree("int broken = ;", &invalid);
    bool passed = first_status == SYNTAX_VALID && second_status == SYNTAX_VALID
        && invalid_status == SYNTAX_INVALID && invalid == NULL && first != NULL && second != NULL;

    if (passed) {
        const AstNode *second_function = ast_root(second)->as.list.first;
        passed = second_function != NULL && second_function->kind == AST_FUNCTION
            && equal(second_function->as.function.name, "second");
    }
    ast_destroy(second);
    if (passed) {
        const AstNode *root = ast_root(first);
        const AstNode *function = root != NULL && root->kind == AST_PROGRAM ? root->as.list.first : NULL;
        const AstNode *block = function != NULL && function->kind == AST_FUNCTION ? function->as.function.body : NULL;
        const AstNode *statement = block != NULL && block->kind == AST_BLOCK ? block->as.list.first : NULL;
        const AstNode *literal = statement != NULL && statement->kind == AST_RETURN ? statement->as.expression : NULL;
        passed = literal != NULL && literal->kind == AST_LITERAL
            && equal(function->as.function.name, "first") && equal(literal->as.literal.text, "0x2au");
    }
    ast_destroy(first);
    ast_destroy(invalid);
    puts(passed ? "Independent AST ownership passed." : "Independent AST ownership failed.");
    return passed ? 0 : 1;
}
