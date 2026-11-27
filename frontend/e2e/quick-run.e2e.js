import { expect, test } from '@playwright/test';

const modes = [
  ['C', 'c', 'main.c', `#include <stdio.h>

int main(void) {
    int a, b;

    printf("Enter first number: ");
    fflush(stdout);
    scanf("%d", &a);

    printf("Enter second number: ");
    fflush(stdout);
    scanf("%d", &b);

    printf("Result: %d\\n", a + b);
    return 0;
}`, [['Enter first number:', '7'], ['Enter second number:', '5']], 'Result: 12'],
  ['C++', 'cpp', 'main.cpp', `#include <iostream>
#include <string>
using namespace std;

int main() {
    string name;

    cout << "Enter your name: " << flush;
    getline(cin, name);

    cout << "Hello, " << name << endl;
    return 0;
}`, [['Enter your name:', 'Navid']], 'Hello, Navid'],
  ['Java', 'java', 'Main.java', `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        System.out.print("Enter a number: ");
        System.out.flush();

        int number = scanner.nextInt();

        System.out.println(number * 2);
    }
}`, [['Enter a number:', '9']], '18'],
  ['Python', 'python', 'main.py', `name = input("Enter your name: ")
age = input("Enter your age: ")

print(f"Hello, {name}. You are {age} years old.")`,
  [['Enter your name:', 'Navid'], ['Enter your age:', '23']], 'Hello, Navid. You are 23 years old.'],
];

const consoleRows = (page) => page.locator('.xterm-rows');
const consoleLine = (page, prompt) => consoleRows(page).locator(':scope > div').filter({ hasText: prompt });
const status = (page) => page.getByRole('status', { name: 'Execution status' });
const language = (page) => page.getByLabel('Programming language');

async function replaceSource(page, source) {
  await page.bringToFront();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.locator('.source-editor-host .view-line').first().click({ position: { x: 3, y: 8 } });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+v');
}

async function run(page, code, file, content, start = () => page.getByRole('button', { name: 'Run', exact: true }).click()) {
  const request = page.waitForRequest((item) => item.method() === 'POST' && item.url().endsWith('/api/v1/executions/'));
  await start();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({ language: code, entry_file: file, files: [{ path: file, content }] });
  if (code === 'java') expect(body.main_class).toBe('Main');
  expect(body.files).toHaveLength(1);
}

for (const [label, code, file, content, prompts, output] of modes) {
  test(`${label} runs from a blank draft and accepts input in the terminal`, async ({ page }) => {
    const sessions = [];
    const results = [];
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/ws/executions/')) return;
      sessions.push(socket);
      socket.on('framereceived', ({ payload }) => {
        const packet = JSON.parse(String(payload));
        if (packet.type === 'result') results.push(packet);
      });
    });
    await page.goto('/');
    await language(page).selectOption(code);
    await expect(page.locator('.source-editor-host .view-line').first()).toBeVisible();
    await expect(page.locator('.source-editor-host .view-lines')).toHaveText(/^[\s\u00a0]*$/);
    await expect(page.getByLabel('Execution target')).toHaveCount(0);
    await replaceSource(page, content);
    await run(page, code, file, content);

    for (const [prompt, input] of prompts) {
      await expect(consoleRows(page)).toContainText(prompt);
      await expect(status(page)).toHaveText('Running');
      const terminal = page.locator('.xterm-screen');
      await terminal.click({ position: { x: 6, y: 8 } });
      await page.keyboard.type(input + 'x');
      await expect(consoleLine(page, prompt)).toContainText(prompt + ' ' + input + 'x');
      await page.keyboard.press('Backspace');
      await expect(consoleLine(page, prompt)).toContainText(prompt + ' ' + input);
      await expect(consoleLine(page, prompt)).not.toContainText(input + 'x');
      await page.keyboard.press('Enter');
    }
    await expect(consoleRows(page)).toContainText(output);
    await expect(status(page)).toHaveText('Completed');
    expect(sessions).toHaveLength(1);
    expect(results).toMatchObject([{ state: 'COMPLETED', exit_code: 0 }]);
  });
}

