import { lazy, Suspense, useRef, useState } from 'react';
import { Copy, Terminal, Trash2 } from 'lucide-react';

import { languages } from '../workspace/projectFiles.js';
import { IssueList } from '../workspace/SourceLocations.jsx';
import { TestCases } from './TestCases.jsx';

const views = { console: 'Console', build: 'Build log', details: 'Execution details', tests: 'Test cases' };
const TerminalSurface = lazy(() => import('./TerminalSurface.jsx'));

const inputEncoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function ProgramConsole({ execution, theme, visible }) {
  const { run, active } = execution;
  const enabled = run.state === 'RUNNING' && !run.inputClosed && !run.testCase;
  const [draft, setDraft] = useState(null);
  const latest = useRef(null);
  const current = () => latest.current?.sequence === run.sequence
    ? latest.current : { sequence: run.sequence, text: '', pending: null, error: '' };
  const shown = draft?.sequence === run.sequence ? draft : null;
  const line = shown?.pending?.line ?? shown?.text.split('\n', 1)[0] ?? '';
  const moreInput = shown?.text.includes('\n') || (shown?.pending && shown.text);

  function update(next) {
    latest.current = next;
    setDraft(next);
  }

  function stage(data) {
    if (data.startsWith('\x1b')) return;
    const previous = current();
    const text = previous.text + data.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
    if (inputEncoder.encode(text).length > 64 * 1024) {
      update({ ...previous, error: 'Staged input is limited to 64 KiB.' });
      return;
    }
    update({ ...previous, text, error: '' });
  }

  async function submit(eof = false) {
    const previous = current();
    if (!enabled || previous.pending) return;
    if (eof && previous.text) {
      update({ ...previous, error: 'Submit or clear the staged input before sending EOF.' });
      return;
    }
    const separator = previous.text.indexOf('\n');
    const line = separator === -1 ? previous.text : previous.text.slice(0, separator);
    const rest = separator === -1 ? '' : previous.text.slice(separator + 1);
    const pending = { line, eof };
    update({ ...previous, pending, text: rest, error: '' });
    const error = await (eof ? execution.endInput() : execution.input(line));
    const state = latest.current;
    if (state?.pending !== pending) return;
    const restored = error && !eof ? line + (separator !== -1 || state.text ? '\n' : '') + state.text : state.text;
    update({ ...state, pending: null, text: restored, error });
  }

  function key(event) {
    const eof = event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'd';
    const editing = !(event.ctrlKey || event.altKey || event.metaKey);
    if (event.type !== 'keydown' || event.isComposing || !(eof || (editing && ['Enter', 'Backspace'].includes(event.key)))) {
      return true;
    }
    event.preventDefault();
    if (editing && event.key === 'Backspace') {
      const previous = current();
      const last = graphemes.segment(previous.text).containing(previous.text.length - 1);
      if (last) update({ ...previous, text: previous.text.slice(0, last.index), error: '' });
    } else {
      void submit(eof);
    }
    return false;
  }

  return (
    <>
      <div className="terminal-frame">
        {(active || run.frames.length > 0 || line) && (
          <Suspense fallback={<p className="debug-empty">Opening console…</p>}>
            <TerminalSurface frames={run.frames} draft={line} theme={theme} visible={visible}
              inputEnabled={enabled} onInput={stage} onKey={key} />
          </Suspense>
        )}
        {!run.frames.length && !active && !line && <p className="debug-empty">No program output.</p>}
      </div>
      {shown?.error && <p className="console-notice" role="alert">{shown.error}</p>}
      {enabled && moreInput && <p className="console-notice">More pasted input is queued.</p>}
      <div className="console-input">
        {enabled && <span>Type in the console. Enter sends a line. Inactivity limit is 30 seconds.</span>}
        {run.inputClosed && <span>Input closed.</span>}
        {!enabled && shown?.text && <span>Unsent input from this run is shown above.</span>}
        {shown?.text && <button type="button" onClick={() => update({ ...current(), text: '', error: '' })}>Clear staged input</button>}
        <button type="button" disabled={!enabled || Boolean(shown?.pending || shown?.text)} onClick={() => void submit(true)}>Send EOF</button>
      </div>
    </>
  );
}

export function DebugPanel({ visible, workspaceHidden, theme, execution, target, runCase, issues, goToLocation }) {
  const [selection, setSelection] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const { run, label } = execution;
  const showTests = Boolean(runCase || run.testCase);
  const selected = selection?.sequence === run.sequence ? selection.view : run.testCase ? 'tests' : 'console';
  const view = selected === 'tests' && !showTests ? 'console' : selected;

  async function copy() {
    try {
      await navigator.clipboard.writeText(run.frames.filter(({ type }) => type !== 'input').map(({ data }) => data).join(''));
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
          {Object.entries(views).filter(([id]) => id !== 'tests' || showTests).map(([id, name]) => (
            <button key={id} type="button" aria-pressed={view === id}
              onClick={() => setSelection({ sequence: run.sequence, view: id })}>{name}</button>
          ))}
        </div>
        <div className="debug-actions" role="group" aria-label="Console actions">
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
        <ProgramConsole execution={execution} theme={theme} visible={visible && !workspaceHidden && view === 'console'} />
        {run.error && <p className="console-notice" role="alert">{run.error}</p>}
        {clipboard?.sequence === run.sequence && <p className="console-notice" aria-live="polite">{clipboard.message}</p>}
      </div>
      <div className="debug-report" hidden={view !== 'build'}>
        {run.build && <p className="debug-result">Build {run.build.toLowerCase()}</p>}
        {issues?.length > 0 && <IssueList issues={issues} goToLocation={goToLocation} />}
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
      {showTests && <div className="debug-report" hidden={view !== 'tests'}>
        <TestCases target={target} execution={execution} runCase={runCase} />
      </div>}
    </section>
  );
}
