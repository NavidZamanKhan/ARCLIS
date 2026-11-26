export const sumTemplates = {
  c: `#include <stdio.h>

int main(void) {
    int left, right;
    if (scanf("%d %d", &left, &right) != 2) {
        return 1;
    }
    printf("%d\\n", left + right);
    return 0;
}
`,
  cpp: `#include <iostream>

int main() {
    int left, right;
    if (!(std::cin >> left >> right)) {
        return 1;
    }
    std::cout << left + right << '\\n';
}
`,
  java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        if (!input.hasNextInt()) {
            System.exit(1);
        }
        int left = input.nextInt();
        if (!input.hasNextInt()) {
            System.exit(1);
        }
        System.out.println(left + input.nextInt());
    }
}
`,
  python: `import sys


def main():
    values = sys.stdin.read().split()
    if len(values) != 2:
        raise SystemExit(1)
    left, right = map(int, values)
    print(left + right)


if __name__ == '__main__':
    main()
`,
};
