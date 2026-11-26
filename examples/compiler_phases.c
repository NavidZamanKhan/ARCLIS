#include <stdio.h>

/* The educational analyzer sees this declaration in the current buffer. */
int putchar(int character);

static int sum_to(int limit) {
    int total = 0;
    for (int value = 1; value <= limit; value++) {
        total += value;
    }
    return total;
}

int main(void) {
    int total = sum_to(4);
    if (total == 10 && total > 0) {
        putchar('O');
        putchar('K');
        putchar('\n');
        return 0;
    }
    return 1;
}
