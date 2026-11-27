import { useEffect, useEffectEvent, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const color = (token) => styles.getPropertyValue('--' + token).trim();
  return {
    foreground: color('text-primary'),
    background: color('surface-console'),
    selectionBackground: color('surface-selected'),
    red: color('signal-error'),
    yellow: color('signal-warning'),
  };
}

function fitDraft(text, cells) {
  let length = 0;
  let used = 0;
  // Reserve enough cells for tabs and wide characters so the draft's
  // starting line stays in the live screen even when local echo wraps.
  for (const character of text) {
    used += character === '\t' ? 8 : character.charCodeAt(0) < 128 ? 1 : 2;
    if (used >= cells) return cells > 0 ? text.slice(0, length) + '…' : '';
    length += character.length;
  }
  return text;
}

function terminalDisplay(terminal, fitAddon, element) {
  let latest = { frames: [], draft: '' };
  let rendered = [];
  let echo = null;
  let resize = false;
  let dirty = false;
  let drawing = false;
  let disposed = false;
  const write = (data) => data && new Promise((done) => terminal.write(data, done));

  async function draw() {
    if (drawing || disposed) return;
    drawing = true;
    try {
      while (dirty && !disposed) {
        dirty = false;
        const { frames, draft } = latest;
        const needsFit = resize;
        resize = false;
        const changedTranscript = rendered.length > frames.length || (rendered.length > 0 && frames[0] !== rendered[0]);
        const row = echo && echo.marker.line - terminal.buffer.active.baseY;
        // A prompt that ends exactly at the wrap boundary must be replayed
        // to restore xterm's pending wrap state without erasing its last cell.
        const replay = changedTranscript || (echo && (row < 0 || echo.column >= terminal.cols));
        if (echo) {
          echo.marker.dispose();
          if (!replay) await write(`\x1b[${row + 1};${echo.column + 1}H\x1b[J`);
          echo = null;
        }
        if (disposed) return;
        if (replay) terminal.reset();
        if (needsFit) fitAddon.fit();
        const output = frames.slice(replay ? 0 : rendered.length).map(({ type, data }) => {
          // Program data has already been made printable by the protocol.
          if (type === 'stderr') return '\x1b[31m' + data + '\x1b[0m';
          if (type === 'diagnostics') return '\x1b[33m' + data + '\x1b[0m';
          return data;
        }).join('');
        await write(output);
        if (disposed) return;
        rendered = frames;
        const column = terminal.buffer.active.cursorX;
        const text = fitDraft(draft, terminal.cols * (terminal.rows - 1) - column);
        if (text) {
          echo = { marker: terminal.registerMarker(), column };
          await write(text);
        }
      }
    } finally {
      drawing = false;
    }
  }

  return {
    update(frames, draft) {
      latest = { frames, draft };
      dirty = true;
      void draw();
    },
    fit() {
      if (!element.clientWidth || !element.clientHeight) return;
      const dimensions = fitAddon.proposeDimensions();
      if (dimensions?.cols === terminal.cols && dimensions?.rows === terminal.rows) return;
      resize = true;
      dirty = true;
      void draw();
    },
    dispose() { disposed = true; },
  };
}

export default function TerminalSurface({ frames, draft, theme, visible, inputEnabled, onInput, onKey }) {
  const host = useRef(null);
  const mounted = useRef(null);
  const receiveInput = useEffectEvent((data) => {
    if (inputEnabled) onInput(data);
  });
  const handleKey = useEffectEvent((event) => {
    const key = event.key.toLowerCase();
    const clipboardShortcut = !event.altKey && (event.ctrlKey || event.metaKey) && ['c', 'v'].includes(key);
    if (key === 'tab' || clipboardShortcut || (event.shiftKey && key === 'insert')) return false;
    return !inputEnabled || onKey(event);
  });

  useEffect(() => {
    const element = host.current;
    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorInactiveStyle: 'none',
      fontFamily: getComputedStyle(element).getPropertyValue('--code-font').trim(),
      fontSize: 13,
      scrollback: 3000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    terminal.textarea?.setAttribute('aria-label', 'Program input');
    terminal.attachCustomKeyEventHandler((event) => handleKey(event));
    const inputListener = terminal.onData((data) => receiveInput(data));
    const display = terminalDisplay(terminal, fitAddon, element);
    const observer = new ResizeObserver(display.fit);
    observer.observe(element);
    mounted.current = { terminal, display };
    return () => {
      inputListener.dispose();
      observer.disconnect();
      display.dispose();
      terminal.dispose();
      mounted.current = null;
    };
  }, []);

  useEffect(() => { mounted.current.terminal.options.theme = terminalTheme(); }, [theme]);
  useEffect(() => { if (visible) mounted.current.display.fit(); }, [visible]);
  useEffect(() => {
    const { terminal } = mounted.current;
    terminal.options.disableStdin = !inputEnabled;
    if (visible && inputEnabled) terminal.focus();
  }, [inputEnabled, visible]);

  useEffect(() => { mounted.current.display.update(frames, draft); }, [frames, draft]);

  return <div ref={host} className="terminal-surface" aria-label="Program output" />;
}
