import { useState } from 'react';
import { Braces, FileCode, FolderOpen, Terminal } from 'lucide-react';

import { SourceCode } from '../components/SourceCode.jsx';
import { samples } from '../preview/samples.js';

const files = Object.entries(samples);
const symbols = {
  c: ['sum_to', 'main'],
  cpp: ['sum_to', 'main'],
  java: ['Main', 'sumTo', 'main'],
  python: ['sum_to'],
};

function Navigator({ language, selectFile }) {
  const [view, setView] = useState('files');

  return (
    <aside className="workspace-navigator" aria-label="Navigator">
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
              <li className="navigator-symbol font-mono" key={symbol}>
                <Braces size={15} aria-hidden="true" />{symbol}
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

function Inspector({ sample }) {
  return (
    <aside className="workspace-inspector" aria-label="Inspector">
      <div className="workspace-bar"><h2>Inspector</h2></div>
      <div className="inspector-body">
        <h3 className="inspector-heading">File details</h3>
        <dl>
          <dt>Name</dt><dd>{sample.filename}</dd>
          <dt>Language</dt><dd>{sample.label}</dd>
          <dt>Lines</dt><dd>{sample.lines.length}</dd>
          <dt>Access</dt><dd>Read-only</dd>
        </dl>
      </div>
    </aside>
  );
}

function DebugPanel() {
  return (
    <section className="workspace-debug" aria-label="Debug">
      <div className="workspace-bar debug-bar">
        <Terminal size={16} aria-hidden="true" /><h2>Debug</h2>
      </div>
      <p className="debug-empty font-mono">No program output.</p>
    </section>
  );
}

export function Workspace() {
  const [language, setLanguage] = useState('c');
  const sample = samples[language];

  return (
    <main className="workspace-layout" aria-label="Sample workspace">
      <Navigator language={language} selectFile={setLanguage} />
      <div className="workspace-center">
        <section className="workspace-editor" aria-label="Editor">
          <div className="workspace-bar editor-bar">
            <span className="editor-file"><FileCode size={16} aria-hidden="true" />{sample.filename}</span>
            <span className="source-mode">Read-only</span>
          </div>
          <SourceCode sample={sample} />
        </section>
        <DebugPanel />
      </div>
      <Inspector sample={sample} />
    </main>
  );
}
