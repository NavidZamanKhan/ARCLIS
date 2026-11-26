export const THEME_STORAGE_KEY = 'arclis.theme';

export function readTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'silver' ? 'silver' : 'graphite';
  } catch {
    return 'graphite';
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The current theme still works when browser storage is unavailable.
  }
}
