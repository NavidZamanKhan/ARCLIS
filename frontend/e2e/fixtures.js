export const interactivePrograms = [
  {
    language: 'C',
    entry: 'Exercise.c',
    files: {
      'Exercise.c': `#include <stdio.h>
#include <stdlib.h>
#include "fixture.h"

int main(void) {
    char line[32];
    puts("first value");
    fflush(stdout);
    if (!fgets(line, sizeof line, stdin)) return 1;
    int first = atoi(line);
    puts("second value");
    fflush(stdout);
    if (!fgets(line, sizeof line, stdin)) return 1;
    printf("total: %d\\n", fixture_sum(first, atoi(line)));
    puts("waiting for EOF");
    fflush(stdout);
    while (fgets(line, sizeof line, stdin)) { }
    puts("input closed");
    return 0;
}
`,
      'fixture.h': 'int fixture_sum(int first, int second);\n',
      'fixture.c': '#include "fixture.h"\nint fixture_sum(int first, int second) { return first + second; }\n',
    },
  },
  {
    language: 'C++',
    entry: 'Exercise.cpp',
    files: {
      'Exercise.cpp': `#include <iostream>
#include <string>
#include "fixture.hpp"

int main() {
    std::string line;
    std::cout << "first value" << std::endl;
    if (!std::getline(std::cin, line)) return 1;
    int first = std::stoi(line);
    std::cout << "second value" << std::endl;
    if (!std::getline(std::cin, line)) return 1;
    std::cout << "total: " << fixture_sum(first, std::stoi(line)) << std::endl;
    std::cout << "waiting for EOF" << std::endl;
    while (std::getline(std::cin, line)) { }
    std::cout << "input closed" << std::endl;
}
`,
      'fixture.hpp': 'int fixture_sum(int first, int second);\n',
      'fixture.cpp': '#include "fixture.hpp"\nint fixture_sum(int first, int second) { return first + second; }\n',
    },
  },
  {
    language: 'Java',
    entry: 'Exercise.java',
    files: {
      'Exercise.java': `package exercise;
import java.util.Scanner;

public class Exercise {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        System.out.println("first value");
        int first = Integer.parseInt(input.nextLine());
        System.out.println("second value");
        int second = Integer.parseInt(input.nextLine());
        System.out.println("total: " + Fixture.sum(first, second));
        System.out.println("waiting for EOF");
        while (input.hasNextLine()) input.nextLine();
        System.out.println("input closed");
    }
}
`,
      'Fixture.java': 'package exercise;\nclass Fixture { static int sum(int first, int second) { return first + second; } }\n',
    },
  },
  {
    language: 'Python',
    entry: 'exercise.py',
    files: {
      'exercise.py': `import sys
from fixture import fixture_sum

print('first value', flush=True)
first = int(input())
print('second value', flush=True)
second = int(input())
print(f'total: {fixture_sum(first, second)}', flush=True)
print('waiting for EOF', flush=True)
for _ in sys.stdin:
    pass
print('input closed', flush=True)
`,
      'fixture.py': 'def fixture_sum(first, second):\n    return first + second\n',
    },
  },
];