test('Run reads immediate edits and restores each language draft after refresh', async ({ page }) => {
  await page.goto('/');
  await language(page).selectOption('python');
  const first = 'print("first-audit-source")';
  const second = 'print("second-audit-source")';
  await replaceSource(page, first);
  await run(page, 'python', 'main.py', first);
  await expect(status(page)).toHaveText('Completed');
  await expect(consoleRows(page)).toContainText('first-audit-source');
  await replaceSource(page, second);
  await run(page, 'python', 'main.py', second, () => page.keyboard.press('Control+Enter'));
  await expect(page.locator('.source-editor-host .view-line')).toHaveCount(1);
  await expect(status(page)).toHaveText('Completed');
  await expect(consoleRows(page)).toContainText('second-audit-source');
  await expect(consoleRows(page)).not.toContainText('first-audit-source');

  await language(page).selectOption('cpp');
  const cpp = '#include <iostream>\nint main() { std::cout << "cpp-audit-source"; }';
  await replaceSource(page, cpp);
  await run(page, 'cpp', 'main.cpp', cpp);
  await expect(status(page)).toHaveText('Completed');
  await expect(consoleRows(page)).toContainText('cpp-audit-source');
  await language(page).selectOption('python');
  await page.reload();
  await expect(language(page)).toHaveValue('python');
  await expect(page.locator('.source-editor-host .view-line').first()).toContainText('second-audit-source');
  await expect(status(page)).toHaveText('Ready');
});

test('stages pasted input, submits one line at a time, and closes stdin on Ctrl+D', async ({ page }) => {
  const packets = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => packets.push(JSON.parse(String(payload))));
  });
  await page.goto('/');
  await language(page).selectOption('python');
  const source = 'import sys\nprint(repr(input("first? ")), flush=True)\nprint(repr(input("second? ")), flush=True)\nprint("eof:", not sys.stdin.read())';
  await replaceSource(page, source);
  await run(page, 'python', 'main.py', source);
  await expect(consoleRows(page)).toContainText('first?');
  await page.evaluate(() => navigator.clipboard.writeText('x'.repeat(4096)));
  await page.locator('.xterm-screen').click({ position: { x: 6, y: 8 } });
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Debug' }).getByRole('alert')).toContainText('4096');
  await expect(consoleLine(page, 'first?')).toContainText('first? xxxx');
  expect(packets).toHaveLength(0);
  await page.getByRole('button', { name: 'Clear staged input' }).click();
  await page.evaluate(() => navigator.clipboard.writeText('first\nsecond'));
  await page.locator('.xterm-screen').click({ position: { x: 6, y: 8 } });
  await page.keyboard.press('Control+v');
  await expect(consoleLine(page, 'first?')).toHaveText('first? first');
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(consoleLine(page, 'first?')).toHaveText('first? first');
  await expect(page.getByText('More pasted input is queued.')).toBeVisible();
  expect(packets).toHaveLength(0);
  await page.keyboard.press('Enter');
  await expect(consoleLine(page, 'second?')).toContainText('second? second');
  await expect(consoleLine(page, 'first?')).toHaveText('first? first');
  expect(packets).toMatchObject([{ type: 'stdin', data: 'first\n' }]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(consoleRows(page)).toContainText("'second'");
  await page.keyboard.press('Control+d');
  await expect(consoleRows(page)).toContainText('eof: True');
  await expect(status(page)).toHaveText('Completed');
  expect(packets).toMatchObject([{ type: 'stdin', data: 'first\n' }, { type: 'stdin', data: 'second\n' }, { type: 'eof' }]);
});

test('keeps Projects and Quick Run drafts independent through edits and reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Navigator' })).toHaveCount(0);
  await replaceSource(page, 'int main(void) { return 23; }');
  await page.getByRole('button', { name: 'Examples' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.source-editor-host .view-lines')).toContainText('return 23');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText(/No project files/)).toBeVisible();
  await page.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'New File', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('solo.py');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Execution target')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute('title', 'Run solo.py (Ctrl+Enter)');
  await replaceSource(page, 'print("project buffer")');
  await page.getByRole('button', { name: 'Quick Run', exact: true }).click();
  await expect(page.locator('.source-editor-host .view-lines')).toContainText('return 23');
  await page.reload();
  await expect(page.locator('.source-editor-host .view-lines')).toContainText('return 23');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('.source-editor-host .view-lines')).toContainText('project buffer');
});

test('keeps the editor available and retries when the loopback backend is offline', async ({ page }) => {
  await page.route('**/api/v1/capabilities/', (route) => route.abort(), { times: 1 });
  await page.goto('/');
  await expect(status(page)).toHaveText('Service unavailable');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await replaceSource(page, 'int main(void) { return 0; }');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Retry services', exact: true }).click();
  await expect(status(page)).toHaveText('Ready');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
});
