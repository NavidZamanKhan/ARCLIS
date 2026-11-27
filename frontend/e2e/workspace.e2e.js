import { expect, test } from '@playwright/test';

import { interactivePrograms } from './fixtures.js';

const backend = 'http://127.0.0.1:8000';
const runButton = (page) => page.getByRole('button', { name: 'Run', exact: true });
const status = (page) => page.getByRole('status', { name: 'Execution status' });
const debug = (page) => page.getByRole('region', { name: 'Debug' });
const inspector = (page) => page.getByRole('complementary', { name: 'Inspector' });
const navigator = (page) => page.getByRole('complementary', { name: 'Navigator' });

async function launch(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await navigator(page).getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Reset Workspace', exact: true }).click();
  const reset = page.getByRole('dialog', { name: 'Reset Workspace' });
  await reset.getByRole('radio', { name: 'Restore sample files' }).check();
  await reset.getByRole('button', { name: 'Reset Workspace' }).click();
  await expect(navigator(page).getByRole('button', { name: 'main.c, C', exact: true })).toBeVisible();
}

async function openFile(page, path, language) {
  await navigator(page).getByRole('button', { name: `${path}, ${language}`, exact: true }).click();
}

async function editSource(page, content) {
  await page.bringToFront();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((source) => navigator.clipboard.writeText(source), content);
  await page.locator('.source-editor-host .view-line').first().click({ position: { x: 3, y: 8 } });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+v');
}

async function selectTarget(page, entry) {
  await inspector(page).getByRole('button', { name: 'File', exact: true }).click();
  await inspector(page).getByLabel('Execution target').selectOption({ label: entry });
}

