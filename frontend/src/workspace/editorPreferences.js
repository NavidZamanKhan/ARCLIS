const storageKey = 'arclis.editor';
const defaults = { lineNumbers: true, tabSize: 4 };

export const tabSizes = [2, 4, 8];

export function readEditorPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return {
      lineNumbers: typeof saved?.lineNumbers === 'boolean' ? saved.lineNumbers : defaults.lineNumbers,
      tabSize: tabSizes.includes(saved?.tabSize) ? saved.tabSize : defaults.tabSize,
    };
  } catch {
    return defaults;
  }
}

export function saveEditorPreferences(preferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // The current workspace still uses the selected preferences.
  }
}
