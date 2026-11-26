import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import App from '../App.jsx';
import { createSourceEditor } from './monaco.js';
import { fileMode, languages } from './projectFiles.js';

vi.mock('./monaco.js', () => ({ createSourceEditor: vi.fn() }));

createSourceEditor.mockImplementation((host, scope, onLineCount) => ({
  syncFiles(files, activeFile) {
    if (activeFile) host.setAttribute('aria-label', languages[fileMode(activeFile.path)] + ' source editor');
    else host.removeAttribute('aria-label');
    onLineCount(activeFile?.content.split('\n').length ?? 0);
  },
  setTheme: vi.fn(),
  setPreferences: vi.fn(),
  getContent: vi.fn(),
  goToSymbol: vi.fn(),
  runAction: vi.fn(),
  layout: vi.fn(),
  dispose: vi.fn(),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  createSourceEditor.mockClear();
});

it('shows the workspace regions and keeps the navigator, editor, and inspector in sync', async () => {
  const user = userEvent.setup();
  render(<App />);

  expect(screen.getByRole('banner', { name: 'Workspace toolbar' })).toBeDefined();
  expect(screen.getByRole('region', { name: 'Debug' })).toBeDefined();
  const navigator = screen.getByRole('complementary', { name: 'Navigator' });
  const editor = screen.getByRole('region', { name: 'Editor' });
  const inspector = screen.getByRole('complementary', { name: 'Inspector' });
  const java = within(navigator).getByRole('button', { name: 'Main.java, Java' });

  await user.click(java);
  expect(java.getAttribute('aria-current')).toBe('true');
  expect(within(editor).getByLabelText('Java source editor')).toBeDefined();
  expect(inspector.querySelector('dd').textContent).toBe('Main.java');

  await user.click(within(navigator).getByRole('button', { name: 'Symbols' }));
  await user.click(within(navigator).getByRole('button', { name: 'sumTo' }));
  expect(createSourceEditor.mock.results[0].value.goToSymbol).toHaveBeenCalledWith('sumTo');
});

it('routes editor actions and saves and restores editor preferences', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<App />);
  const editor = createSourceEditor.mock.results[0].value;

  await user.click(screen.getByRole('button', { name: 'Find', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Replace', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Go to line' }));
  expect(editor.runAction.mock.calls).toEqual([
    ['actions.find'], ['editor.action.startFindReplaceAction'], ['editor.action.gotoLine'],
  ]);

  await user.click(screen.getByLabelText('Line numbers'));
  await user.selectOptions(screen.getByLabelText('Indentation'), '2');
  const saved = { lineNumbers: false, tabSize: 2 };
  expect(editor.setPreferences).toHaveBeenLastCalledWith(saved);
  await user.click(screen.getByRole('radio', { name: 'Silver' }));
  expect(editor.setTheme).toHaveBeenLastCalledWith('silver');

  unmount();
  expect(editor.dispose).toHaveBeenCalledOnce();
  render(<App />);
  expect(createSourceEditor.mock.results[1].value.setPreferences).toHaveBeenLastCalledWith(saved);
  expect(screen.getByLabelText('Line numbers').checked).toBe(false);
  expect(screen.getByLabelText('Indentation').value).toBe('2');
});

it('toggles each panel and keeps focus on the control used to hide it', async () => {
  const user = userEvent.setup();
  render(<App />);

  for (const [panel, role] of [
    ['Navigator', 'complementary'], ['Inspector', 'complementary'], ['Debug', 'region'],
  ]) {
    const toggle = screen.getByRole('button', { name: panel + ' panel' });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole(role, { name: panel })).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole('region', { name: 'Editor' })).toBeDefined();

    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole(role, { name: panel })).toBeDefined();
  }
});

function pointer(target, type, position) {
  const event = new MouseEvent(type, { bubbles: true, clientX: position, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

it('resizes with the pointer and keyboard, respecting each panel’s direction and limits', async () => {
  const user = userEvent.setup();
  render(<App />);

  const navigator = screen.getByRole('separator', { name: 'Resize navigator' });
  navigator.focus();
  await user.keyboard('{ArrowRight}');
  expect(navigator.getAttribute('aria-valuenow')).toBe('240');

  pointer(navigator, 'pointerdown', 240);
  pointer(navigator, 'pointermove', 1000);
  expect(navigator.getAttribute('aria-valuenow')).toBe(navigator.getAttribute('aria-valuemax'));
  pointer(navigator, 'pointerup', 1000);
  pointer(navigator, 'pointermove', 0);
  expect(navigator.getAttribute('aria-valuenow')).toBe(navigator.getAttribute('aria-valuemax'));

  const inspector = screen.getByRole('separator', { name: 'Resize inspector' });
  inspector.focus();
  await user.keyboard('{ArrowLeft}');
  expect(inspector.getAttribute('aria-valuenow')).toBe('272');

  const debug = screen.getByRole('separator', { name: 'Resize debug' });
  debug.focus();
  await user.keyboard('{ArrowUp}');
  expect(debug.getAttribute('aria-valuenow')).toBe('208');
  await user.keyboard('{Home}');
  expect(debug.getAttribute('aria-valuenow')).toBe(debug.getAttribute('aria-valuemin'));
});

it('dismisses the View menu from the keyboard and keeps the workspace selection across views', async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole('button', { name: 'Main.java, Java' }));
  const view = screen.getByRole('button', { name: 'View' });
  await user.click(view);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset layout…' }));
  await user.keyboard('{Escape}');
  expect(view.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(view);

  await user.click(view);
  await user.click(screen.getByRole('button', { name: 'Design system' }));
  expect(screen.queryByRole('region', { name: 'Editor' })).toBeNull();
  await user.click(view);
  await user.click(screen.getByRole('button', { name: 'Workspace' }));
  expect(screen.getByLabelText('Java source editor')).toBeDefined();
});

function mockDialog() {
  const prototype = HTMLDialogElement.prototype;
  const original = Object.getOwnPropertyDescriptors(prototype);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() {
      this.open = false;
      this.dispatchEvent(new Event('close', { bubbles: true }));
    } },
  });
  return () => {
    for (const method of ['showModal', 'close']) {
      if (original[method]) Object.defineProperty(prototype, method, original[method]);
      else delete prototype[method];
    }
  };
}

