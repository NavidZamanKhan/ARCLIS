#ifndef ARCLIS_IR_H
#define ARCLIS_IR_H

#include "symbol_table.h"

typedef struct IrProgram IrProgram;

/* Generate from the AST and symbol table of a successful semantic analysis.
 * The program borrows AST source text and ranges until it is destroyed. */
IrProgram *ir_generate(const AstTree *tree, const SymbolTable *symbols);
void ir_write_json(FILE *output, const IrProgram *program);
void ir_destroy(IrProgram *program);

#endif
