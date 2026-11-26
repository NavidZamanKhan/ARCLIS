import java.util.Scanner;

public class InteractiveSum {
    public static void main(String[] args) {
        try (Scanner input = new Scanner(System.in)) {
            System.out.print("First value? ");
            System.out.flush();
            int left = input.nextInt();
            System.out.print("Second value? ");
            System.out.flush();
            int right = input.nextInt();
            System.out.println("Total = " + ((long) left + right));
        }
    }
}
