const syntaxTokens = {
  '': 'variable',
  keyword: 'keyword',
  'keyword.directive': 'preprocessor',
  'type': 'type',
  'type.identifier': 'type',
  predefined: 'function',
  'identifier.function': 'function',
  string: 'string',
  number: 'number',
  comment: 'comment',
  operator: 'operator',
  delimiter: 'operator',
  invalid: 'invalid',
};

const editorColors = {
  'editor.background': 'surface-workspace',
  'editor.foreground': 'text-primary',
  'editorCursor.foreground': 'accent',
  'editorLineNumber.foreground': 'text-muted',
  'editorLineNumber.activeForeground': 'text-primary',
  'editor.lineHighlightBackground': 'surface-hover',
  'editor.lineHighlightBorder': 'surface-hover',
  'editor.selectionBackground': 'surface-selected',
  'editor.inactiveSelectionBackground': 'surface-selection-inactive',
  'editorWidget.background': 'surface-inspector',
  'editorWidget.foreground': 'text-primary',
  'editorWidget.border': 'border-control',
  'editorHoverWidget.background': 'surface-inspector',
  'editorHoverWidget.foreground': 'text-primary',
  'editorHoverWidget.border': 'border-control',
  'input.background': 'surface-console',
  'input.foreground': 'text-primary',
  'input.border': 'border-control',
  'focusBorder': 'accent',
  'editorError.foreground': 'signal-error',
  'editorWarning.foreground': 'signal-warning',
  'editorInfo.foreground': 'signal-information',
};

export function applyEditorTheme(editor, theme) {
  const styles = getComputedStyle(document.documentElement);
  const color = (token) => styles.getPropertyValue('--' + token).trim();
  const rules = Object.entries(syntaxTokens)
    .map(([token, kind]) => ({ token, foreground: color('syntax-' + kind).slice(1) }))
    .filter(({ foreground }) => foreground);
  const colors = Object.fromEntries(Object.entries(editorColors)
    .map(([key, token]) => [key, color(token)])
    .filter(([, value]) => value));
  const name = 'arclis-' + theme;

  editor.defineTheme(name, {
    base: theme === 'silver' ? 'vs' : 'vs-dark',
    inherit: true,
    rules,
    colors,
  });
  editor.setTheme(name);
}
