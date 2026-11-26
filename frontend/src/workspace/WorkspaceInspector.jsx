import { AnalysisInspector } from '../analysis/AnalysisInspector.jsx';
import { fontSizes, tabSizes } from './editorPreferences.js';
import { basename, executionTarget, extension, fileMode, languages } from './projectFiles.js';

const encoder = new TextEncoder();
const headers = new Set(['h', 'hh', 'hpp', 'hxx']);
const toolchains = {
  c: { compiler: 'GCC', standard: 'C17', memory: 256 },
  cpp: { compiler: 'G++', standard: 'C++17', memory: 256 },
  java: { compiler: 'javac (OpenJDK 21)', memory: 384 },
  python: { compiler: 'Python 3.12 syntax check', memory: 256 },
};

function FileDetails({ file, lineCount, readContent }) {
  if (!file) return <p className="navigator-empty">No file open.</p>;
  const content = readContent(file);
  return (
    <dl>
      <dt>Name</dt><dd>{basename(file.path)}</dd>
      <dt>Path</dt><dd>{file.path}</dd>
      <dt>Type</dt><dd>{headers.has(extension(file.path).toLowerCase()) ? 'Header' : 'Source'}</dd>
      <dt>Language</dt><dd>{languages[fileMode(file.path)]}</dd>
      <dt>Encoding</dt><dd>UTF-8{content.startsWith('\uFEFF') ? ' with BOM' : ''}</dd>
      <dt>Lines</dt><dd>{lineCount}</dd>
      <dt>Size</dt><dd>{encoder.encode(content).length.toLocaleString()} bytes</dd>
    </dl>
  );
}

function BuildDetails({ target, execution, issueCount, showIssues }) {
  const toolchain = toolchains[target?.language];
  const { run, label } = execution;
  return (
    <>
      {toolchain ? (
        <dl>
          <dt>Target</dt><dd>{target.entry_file}</dd>
          <dt>Compiler</dt><dd>{toolchain.compiler}</dd>
          {toolchain.standard && <><dt>Standard</dt><dd>{toolchain.standard}</dd></>}
          <dt>Environment</dt><dd>Local Docker sandbox</dd>
          <dt>Memory</dt><dd>{toolchain.memory} MiB</dd>
          <dt>Processes</dt><dd>64</dd>
          <dt>Time limit</dt><dd>120 s total, 30 s idle</dd>
          <dt>Output limit</dt><dd>256 KiB</dd>
        </dl>
      ) : <p className="navigator-empty">Select an execution target.</p>}
      {run.target && (
        <>
          <h3 className="inspector-heading">Latest execution</h3>
          <dl>
            <dt>Target</dt><dd>{run.target.entry_file}</dd>
            <dt>Status</dt><dd>{label}</dd>
            {run.build && <><dt>Build</dt><dd>{run.build}</dd></>}
            {run.result && <><dt>Duration</dt><dd>{run.result.execution_time_ms} ms</dd></>}
          </dl>
          {issueCount > 0 && (
            <button type="button" className="inspector-issues-link" onClick={showIssues}>
              Show {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
            </button>
          )}
        </>
      )}
    </>
  );
}

export function WorkspaceInspector({
  file, lineCount, readContent, files, targetId, target, selectTarget, preferences, setPreference,
  visible, execution, issueCount, showIssues, resetPreferences,
  mode, setMode, analysis, staleAnalysis, goToAnalysisRange,
}) {
  return (
    <aside className="workspace-inspector" id="workspace-inspector" aria-label="Inspector" hidden={!visible}>
      <div className="workspace-bar"><h2>Inspector</h2></div>
      <div className="inspector-modes" role="group" aria-label="Inspector view">
        <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>File</button>
        <button type="button" aria-pressed={mode === 'build'} onClick={() => setMode('build')}>Build</button>
        <button type="button" aria-pressed={mode === 'analysis'} onClick={() => setMode('analysis')}>Analysis</button>
      </div>
      <div className="inspector-body">
        {mode === 'analysis' ? <AnalysisInspector state={analysis} stale={staleAnalysis} navigate={goToAnalysisRange} /> : (
          <>
            {mode === 'file' ? (
              <>
                <h3 className="inspector-heading">File details</h3>
                <FileDetails file={file} lineCount={lineCount} readContent={readContent} />
              </>
            ) : <BuildDetails target={target} execution={execution} issueCount={issueCount} showIssues={showIssues} />}
            <div className="editor-preferences target-control">
              <label>
                Execution target
                <select value={targetId ?? ''} onChange={(event) => selectTarget(Number(event.target.value) || null)}>
                  <option value="">None selected</option>
                  {files.filter(executionTarget).map((target) => <option key={target.id} value={target.id}>{target.path}</option>)}
                </select>
              </label>
            </div>
          </>
        )}
        {mode === 'file' && (
          <>
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
              <label>
                Font size
                <select value={preferences.fontSize} onChange={(event) => setPreference('fontSize', Number(event.target.value))}>
                  {fontSizes.map((size) => <option key={size} value={size}>{size} px</option>)}
                </select>
              </label>
              <label>
                <input type="checkbox" checked={preferences.wordWrap}
                  onChange={(event) => setPreference('wordWrap', event.target.checked)} />
                Word wrap
              </label>
              <label>
                <input type="checkbox" checked={preferences.minimap}
                  onChange={(event) => setPreference('minimap', event.target.checked)} />
                Minimap
              </label>
              <button type="button" className="inspector-issues-link" onClick={resetPreferences}>Reset editor preferences</button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