it('restores visibility and sizes only after reset confirmation', async () => {
  const user = userEvent.setup();
  const restore = mockDialog();
  try {
    render(<App />);
    const view = screen.getByRole('button', { name: 'View' });
    const navigator = screen.getByRole('separator', { name: 'Resize navigator' });
    navigator.focus();
    await user.keyboard('{ArrowRight}');
    await user.click(screen.getByRole('button', { name: 'Inspector panel' }));

    async function openReset() {
      await user.click(view);
      await user.click(screen.getByRole('button', { name: 'Reset layout…' }));
      return screen.getByRole('dialog', { name: 'Reset workspace layout?' });
    }

    await user.click(within(await openReset()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
    expect(navigator.getAttribute('aria-valuenow')).toBe('240');

    await user.click(within(await openReset()).getByRole('button', { name: 'Reset layout' }));
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeDefined();
    expect(navigator.getAttribute('aria-valuenow')).toBe('224');
    expect(document.activeElement).toBe(view);
  } finally {
    restore();
  }
});

it('creates a nested template, retains tab identity on rename and clears a deleted target', async () => {
  const user = userEvent.setup();
  const restore = mockDialog();
  try {
    render(<App />);

    async function openAction(trigger, label) {
      await user.click(screen.getByRole('button', { name: trigger }));
      await user.click(screen.getByRole('menuitem', { name: label }));
      return within(screen.getByRole('dialog', { name: label }));
    }
    const folder = await openAction('Project actions', 'New Folder');
    await user.type(folder.getByLabelText('Name'), 'src');
    await user.click(folder.getByRole('button', { name: 'Create' }));

    const source = await openAction('Actions for src', 'New File');
    await user.selectOptions(source.getByLabelText('Template'), 'python');
    expect(source.getByLabelText('Name').value).toBe('main.py');
    await user.click(source.getByRole('button', { name: 'Create' }));
    const jump = screen.getByRole('navigation', { name: 'Jump bar' });
    const currentPath = () => jump.querySelector('[aria-current="page"]').title;
    expect(currentPath()).toBe('src/main.py');
    const select = screen.getByLabelText('Execution target');
    const targetId = within(select).getByRole('option', { name: 'src/main.py' }).value;
    await user.selectOptions(select, targetId);

    const rename = await openAction('Actions for src', 'Rename');
    await user.clear(rename.getByLabelText('Name'));
    await user.type(rename.getByLabelText('Name'), '../bad');
    await user.click(rename.getByRole('button', { name: 'Rename' }));
    expect(rename.getByRole('alert').textContent).toContain('Start with');
    await user.clear(rename.getByLabelText('Name'));
    await user.type(rename.getByLabelText('Name'), 'tools');
    await user.click(rename.getByRole('button', { name: 'Rename' }));
    expect(currentPath()).toBe('tools/main.py');
    expect(within(select).getByRole('option', { name: 'tools/main.py' }).value).toBe(targetId);
    expect(select.value).toBe(targetId);

    const deletion = await openAction('Actions for tools', 'Delete');
    expect(document.activeElement).toBe(deletion.getByRole('button', { name: 'Cancel' }));
    await user.click(deletion.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: 'Close tools/main.py' })).toBeNull();
    expect(currentPath()).toBe('main.c');
    expect(select.value).toBe('');
  } finally {
    restore();
  }
});

it('supports keyboard file actions and reopens a closed file from the jump bar', async () => {
  const user = userEvent.setup();
  render(<App />);
  const root = screen.getByRole('button', { name: 'Project actions' });
  root.focus();
  await user.keyboard('{Enter}{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'New Folder' }));
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(root);
  expect(screen.queryByRole('menu')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Close main.c' }));
  expect(screen.getByText('Open a file from the navigator.')).toBeDefined();
  const jump = screen.getByLabelText('Jump to file');
  await user.selectOptions(jump, within(jump).getByRole('option', { name: 'main.c' }).value);
  expect(screen.getByLabelText('C source editor')).toBeDefined();
});

it('enables Run for the selected target independently of the editor tab', async () => {
  const user = userEvent.setup();
  render(<App />);
  const run = screen.getByRole('button', { name: 'Run' });
  const stop = screen.getByRole('button', { name: 'Stop', exact: true });
  const target = screen.getByLabelText('Execution target');
  expect(run.title).toBe('Run main.c');
  expect(stop.disabled).toBe(true);

  await user.selectOptions(target, '');
  expect(run.disabled).toBe(true);
  await user.selectOptions(target, within(target).getByRole('option', { name: 'main.py' }).value);
  expect(run.disabled).toBe(false);
  expect(run.title).toBe('Run main.py');
  expect(screen.getByLabelText('C source editor')).toBeDefined();
});
