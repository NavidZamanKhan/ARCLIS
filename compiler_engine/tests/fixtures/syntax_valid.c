#include <stdio.h>

static int total = 3, start;
double average(int size, double);
int choose(void);

static int sum_to(int limit) {
    int n = 0, sum = 0;
    for (int i = 1; i <= limit; ++i) {
        sum += i;
    }
    while (sum > 5) {
        sum--;
        ++n;
    }
    if (n > 0)
        if (sum == 5)
            return sum;
        else
            return n;
    return 0;
}

int main(void) {
    {
        char tag = 'x';
        printf("Tag %c " "sum %d\n", tag, sum_to(total));
    }
    for (start = 0, total = 4; start < total; start++, --total)
        ;
    return 0;
}
