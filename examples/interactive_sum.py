def formatter(label):
    def format_total(total):
        return f"{label} = {total}"

    return format_total


def main():
    left = int(input("First value? "))
    right = int(input("Second value? "))
    print(formatter("Total")(left + right))


if __name__ == "__main__":
    main()
