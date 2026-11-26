import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';

import App from '../App.jsx';

afterEach(cleanup);

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
  expect(within(editor).getByLabelText('Java source sample')).toBeDefined();
  expect(within(inspector).getByText('Main.java')).toBeDefined();

  await user.click(within(navigator).getByRole('button', { name: 'Symbols' }));
  expect(within(navigator).getByText('sumTo')).toBeDefined();
});
