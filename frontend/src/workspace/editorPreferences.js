const storageKey = 'arclis.editor';
export const editorDefaults = { lineNumbers: true, tabSize: 4, fontSize: 13, wordWrap: false, minimap: false };

export const tabSizes = [2, 4, 8];
export const fontSizes = [12, 13, 15, 18];

export function readEditorPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return {
      lineNumbers: typeof saved?.lineNumbers === 'boolean' ? saved.lineNumbers : editorDefaults.lineNumbers,
      tabSize: tabSizes.includes(saved?.tabSize) ? saved.tabSize : editorDefaults.tabSize,
      fontSize: fontSizes.includes(saved?.fontSize) ? saved.fontSize : editorDefaults.fontSize,
      wordWrap: typeof saved?.wordWrap === 'boolean' ? saved.wordWrap : editorDefaults.wordWrap,
      minimap: typeof saved?.minimap === 'boolean' ? saved.minimap : editorDefaults.minimap,
    };
  } catch {
    return editorDefaults;
  }
}

export function saveEditorPreferences(preferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // The current workspace still uses the selected preferences.
  }
}
