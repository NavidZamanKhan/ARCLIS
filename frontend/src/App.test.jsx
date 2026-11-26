import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App.jsx';
import { THEME_STORAGE_KEY } from './theme/preferences.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('the component preview', () => {
  it('switches the source sample and resets the controls without changing the theme', async () => {
    const user = userEvent.setup();
    render(<App />);

    const language = screen.getByRole('combobox', { name: 'Sample language' });
    const reset = screen.getByRole('button', { name: 'Reset' });
    expect(reset.disabled).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Silver' }));
    await user.selectOptions(language, 'python');
    expect(screen.getByLabelText('Python source sample')).toBeDefined();
    expect(screen.getByText('main.py')).toBeDefined();

    reset.focus();
    await user.keyboard('{Enter}');
    expect(language.value).toBe('c');
    expect(screen.getByText('main.c')).toBeDefined();
    expect(document.documentElement.dataset.theme).toBe('silver');
  });

  it('copies the displayed source with exact line breaks and announces success', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sample language' }), 'python');
    await user.click(screen.getByRole('button', { name: 'Copy source' }));

    expect(writeText).toHaveBeenCalledWith(
      '# Sum the integers from 1 through n.\ndef sum_to(n):\n    return n * (n + 1) // 2\n\nprint("Sum:", sum_to(10))\n',
    );
    expect(screen.getByRole('status').textContent).toBe('Sample copied.');
  });

  it('announces a fallback when clipboard permission is denied', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Copy source' }));

    expect(screen.getByRole('status').textContent).toContain('Clipboard unavailable.');
  });
});

describe('ARCLIS theme preferences', () => {
  it('changes the theme by keyboard and saves the preference', async () => {
    const user = userEvent.setup();
    render(<App />);

    const graphite = screen.getByRole('radio', { name: 'Graphite' });
    const silver = screen.getByRole('radio', { name: 'Silver' });
    expect(graphite.checked).toBe(true);

    await user.tab();
    expect(document.activeElement).toBe(graphite);
    await user.keyboard('{ArrowRight}');

    expect(silver.checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('silver');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('silver');
  });

  it('restores the saved theme on startup', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'silver');
    render(<App />);

    expect(screen.getByRole('radio', { name: 'Silver' }).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('silver');
  });
});
