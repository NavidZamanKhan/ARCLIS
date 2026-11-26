import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import App from './App.jsx';
import { THEME_STORAGE_KEY } from './theme/preferences.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
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
