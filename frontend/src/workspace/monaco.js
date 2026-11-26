import { editor, Uri } from 'monaco-editor/editor.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import 'monaco-editor/features/codicon/register.js';
import 'monaco-editor/features/bracketMatching/register.js';
import 'monaco-editor/features/clipboard/register.js';
import 'monaco-editor/features/contextmenu/register.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/features/gotoError/register.js';
import 'monaco-editor/features/gotoLine/register.js';
import 'monaco-editor/features/hover/register.js';
import 'monaco-editor/features/toggleTabFocusMode/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/python/register.js';

import { samples, sourceText } from '../preview/samples.js';
import { applyEditorTheme } from './editorTheme.js';

globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export function createSourceEditor(host, scope, onLineCount) {
  const models = new Map(Object.entries(samples).map(([language, sample]) => [
    language,
    editor.createModel(sourceText(sample.lines), language, Uri.from({
      scheme: 'inmemory', authority: 'arclis', path: '/' + scope + '/' + sample.filename,
    })),
  ]));
  const viewStates = new Map();
  const instance = editor.create(host, {
    model: null,
    automaticLayout: true,
    fontFamily: getComputedStyle(host).getPropertyValue('--code-font').trim(),
    fontSize: 13,
    lineHeight: 22,
    padding: { top: 12, bottom: 12 },
    minimap: { enabled: false },
    folding: false,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'gutter',
    renderValidationDecorations: 'on',
    detectIndentation: false,
  });
  let activeLanguage;

  function reportLineCount() {
    onLineCount(instance.getModel().getLineCount());
  }

  const contentListener = instance.onDidChangeModelContent(reportLineCount);

  return {
    open(language) {
      if (activeLanguage) viewStates.set(activeLanguage, instance.saveViewState());
      activeLanguage = language;
      instance.setModel(models.get(language));
      const viewState = viewStates.get(language);
      if (viewState) instance.restoreViewState(viewState);
      instance.updateOptions({ ariaLabel: samples[language].label + ' source editor' });
      reportLineCount();
    },
    setPreferences({ lineNumbers, tabSize }) {
      instance.updateOptions({ lineNumbers: lineNumbers ? 'on' : 'off' });
      for (const model of models.values()) model.updateOptions({ tabSize, indentSize: tabSize, insertSpaces: true });
    },
    setTheme(theme) {
      applyEditorTheme(editor, theme);
    },
    setMarkers(markersByFile) {
      for (const [language, model] of models) {
        editor.setModelMarkers(model, 'arclis', markersByFile[samples[language].filename] ?? []);
      }
    },
    runAction(id) {
      instance.focus();
      return instance.getAction(id)?.run();
    },
    goToSymbol(symbol) {
      const separators = instance.getOption(editor.EditorOption.wordSeparators);
      const [match] = instance.getModel().findMatches(symbol, false, false, true, separators, false, 1);
      if (match) {
        instance.setSelection(match.range);
        instance.revealRangeInCenterIfOutsideViewport(match.range);
      }
      instance.focus();
    },
    layout() {
      instance.layout();
    },
    dispose() {
      contentListener.dispose();
      instance.dispose();
      for (const model of models.values()) model.dispose();
    },
  };
}
