#include "parser.tab.h"

int main(void)
{
    arclis_syntax_debug = 1;
    return syntax_analyze(stdin, NULL, NULL);
}
