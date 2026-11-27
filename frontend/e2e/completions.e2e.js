import { expect, test } from '@playwright/test';

const editorLines = (page) => page.locator('.source-editor-host .view-line');
const suggestion = (page, label) => page.locator('.suggest-widget .monaco-list-row').filter({ hasText: label });

async function openEditor(page, language) {
  await page.goto('/');
  await page.getByLabel('Programming language').selectOption(language);
  await editorLines(page).first().click({ position: { x: 3, y: 8 } });
}

async function pasteSource(page, source) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((value) => navigator.clipboard.writeText(value), source);
  await page.keyboard.press('Control+v');
}

for (const [language, prefix, completion] of [
  ['c', 'pri', 'printf'],
  ['cpp', 'std::co', 'std::cout'],
  ['python', 'pri', 'print'],
]) {
  test(`${language} suggests a library name as you type`, async ({ page }) => {
    await openEditor(page, language);
    await page.keyboard.type(prefix);
    await expect(suggestion(page, completion).first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(editorLines(page).first()).toHaveText(completion);
  });
}

test('Ctrl+Space suggests words already in the current file', async ({ page }) => {
  await openEditor(page, 'python');
  await pasteSource(page, 'device_count = 0\n');
  await page.keyboard.type('device_co');
  await expect(suggestion(page, 'device_count')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(suggestion(page, 'device_count')).not.toBeVisible();
  await page.keyboard.press('Control+Space');
  await expect(suggestion(page, 'device_count')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(editorLines(page).last()).toHaveText('device_count');
});

test('sout expands on Tab and leaves the Java cursor inside println', async ({ page }) => {
  await openEditor(page, 'java');
  await pasteSource(page, 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}');
  await editorLines(page).nth(2).click({ position: { x: 30, y: 8 } });
  await page.keyboard.press('End');
  await page.keyboard.type('sout');
  await page.keyboard.press('Tab');
  await expect(editorLines(page).nth(2)).toContainText('System.out.println();');
  await page.keyboard.type('42');
  await expect(editorLines(page).nth(2)).toContainText('System.out.println(42);');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status', { name: 'Execution status' })).toHaveText('Completed');
  await expect(page.locator('.xterm-rows')).toContainText('42');
});
