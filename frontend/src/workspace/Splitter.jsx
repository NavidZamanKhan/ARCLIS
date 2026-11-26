import { useRef } from 'react';

import { clampSize } from './panelLayout.js';

const STEP = 16;

export function Splitter({ panel, label, size, min, max, direction, onResize }) {
  const pointer = useRef(null);
  const vertical = panel !== 'debug';
  const coordinate = (event) => vertical ? event.clientX : event.clientY;

  function resize(value) {
    onResize(clampSize(value, { min, max }));
  }

  function onKeyDown(event) {
    const increase = vertical ? 'ArrowRight' : 'ArrowDown';
    const decrease = vertical ? 'ArrowLeft' : 'ArrowUp';
    const values = {
      [increase]: size + direction * STEP,
      [decrease]: size - direction * STEP,
      Home: min,
      End: max,
    };
    if (!Object.hasOwn(values, event.key)) return;
    event.preventDefault();
    resize(values[event.key]);
  }

  return (
    <div
      className={'workspace-splitter splitter-' + panel}
      role="separator"
      aria-label={'Resize ' + label.toLowerCase()}
      aria-controls={'workspace-' + panel}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      aria-valuetext={size + ' pixels'}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current) return;
        pointer.current = { id: event.pointerId, position: coordinate(event), size };
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = pointer.current;
        if (active && active.id === event.pointerId) {
          resize(active.size + (coordinate(event) - active.position) * direction);
        }
      }}
      onPointerUp={() => { pointer.current = null; }}
      onPointerCancel={() => { pointer.current = null; }}
      onLostPointerCapture={() => { pointer.current = null; }}
    />
  );
}
