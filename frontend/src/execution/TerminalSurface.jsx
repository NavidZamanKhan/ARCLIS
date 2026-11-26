import { useEffect, useRef } from 'react';
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

export default function TerminalSurface({ frames, theme, visible }) {
  const host = useRef(null);
  const mounted = useRef(null);
  const rendered = useRef([]);

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
    function fit() {
      if (element.clientWidth > 0 && element.clientHeight > 0) fitAddon.fit();
    }
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    mounted.current = { terminal, fit };
    rendered.current = [];
    return () => {
      observer.disconnect();
      terminal.dispose();
      mounted.current = null;
    };
  }, []);

  useEffect(() => { mounted.current.terminal.options.theme = terminalTheme(); }, [theme]);
  useEffect(() => { if (visible) mounted.current.fit(); }, [visible]);

  useEffect(() => {
    const terminal = mounted.current.terminal;
    const previous = rendered.current;
    const reset = previous.length && (frames.length < previous.length || frames[0] !== previous[0]);
    if (reset) terminal.write('\u001bc');
    for (const { type, data } of frames.slice(reset ? 0 : previous.length)) {
      // Output is already printable. Only these local sequences set stream colors.
      if (type === 'stdout') terminal.write(data);
      else terminal.write((type === 'stderr' ? '\u001b[31m' : '\u001b[33m') + data + '\u001b[0m');
    }
    rendered.current = frames;
  }, [frames]);

  return <div ref={host} className="terminal-surface" aria-label="Program output" />;
}
