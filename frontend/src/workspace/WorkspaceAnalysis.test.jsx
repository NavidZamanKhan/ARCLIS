import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import App from '../App.jsx';
import { createSourceEditor } from './monaco.js';

vi.mock('./monaco.js', () => ({ createSourceEditor: vi.fn() }));

createSourceEditor.mockImplementation(() => ({
  syncFiles: vi.fn(), setTheme: vi.fn(), setPreferences: vi.fn(), goToLocation: vi.fn(),
  goToSymbol: vi.fn(), runAction: vi.fn(), layout: vi.fn(), dispose: vi.fn(),
}));

const point = (line, column) => ({ line, column, offset: 0 });
const range = (line, column, width) => ({ start: point(line, column), end: point(line, column + width) });
const program = { kind: 'Program', range: range(1, 1, 5), items: [{
  kind: 'FunctionDeclaration', name: 'main', range: range(1, 1, 5),
  body: { kind: 'Block', range: range(1, 1, 5), items: [] },
}] };
const symbol = { name: 'main', kind: 'function', type: 'int', scope: 1, range: range(1, 1, 5), parameterTypes: [] };
const report = {
  syntax_valid: true, semantic_valid: true, ast: program, symbols: [symbol], scopes: [{ id: 1, kind: 'file' }],
  tokens: [{ kind: 'keyword', lexeme: 'int', range: range(1, 1, 3) }], diagnostics: [],
  ir: { initializers: [], instructions: [{ op: 'return', range: range(1, 1, 3), value: { kind: 'literal', text: '7' } }] },
};

function json(data, status = 200) {
  return { ok: status === 200, status, json: async () => data };
}

function edit(source) {
  const [, , , onFileEdited] = createSourceEditor.mock.calls[0];
  act(() => onFileEdited(1, true, source));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  createSourceEditor.mockClear();
  vi.unstubAllGlobals();
});

it('submits the active live buffer and shows navigable tokens, AST, symbols and IR', async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValue(json(report));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const source = 'int main(void) { return 7; }';
  edit(source);
  const analysis = screen.getByRole('button', { name: 'Analyze', exact: true });
  await user.click(analysis);
  const panel = await screen.findByRole('region', { name: 'C analysis' });
  await within(panel).findByText('Analysis complete');
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('http://127.0.0.1:8000/api/v1/analysis/');
  expect(JSON.parse(options.body)).toEqual({ source });
  expect(options.credentials).toBe('omit');

  const editor = createSourceEditor.mock.results[0].value;
  await user.click(within(panel).getByRole('button', { name: /int.*keyword/ }));
  expect(editor.goToLocation).toHaveBeenLastCalledWith({ id: 1, line: 1, column: 1, endLine: 1, endColumn: 4 });
  await user.click(within(panel).getByRole('button', { name: 'AST', exact: true }));
  await user.click(within(panel).getByRole('button', { name: 'Expand FunctionDeclaration' }));
  await user.click(within(panel).getByRole('button', { name: /Block.*body/ }));
  expect(editor.goToLocation).toHaveBeenCalledTimes(2);
  await user.click(within(panel).getByRole('button', { name: 'Symbols', exact: true }));
  expect(within(panel).getByText('main()')).toBeDefined();
  await user.click(within(panel).getByRole('button', { name: 'IR', exact: true }));
  expect(within(panel).getByText('return 7')).toBeDefined();
});

it('maps semantic diagnostics to UTF-16 editor ranges and removes stale markers after edits', async () => {
  const user = userEvent.setup();
  const source = '\uFEFF// lead\r\nint f(void) { "😀"; missing; }\r\n';
  const column = new TextEncoder().encode(source.split('\r\n')[1].split('missing')[0]).length + 1;
  const diagnostic = {
    phase: 'semantic', code: 'undeclared-identifier', message: 'Identifier has no visible declaration',
    range: range(2, column, 7),
  };
  const fetch = vi.fn().mockResolvedValue(json({ ...report, semantic_valid: false, ir: null, diagnostics: [diagnostic] }));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  edit(source);
  await user.click(screen.getByRole('button', { name: 'Analyze', exact: true }));
  const panel = await screen.findByRole('region', { name: 'C analysis' });
  const item = await within(panel).findByRole('button', { name: /Identifier has no visible declaration/ });
  await user.click(item);
  const editor = createSourceEditor.mock.results[0].value;
  expect(editor.goToLocation).toHaveBeenLastCalledWith({ id: 1, line: 2, column: 21, endLine: 2, endColumn: 28 });
  expect(editor.syncFiles.mock.lastCall[2]['main.c'][0]).toMatchObject({ startColumn: 21, endColumn: 28 });
  edit(source.replace('missing', '0'));
  expect(within(panel).getByText(/Results are stale/)).toBeDefined();
  expect(item.disabled).toBe(true);
  expect(editor.syncFiles.mock.lastCall[2]['main.c']).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Run', exact: true }).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Main.java, Java' }));
  expect(screen.getByRole('button', { name: 'Analyze', exact: true }).disabled).toBe(true);
});

it('keeps an in-flight response tied to the submitted snapshot and shows service errors', async () => {
  const user = userEvent.setup();
  let finish;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(json(null, 404));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const button = screen.getByRole('button', { name: 'Analyze', exact: true });
  await user.click(button);
  const panel = await screen.findByRole('region', { name: 'C analysis' });
  expect(button.disabled).toBe(true);
  expect(within(panel).getByRole('status').textContent).toMatch(/Analyzing/);
  edit('int x;');
  await act(async () => finish(json(report)));
  expect(within(panel).getByRole('status').textContent).toMatch(/stale/);
  await user.click(button);
  expect((await within(panel).findByRole('alert')).textContent).toMatch(/Local C analysis is disabled/);
  expect(button.disabled).toBe(false);
});