async function uploadExercise(page, files) {
  await navigator(page).getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'New Folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Folder' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('exercise');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await navigator(page).getByRole('button', { name: 'Actions for exercise', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Upload Files', exact: true }).click();
  await (await chooser).setFiles(Object.entries(files).map(([name, source]) => ({
    name, mimeType: 'text/plain', buffer: Buffer.from(source),
  })));
}

async function consoleContains(page, text) {
  await expect(debug(page).locator('.xterm-rows')).toContainText(text);
}

async function sendLine(page, line) {
  await debug(page).locator('.xterm-screen').click({ position: { x: 6, y: 8 } });
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

async function analyze(page, language) {
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  return page.getByRole('region', { name: `${language} analysis` });
}

async function expectEditorFocus(page) {
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.monaco-editor')))).toBe(true);
}

for (const fixture of interactivePrograms) {
  test(`${fixture.language} runs a multi-file program with two input lines and EOF`, async ({ page }) => {
    await launch(page);
    await uploadExercise(page, fixture.files);
    const path = 'exercise/' + fixture.entry;
    await openFile(page, path, fixture.language);
    await selectTarget(page, path);
    await runButton(page).click();
    await consoleContains(page, 'first value');
    await sendLine(page, '7');
    await consoleContains(page, 'second value');
    await sendLine(page, '5');
    await consoleContains(page, 'total: 12');
    await consoleContains(page, 'waiting for EOF');
    await debug(page).getByRole('button', { name: 'Send EOF', exact: true }).click();
    await consoleContains(page, 'input closed');
    await expect(status(page)).toHaveText('Completed');
  });
}

test('persists live edits, open tabs, execution target, theme and layout across reload', async ({ page }) => {
  await launch(page);
  await uploadExercise(page, { 'State.c': 'int main(void) { return 0; }\n' });
  await openFile(page, 'exercise/State.c', 'C');
  await selectTarget(page, 'exercise/State.c');
  await editSource(page, '#include <stdio.h>\nint main(void) { puts("restored-buffer"); return 0; }\n');
  await page.getByText('Silver', { exact: true }).click();
  await inspector(page).getByLabel('Line numbers').uncheck();
  await page.getByRole('button', { name: 'Debug panel', exact: true }).click();
  await page.keyboard.press('Control+s');
  await page.reload();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();

  await expect(navigator(page).getByRole('button', { name: 'exercise/State.c, C' })).toHaveAttribute('aria-current', 'true');
  const tabs = page.getByRole('group', { name: 'Open files' });
  await expect(tabs.getByRole('button', { name: 'main.c', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'exercise/State.c', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector(page).getByLabel('Execution target').locator('option:checked')).toHaveText('exercise/State.c');
  await expect(inspector(page).getByLabel('Line numbers')).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Silver' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Debug panel', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.source-editor-host .view-lines')).toContainText('restored-buffer');
  await runButton(page).click();
  await expect(status(page)).toHaveText('Completed');
  await consoleContains(page, 'restored-buffer');
});

test('reports compile failures and links compiler issues to the edited buffer', async ({ page }) => {
  await launch(page);
  await editSource(page, 'int main(void) { return fixture_missing; }\n');
  await runButton(page).click();
  await expect(status(page)).toHaveText('Build failed');
  await debug(page).getByRole('button', { name: 'Build log', exact: true }).click();
  await expect(debug(page).locator('pre')).toContainText('fixture_missing');
  await navigator(page).getByRole('button', { name: 'Issues', exact: true }).click();
  const issue = navigator(page).getByRole('button', { name: /fixture_missing/ }).first();
  await issue.click();
  await expectEditorFocus(page);
  await editSource(page, 'int main(void) { return 0; }\n');
  await expect(issue).toBeDisabled();
  await runButton(page).click();
  await expect(status(page)).toHaveText('Completed');
});

test('reports a runtime failure separately from the successful Python build', async ({ page }) => {
  await launch(page);
  await openFile(page, 'main.py', 'Python');
  await selectTarget(page, 'main.py');
  await editSource(page, 'print("before fault", flush=True)\nraise RuntimeError("fixture runtime fault")\n');
  await runButton(page).click();
  await expect(status(page)).toHaveText('Runtime error');
  await consoleContains(page, 'before fault');
  await consoleContains(page, 'fixture runtime fault');
  await debug(page).getByRole('button', { name: 'Build log', exact: true }).click();
  await expect(debug(page).getByText('Build succeeded', { exact: true })).toBeVisible();
  await debug(page).getByRole('button', { name: 'Execution details', exact: true }).click();
  const result = debug(page).getByText('Exit code', { exact: true }).locator('..');
  await expect(result.getByText('1', { exact: true })).toBeVisible();
});

test('keeps two browser sessions independent when one is cancelled', async ({ browser, page, baseURL }) => {
  const otherContext = await browser.newContext({ baseURL });
  try {
    const other = await otherContext.newPage();
    for (const [client, label] of [[page, 'first'], [other, 'second']]) {
      await launch(client);
      await openFile(client, 'main.py', 'Python');
      await selectTarget(client, 'main.py');
      await editSource(client, `print('${label} waiting', flush=True)\nprint('${label}: ' + input())\n`);
    }
    await Promise.all([runButton(page).click(), runButton(other).click()]);
    await Promise.all([consoleContains(page, 'first waiting'), consoleContains(other, 'second waiting')]);
    await expect(status(page)).toHaveText('Running');
    await expect(status(other)).toHaveText('Running');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(status(page)).toHaveText('Stopped');
    await expect(runButton(page)).toBeEnabled();
    await expect(status(other)).toHaveText('Running');
    await sendLine(other, 'independent');
    await consoleContains(other, 'second: independent');
    await expect(status(other)).toHaveText('Completed');
    await expect(debug(page).locator('.xterm-rows')).not.toContainText('independent');
  } finally {
    await otherContext.close();
  }
});

test('recovers from a failed execution request and reports a closed WebSocket', async ({ page }) => {
  await launch(page);
  const executions = backend + '/api/v1/executions/';
  await page.route(executions, (route) => route.abort('failed'));
  await runButton(page).click();
  await expect(status(page)).toHaveText('Unable to run');
  await expect(debug(page).getByRole('alert')).toContainText('Could not reach the local execution server');
  await page.unroute(executions);
  await runButton(page).click();
  await expect(status(page)).toHaveText('Completed');
  await consoleContains(page, 'Sum: 55');

  await page.routeWebSocket('ws://127.0.0.1:8000/ws/executions/**', (socket) => socket.close({ code: 1011 }));
  await launch(page);
  await runButton(page).click();
  await expect(status(page)).toHaveText('Unable to run');
  await expect(debug(page).getByRole('alert')).toContainText(/execution (socket|connection)/);
  await expect(runButton(page)).toBeEnabled();
});

test('displays C tokens, AST, symbols and IR and separates analyzer support from Run', async ({ page }) => {
  await launch(page);
  const supported = 'int twice(int n) { return n * 2; }\nint main(void) { return twice(2+3); }\n';
  await editSource(page, supported);
  const panel = await analyze(page, 'C');
  await expect(panel.getByText('Analysis complete', { exact: true })).toBeVisible();
  await expect(panel.getByText('keyword', { exact: true }).first()).toBeVisible();
  await panel.getByRole('button', { name: 'AST', exact: true }).click();
  await panel.getByRole('button', { name: 'Expand FunctionDeclaration' }).first().click();
  await panel.getByRole('button', { name: 'Expand Block', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Expand ReturnStatement', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Symbols', exact: true }).click();
  await expect(panel.getByText('twice(int)', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'IR', exact: true }).click();
  await expect(panel.getByText(/call twice#/)).toBeVisible();

  await editSource(page, 'int main(void) { int value=4; int *p=&value; return *p-4; }\n');
  await expect(panel.getByText(/Results are stale/)).toBeVisible();
  await expect(panel.locator('.analysis-location').first()).toBeDisabled();
  await analyze(page, 'C');
  await expect(panel.getByText(/unsupported-syntax/).first()).toBeVisible();
  await runButton(page).click();
  await expect(status(page)).toHaveText('Completed');
});

test('displays native Python scopes and Unicode diagnostics with active source navigation', async ({ page }) => {
  await launch(page);
  await openFile(page, 'main.py', 'Python');
  const source = 'def outer(value):\n    def inner():\n        return value + 2\n    return inner\n';
  await editSource(page, source);
  const request = page.waitForRequest((entry) => entry.url() === backend + '/api/v1/analysis/' && entry.method() === 'POST');
  const panel = await analyze(page, 'Python');
  expect((await request).postDataJSON()).toEqual({ source, language: 'python' });
  await expect(panel.getByText('Native Python 3.12', { exact: true })).toBeVisible();
  await expect(panel.getByRole('status')).toHaveText('Analysis complete');
  await expect(panel.getByText('plus', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Symbols', exact: true }).click();
  await expect(panel.getByText(/free, referenced.*function/)).toBeVisible();
  await panel.getByRole('button', { name: 'IR', exact: true }).click();
  await expect(panel.getByText('Intermediate code is unavailable for Python analysis.')).toBeVisible();
  await editSource(page, '"😀"; return 1\n');
  await analyze(page, 'Python');
  const diagnostic = panel.getByRole('button', { name: /return.*outside function/ });
  await diagnostic.click();
  await expectEditorFocus(page);
  await editSource(page, 'print("corrected")\n');
  await expect(diagnostic).toBeDisabled();
});
