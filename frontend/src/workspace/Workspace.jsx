import { useEffect, useRef, useState } from 'react';
import { Braces, FileCode, FolderOpen, Terminal } from 'lucide-react';

import { samples } from '../preview/samples.js';
import { SourceEditor } from './SourceEditor.jsx';
import { Splitter } from './Splitter.jsx';
import { readEditorPreferences, saveEditorPreferences, tabSizes } from './editorPreferences.js';
import { clampSize, panelOptions } from './panelLayout.js';

const files = Object.entries(samples);
const emptyMarkers = {};
const symbols = {
  c: ['sum_to', 'main'],
  cpp: ['sum_to', 'main'],
  java: ['Main', 'sumTo', 'main'],
  python: ['sum_to'],
};

function Navigator({ language, selectFile, goToSymbol, visible }) {
  const [view, setView] = useState('files');

  return (
    <aside className="workspace-navigator" id="workspace-navigator" aria-label="Navigator" hidden={!visible}>
      <div className="workspace-bar"><h2>Navigator</h2></div>
      <div className="navigator-selector" aria-label="Navigator view" role="group">
        <button type="button" aria-pressed={view === 'files'} onClick={() => setView('files')}>
          <FolderOpen size={15} aria-hidden="true" />Files
        </button>
        <button type="button" aria-pressed={view === 'symbols'} onClick={() => setView('symbols')}>
          <Braces size={15} aria-hidden="true" />Symbols
        </button>
      </div>
      {view === 'files' ? (
        <>
          <h3 className="navigator-caption">Samples</h3>
          <ul className="navigator-list">
            {files.map(([id, sample]) => (
              <li key={id}>
                <button
                  type="button"
                  className="navigator-file"
                  aria-label={sample.filename + ', ' + sample.label}
                  aria-current={id === language ? 'true' : undefined}
                  onClick={() => selectFile(id)}
                >
                  <FileCode size={15} aria-hidden="true" />
                  <span>{sample.filename}</span>
                  <span className="file-kind">{sample.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h3 className="navigator-caption">Sample declarations</h3>
          <ul className="navigator-list">
            {symbols[language].map((symbol) => (
              <li key={symbol}>
                <button type="button" className="navigator-file font-mono" onClick={() => goToSymbol(symbol)}>
                  <Braces size={15} aria-hidden="true" />{symbol}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function Inspector({ sample, lineCount, preferences, setPreference, visible }) {
  return (
    <aside className="workspace-inspector" id="workspace-inspector" aria-label="Inspector" hidden={!visible}>
      <div className="workspace-bar"><h2>Inspector</h2></div>
      <div className="inspector-body">
        <h3 className="inspector-heading">File details</h3>
        <dl>
          <dt>Name</dt><dd>{sample.filename}</dd>
          <dt>Language</dt><dd>{sample.label}</dd>
          <dt>Lines</dt><dd>{lineCount}</dd>
        </dl>
        <h3 className="inspector-heading">Editor preferences</h3>
        <div className="editor-preferences">
          <label>
            <input
              type="checkbox" checked={preferences.lineNumbers}
              onChange={(event) => setPreference('lineNumbers', event.target.checked)}
            />
            Line numbers
          </label>
          <label>
            Indentation
            <select value={preferences.tabSize} onChange={(event) => setPreference('tabSize', Number(event.target.value))}>
              {tabSizes.map((size) => <option key={size} value={size}>{size} spaces</option>)}
            </select>
          </label>
        </div>
      </div>
    </aside>
  );
}

function DebugPanel({ visible }) {
  return (
    <section className="workspace-debug" id="workspace-debug" aria-label="Debug" hidden={!visible}>
      <div className="workspace-bar debug-bar">
        <Terminal size={16} aria-hidden="true" /><h2>Debug</h2>
      </div>
      <p className="debug-empty font-mono">No program output.</p>
    </section>
  );
}

export function Workspace({ hidden, layout, onResize, theme, markersByFile = emptyMarkers }) {
  const viewport = useRef(null);
  const editor = useRef(null);
  const [language, setLanguage] = useState('c');
  const [lineCount, setLineCount] = useState(0);
  const [preferences, setPreferences] = useState(readEditorPreferences);
  const [extent, setExtent] = useState({ width: 1200, height: 800 });
  const sample = samples[language];

  useEffect(() => { saveEditorPreferences(preferences); }, [preferences]);

  useEffect(() => {
    if (hidden || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([{ contentRect: { width, height } }]) => {
      if (width > 0 && height > 0) setExtent({ width, height });
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [hidden]);

  const dimensions = Object.fromEntries(Object.entries(panelOptions).map(([panel, options]) => {
    const available = panel === 'debug' ? extent.height * 0.55 : extent.width * 0.31;
    const bounds = { ...options, max: Math.max(options.min, Math.min(options.max, Math.floor(available))) };
    return [panel, { ...bounds, size: clampSize(layout[panel].size, bounds) }];
  }));
  const tracks = Object.fromEntries(Object.keys(layout).flatMap((panel) => [
    ['--' + panel + '-size', layout[panel].visible ? dimensions[panel].size + 'px' : '0px'],
    ['--' + panel + '-handle', layout[panel].visible ? '0.5rem' : '0px'],
  ]));

  function splitter(panel) {
    return layout[panel].visible && (
      <Splitter panel={panel} {...dimensions[panel]} onResize={(size) => onResize(panel, size)} />
    );
  }

  return (
    <main className="workspace-layout" aria-label="Sample workspace" ref={viewport} hidden={hidden} style={tracks}>
      <Navigator
        language={language} selectFile={setLanguage} visible={layout.navigator.visible}
        goToSymbol={(symbol) => editor.current?.goToSymbol(symbol)}
      />
      {splitter('navigator')}
      <div className="workspace-center">
        <SourceEditor
          ref={editor} language={language} theme={theme} hidden={hidden}
          preferences={preferences} markersByFile={markersByFile} onLineCount={setLineCount}
        />
        {splitter('debug')}
        <DebugPanel visible={layout.debug.visible} />
      </div>
      {splitter('inspector')}
      <Inspector
        sample={sample} lineCount={lineCount} preferences={preferences} visible={layout.inspector.visible}
        setPreference={(key, value) => setPreferences((previous) => ({ ...previous, [key]: value }))}
      />
    </main>
  );
}
