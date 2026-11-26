import { useEffect, useId, useImperativeHandle, useRef } from 'react';
import { FileCode, ListOrdered, Replace, Search } from 'lucide-react';

import { samples } from '../preview/samples.js';
import { createSourceEditor } from './monaco.js';

const actions = [
  ['Find', 'actions.find', Search],
  ['Replace', 'editor.action.startFindReplaceAction', Replace],
  ['Go to line', 'editor.action.gotoLine', ListOrdered],
];

export function SourceEditor({
  ref, language, theme, preferences, hidden, markersByFile, onLineCount,
}) {
  const host = useRef(null);
  const session = useRef(null);
  const scope = useId();
  const sample = samples[language];

  useEffect(() => {
    const sourceEditor = createSourceEditor(host.current, scope, onLineCount);
    session.current = sourceEditor;
    return () => {
      sourceEditor.dispose();
      session.current = null;
    };
  }, [scope, onLineCount]);

  useEffect(() => { session.current.open(language); }, [language]);
  useEffect(() => { session.current.setTheme(theme); }, [theme]);
  useEffect(() => { session.current.setPreferences(preferences); }, [preferences]);
  useEffect(() => { session.current.setMarkers(markersByFile); }, [markersByFile]);
  useEffect(() => { if (!hidden) session.current.layout(); }, [hidden]);

  useImperativeHandle(ref, () => ({
    goToSymbol(symbol) {
      session.current?.goToSymbol(symbol);
    },
  }), []);

  return (
    <section className="workspace-editor" aria-label="Editor">
      <div className="workspace-bar editor-bar">
        <span className="editor-file"><FileCode size={16} aria-hidden="true" />{sample.filename}</span>
        <div className="editor-actions" role="group" aria-label="Source editor actions">
          {actions.map(([label, id, Icon]) => (
            <button
              key={id} type="button" aria-label={label} title={label}
              onClick={() => session.current?.runAction(id)}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <div className="source-editor-frame">
        <div className="source-editor-host" ref={host} />
      </div>
    </section>
  );
}
