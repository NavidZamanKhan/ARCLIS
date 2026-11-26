#include <iostream>

int main() {
    int left, right;
    std::cout << "First value? " << std::flush;
    if (!(std::cin >> left)) return 1;
    std::cout << "Second value? " << std::flush;
    if (!(std::cin >> right)) return 1;
    std::cout << "Total = " << static_cast<long long>(left) + right << '\n';
}
