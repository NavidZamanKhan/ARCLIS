import { lazy, Suspense, useState } from 'react';
import { Copy, Square, Terminal, Trash2 } from 'lucide-react';

import { languages } from '../workspace/projectFiles.js';
import { TestCases } from './TestCases.jsx';

const views = { console: 'Console', build: 'Build log', details: 'Execution details', tests: 'Test cases' };
const TerminalSurface = lazy(() => import('./TerminalSurface.jsx'));

function ConsoleInput({ execution }) {
  const [line, setLine] = useState('');
  const [error, setError] = useState('');
  const enabled = execution.run.state === 'RUNNING' && !execution.run.inputClosed;

  function submit(event) {
    event.preventDefault();
    const problem = execution.input(line);
    setError(problem);
    if (!problem) setLine('');
  }

  return (
    <>
      {error && enabled && <p className="console-notice" role="alert">{error}</p>}
      <form className="console-input" onSubmit={submit}>
        <input
          type="text" aria-label="Program input" placeholder={execution.run.inputClosed ? 'Input closed' : 'Program input'}
          value={line} onChange={(event) => { setLine(event.target.value); setError(''); }} disabled={!enabled}
        />
        <button type="submit" disabled={!enabled}>Send</button>
        <button type="button" disabled={!enabled} onClick={() => {
          const problem = execution.endInput();
          setError(problem);
          if (!problem) setLine('');
        }}>Send EOF</button>
      </form>
    </>
  );
}

export function DebugPanel({ visible, workspaceHidden, theme, execution, target, runCase }) {
  const [selection, setSelection] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const { run, label, active } = execution;
  const view = selection?.sequence === run.sequence ? selection.view : run.testCase ? 'tests' : 'console';
  const canStop = active && run.state !== 'CANCELLING';

  async function copy() {
    try {
      await navigator.clipboard.writeText(run.frames.map(({ data }) => data).join(''));
      setClipboard({ sequence: run.sequence, message: 'Output copied.' });
    } catch {
      setClipboard({ sequence: run.sequence, message: 'Clipboard unavailable.' });
    }
  }

  return (
    <section className="workspace-debug" id="workspace-debug" aria-label="Debug" hidden={!visible}>
      <div className="workspace-bar debug-bar">
        <h2 className="debug-title"><Terminal size={15} aria-hidden="true" />Debug</h2>
        <div className="debug-views" role="group" aria-label="Debug view">
          {Object.entries(views).map(([id, name]) => (
            <button key={id} type="button" aria-pressed={view === id}
              onClick={() => setSelection({ sequence: run.sequence, view: id })}>{name}</button>
          ))}
        </div>
        <div className="debug-actions" role="group" aria-label="Console actions">
          <button
            type="button" title="Stop execution" aria-label="Stop execution from console"
            disabled={!canStop} onClick={execution.stop}
          ><Square size={14} aria-hidden="true" /></button>
          <button type="button" title="Copy output" aria-label="Copy output" disabled={!run.frames.length} onClick={copy}>
            <Copy size={14} aria-hidden="true" />
          </button>
          <button type="button" title="Clear console" aria-label="Clear console" disabled={!run.frames.length} onClick={() => {
            execution.clear();
            setClipboard(null);
          }}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="debug-console" hidden={view !== 'console'}>
        <div className="terminal-frame">
          {(active || run.frames.length > 0) && (
            <Suspense fallback={<p className="debug-empty">Opening console…</p>}>
              <TerminalSurface frames={run.frames} theme={theme} visible={visible && !workspaceHidden && view === 'console'} />
            </Suspense>
          )}
          {!run.frames.length && !active && <p className="debug-empty">No program output.</p>}
        </div>
        {run.error && <p className="console-notice" role="alert">{run.error}</p>}
        {clipboard?.sequence === run.sequence && <p className="console-notice" aria-live="polite">{clipboard.message}</p>}
        <ConsoleInput key={run.sequence} execution={execution} />
      </div>
      <div className="debug-report" hidden={view !== 'build'}>
        {run.build && <p className="debug-result">Build {run.build.toLowerCase()}</p>}
        {run.log ? <pre>{run.log}</pre> : <p>No compiler messages.</p>}
      </div>
      <div className="debug-report" hidden={view !== 'details'}>
        <dl>
          <dt>Status</dt><dd>{label}</dd>
          {run.target && <><dt>Target</dt><dd>{run.target.entry_file} ({languages[run.target.language]})</dd></>}
          {run.result?.exit_code != null && <><dt>Exit code</dt><dd>{run.result.exit_code}</dd></>}
          {run.result && <><dt>Duration</dt><dd>{run.result.execution_time_ms} ms</dd></>}
        </dl>
        {run.error && <p>{run.error}</p>}
      </div>
      <div className="debug-report" hidden={view !== 'tests'}>
        <TestCases target={target} execution={execution} runCase={runCase} />
      </div>
    </section>
  );
}
