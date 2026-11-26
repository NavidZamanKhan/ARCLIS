import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '../components/controls.jsx';

export function QuickOpen({ files, close, openFile }) {
  const dialog = useRef(null);
  const input = useRef(null);
  const results = useId();
  const title = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const matches = files.filter(({ path }) => path.toLowerCase().includes(query.trim().toLowerCase()));
  const active = matches[selected];
  const activeId = active && `${results}-${active.id}`;

  useEffect(() => {
    const modal = dialog.current;
    if (!modal.open) modal.showModal();
    input.current.focus();
    return () => { if (modal.open) modal.close(); };
  }, []);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  function dismiss(file) {
    dialog.current.close();
    close();
    if (file) openFile(file.id);
  }

  function handleKey(event) {
    if (!matches.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    setSelected((selected + offset + matches.length) % matches.length);
  }

  return (
    <dialog ref={dialog} className="layout-dialog quick-open" aria-labelledby={title}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <form onSubmit={(event) => { event.preventDefault(); if (active) dismiss(active); }}>
        <h2 id={title}>Quick Open</h2>
        <input ref={input} type="search" role="combobox" aria-label="Find a file" placeholder="Filename or path"
          aria-expanded="true" aria-controls={results} aria-autocomplete="list" aria-activedescendant={activeId}
          value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={handleKey} />
        <ul id={results} role="listbox" aria-label="Matching files">
          {matches.map((file, index) => (
            <li key={file.id} id={`${results}-${file.id}`} role="option" aria-selected={index === selected}
              onMouseDown={(event) => event.preventDefault()} onClick={() => dismiss(file)}>{file.path}</li>
          ))}
        </ul>
        {!matches.length && <p role="status">{files.length ? 'No matching files.' : 'No source files in this workspace.'}</p>}
        <div className="layout-dialog-actions">
          <Button onClick={() => dismiss()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!active}>Open</Button>
        </div>
      </form>
    </dialog>
  );
}
