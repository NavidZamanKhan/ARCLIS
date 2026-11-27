import { expect, test } from '@playwright/test';

const navigator = (page) => page.getByRole('complementary', { name: 'Navigator' });
const inspector = (page) => page.getByRole('complementary', { name: 'Inspector' });
const debug = (page) => page.getByRole('region', { name: 'Debug' });

async function launch(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const reset = await projectAction(page, 'Reset Workspace');
  await reset.getByRole('radio', { name: 'Restore sample files' }).check();
  await reset.getByRole('button', { name: 'Reset Workspace' }).click();
  await expect(navigator(page).getByRole('button', { name: 'main.c, C', exact: true })).toBeVisible();
}

async function projectAction(page, name) {
  await navigator(page).getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  return page.getByRole('dialog', { name, exact: true });
}

async function createSumTemplate(page, language) {
  const dialog = await projectAction(page, 'New File');
  await dialog.getByLabel('Template').selectOption(language + '-sum');
  await expect(dialog.getByLabel('Create in a dedicated folder')).toBeChecked();
  const name = await dialog.getByRole('textbox', { name: 'Name' }).inputValue();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(inspector(page).getByLabel('Execution target').locator('option:checked'))
    .toHaveText(name.slice(0, name.lastIndexOf('.')) + '/' + name);
}

for (const [language, label] of [['c', 'C'], ['cpp', 'C++'], ['java', 'Java'], ['python', 'Python']]) {
  test(`${label} two-number template matches a predefined case without manual input`, async ({ page }) => {
    await launch(page);
    await createSumTemplate(page, language);
    await debug(page).getByRole('button', { name: 'Test cases', exact: true }).click();
    await debug(page).getByLabel('Two-number sum case').selectOption({ label: 'Mixed signs' });
    const verdict = debug(page).getByRole('status', { name: 'Test case result' });
    await debug(page).getByRole('button', { name: 'Run case', exact: true }).click();
    await expect(verdict).toContainText('Output matches');
    await expect(verdict).toBeInViewport({ ratio: 1 });

    if (language === 'c') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.evaluate(() => navigator.clipboard.writeText(
        '#include <stdio.h>\nint main(void) { puts("Different output"); return 0; }',
      ));
      await page.locator('.source-editor-host .view-line').first().click({ position: { x: 3, y: 8 } });
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+v');
      await debug(page).getByRole('button', { name: 'Run case', exact: true }).click();
      await expect(verdict).toContainText('Output differs');
      await expect(verdict).toContainText('Different output');
      await debug(page).getByRole('button', { name: 'Console', exact: true }).click();
      await debug(page).getByRole('button', { name: 'Clear console', exact: true }).click();
      await debug(page).getByRole('button', { name: 'Test cases', exact: true }).click();
      await expect(verdict).toContainText('Output differs');
      await expect(verdict).toContainText('Different output');
      await inspector(page).getByLabel('Execution target').selectOption({ label: 'main.c' });
      await expect(debug(page).getByRole('button', { name: 'Run case', exact: true })).toBeDisabled();
    }
  });
}

test('opens a file and changes its execution target through keyboard controls', async ({ page }) => {
  await launch(page);
  await page.keyboard.press('Control+p');
  const modal = page.getByRole('dialog', { name: 'Quick Open' });
  const query = modal.getByRole('combobox', { name: 'Find a file' });
  await expect(query).toBeFocused();
  await query.fill('does-not-exist');
  await expect(modal.getByText('No matching files.', { exact: true })).toBeVisible();
  await query.fill('main.');
  await query.press('ArrowDown');
  await expect(modal.getByRole('option', { name: 'main.cpp', exact: true })).toHaveAttribute('aria-selected', 'true');
  await query.press('Enter');
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.monaco-editor')))).toBe(true);

  const file = navigator(page).getByRole('button', { name: 'main.cpp, C++', exact: true });
  await expect(file).toHaveAttribute('aria-current', 'true');
  await file.press('Shift+F10');
  const target = page.getByRole('menuitem', { name: 'Set as Execution Target' });
  await page.getByRole('menuitem', { name: 'Download', exact: true }).press('ArrowDown');
  await expect(target).toBeFocused();
  await target.press('Enter');
  await expect(inspector(page).getByLabel('Execution target').locator('option:checked')).toHaveText('main.cpp');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await file.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Copy Path', exact: true }).click();
  await expect(navigator(page).getByRole('status')).toHaveText('Relative path copied.');
  expect(await page.evaluate(() => window.navigator.clipboard.readText())).toBe('main.cpp');
});

test('resets a running workspace to empty and preserves editor settings across reload', async ({ page }) => {
  await launch(page);
  await inspector(page).getByLabel('Font size').selectOption('18');
  await inspector(page).getByLabel('Word wrap').check();
  await inspector(page).getByLabel('Minimap').check();
  await createSumTemplate(page, 'python');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Python analysis' }).getByText('Analysis complete')).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const state = page.getByRole('status', { name: 'Execution status' });
  await expect(state).toHaveText('Running');

  let reset = await projectAction(page, 'Reset Workspace');
  await expect(reset.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await reset.getByRole('radio', { name: 'Start empty' }).check();
  await reset.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(state).toHaveText('Running');

  reset = await projectAction(page, 'Reset Workspace');
  await reset.getByRole('radio', { name: 'Start empty' }).check();
  await reset.getByRole('button', { name: 'Reset Workspace', exact: true }).click();
  await expect(state).toHaveText('Ready');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Editor' }).getByRole('button', { name: 'New file', exact: true })).toBeVisible();
  await inspector(page).getByRole('button', { name: 'Analysis', exact: true }).click();
  await expect(inspector(page).getByText('Open a C or Python file and select Analyze.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(navigator(page).getByText(/No project files/)).toBeVisible();
  await expect(inspector(page).getByLabel('Font size')).toHaveValue('18');
  await expect(inspector(page).getByLabel('Word wrap')).toBeChecked();
  await expect(inspector(page).getByLabel('Minimap')).toBeChecked();

  reset = await projectAction(page, 'Reset Workspace');
  await expect(reset.getByRole('radio', { name: 'Start empty' })).toBeChecked();
  await reset.getByRole('radio', { name: 'Restore sample files' }).check();
  await reset.getByRole('button', { name: 'Reset Workspace', exact: true }).click();
  await expect(navigator(page).getByRole('button', { name: 'main.c, C', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
});
