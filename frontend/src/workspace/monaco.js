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

import { applyEditorTheme } from './editorTheme.js';
import { fileMode, languages } from './projectFiles.js';

globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export function createSourceEditor(host, scope, onLineCount, onFileEdited) {
  const models = new Map();
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
  let activeId = null;
  let tabSize = 4;

  function syncFiles(files, activeFile, markersByFile) {
    const nextId = activeFile?.id ?? null;
    const switched = activeId !== nextId;
    if (switched && activeId !== null) viewStates.set(activeId, instance.saveViewState());
    if (switched) instance.setModel(null);

    const currentIds = new Set(files.map((file) => file.id));
    for (const [id, { model }] of models) {
      if (currentIds.has(id)) continue;
      model.dispose();
      models.delete(id);
      viewStates.delete(id);
    }

    for (const file of files) {
      const language = fileMode(file.path);
      if (!models.has(file.id)) {
        const uri = Uri.from({ scheme: 'inmemory', authority: 'arclis', path: '/' + scope + '/' + file.id });
        const model = editor.createModel(file.content, language, uri);
        model.updateOptions({ tabSize, indentSize: tabSize, insertSpaces: true });
        models.set(file.id, { model, initialVersion: model.getAlternativeVersionId() });
      }
      const { model } = models.get(file.id);
      if (model.getLanguageId() !== language) editor.setModelLanguage(model, language);
      const markers = (markersByFile[file.path] ?? []).filter((marker) => marker.startLineNumber <= model.getLineCount())
        .map((marker) => ({ ...marker, ...model.validateRange(marker) }));
      editor.setModelMarkers(model, 'arclis', markers);
    }

    activeId = nextId;
    if (switched && activeFile) {
      instance.setModel(models.get(activeId).model);
      const viewState = viewStates.get(activeId);
      if (viewState) instance.restoreViewState(viewState);
    }
    if (activeFile) instance.updateOptions({ ariaLabel: languages[fileMode(activeFile.path)] + ' source editor' });
    onLineCount(instance.getModel()?.getLineCount() ?? 0);
  }

  const contentListener = instance.onDidChangeModelContent(() => {
    const { model, initialVersion } = models.get(activeId);
    onLineCount(model.getLineCount());
    onFileEdited(activeId, model.getAlternativeVersionId() !== initialVersion, model.getValue(undefined, true));
  });

  return {
    syncFiles,
    setPreferences(preferences) {
      const { lineNumbers } = preferences;
      tabSize = preferences.tabSize;
      instance.updateOptions({ lineNumbers: lineNumbers ? 'on' : 'off' });
      for (const { model } of models.values()) model.updateOptions({ tabSize, indentSize: tabSize, insertSpaces: true });
    },
    setTheme(theme) {
      applyEditorTheme(editor, theme);
    },
    runAction(id) {
      instance.focus();
      return instance.getAction(id)?.run();
    },
    goToSymbol(symbol) {
      const model = instance.getModel();
      if (!model) return;
      const separators = instance.getOption(editor.EditorOption.wordSeparators);
      const [match] = model.findMatches(symbol, false, false, true, separators, false, 1);
      if (match) {
        instance.setSelection(match.range);
        instance.revealRangeInCenterIfOutsideViewport(match.range);
      }
      instance.focus();
    },
    goToLocation({ id, line, column, length = 1 }) {
      if (id !== activeId) return;
      const range = instance.getModel().validateRange({
        startLineNumber: line, endLineNumber: line, startColumn: column, endColumn: column + length,
      });
      instance.setSelection(range);
      instance.revealRangeInCenter(range);
      instance.focus();
    },
    layout() {
      instance.layout();
    },
    dispose() {
      contentListener.dispose();
      instance.dispose();
      for (const { model } of models.values()) model.dispose();
    },
  };
}
