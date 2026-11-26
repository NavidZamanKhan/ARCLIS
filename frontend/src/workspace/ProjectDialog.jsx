import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '../components/controls.jsx';
import { basename, ProjectFileError, templates } from './projectFiles.js';

const labels = {
  'new-file': 'New File', 'new-folder': 'New Folder', rename: 'Rename', delete: 'Delete', reset: 'Reset Workspace',
};

function availableName(filename, occupied, ownFolder) {
  const dot = filename.lastIndexOf('.');
  let name = filename;
  for (let suffix = 2; occupied.has(name) || (ownFolder && occupied.has(name.slice(0, name.lastIndexOf('.')))); suffix++) {
    name = filename.slice(0, dot) + suffix + filename.slice(dot);
  }
  return name;
}

export function ProjectDialog({ action, occupied, submit, close }) {
  const dialog = useRef(null);
  const titleId = useId();
  const errorId = useId();
  const [name, setName] = useState(action.type === 'rename' ? basename(action.item.path) : '');
  const [template, setTemplate] = useState('');
  const [suggestedName, setSuggestedName] = useState('');
  const [ownFolder, setOwnFolder] = useState(true);
  const [resetMode, setResetMode] = useState('samples');
  const [error, setError] = useState('');
  const destructive = action.type === 'delete' || action.type === 'reset';
  const title = labels[action.type];

  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
    dialog.current.querySelector('[data-initial-focus]').focus();
  }, []);

  function dismiss() {
    dialog.current.close();
    close();
  }

  function handleSubmit(event) {
    event.preventDefault();
    try {
      submit(action, name, template, { ownFolder: template.endsWith('-sum') && ownFolder, resetMode });
      dismiss();
    } catch (cause) {
      if (!(cause instanceof ProjectFileError)) throw cause;
      setError(cause.message);
    }
  }

  return (
    <dialog
      ref={dialog} className="layout-dialog project-dialog" aria-labelledby={titleId}
      aria-describedby={destructive ? titleId + '-description' : undefined}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
    >
      <form onSubmit={handleSubmit}>
        <h2 id={titleId}>{title}</h2>
        {destructive ? (
          action.type === 'reset'
            ? (
              <>
                <p id={titleId + '-description'}>Replace the current files and tabs. An active run will stop.</p>
                <fieldset className="reset-choices">
                  <legend>New workspace</legend>
                  <label><input type="radio" name="reset-mode" checked={resetMode === 'samples'}
                    onChange={() => setResetMode('samples')} /> Restore sample files</label>
                  <label><input type="radio" name="reset-mode" checked={resetMode === 'empty'}
                    onChange={() => setResetMode('empty')} /> Start empty</label>
                </fieldset>
              </>
            )
            : <p id={titleId + '-description'}>Delete <strong>{action.item.path}</strong>{action.item.kind === 'folder' ? ' and its contents' : ''}?</p>
        ) : (
          <>
            {action.type === 'new-file' && (
              <label>
                Template
                <select value={template} onChange={(event) => {
                  const next = templates.find(({ id }) => id === event.target.value);
                    const suggestion = next ? availableName(next.name, occupied, ownFolder && next.id.endsWith('-sum')) : '';
                  if (!name || name === suggestedName) setName(suggestion);
                  setSuggestedName(suggestion);
                  setTemplate(event.target.value);
                  setError('');
                }}>
                  <option value="">Blank source file</option>
                  {templates.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            )}
            <label>
              Name
              <input
                value={name} required data-initial-focus aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => { setName(event.target.value); setError(''); }}
              />
            </label>
            {template.endsWith('-sum') && (
              <label className="project-checkbox">
                <input type="checkbox" checked={ownFolder} onChange={(event) => setOwnFolder(event.target.checked)} />
                Create in a dedicated folder
              </label>
            )}
          </>
        )}
        {error && <p id={errorId} className="project-error" role="alert">{error}</p>}
        <div className="layout-dialog-actions">
          <Button type="button" data-initial-focus={destructive || undefined} onClick={dismiss}>Cancel</Button>
          <Button type="submit" variant={destructive ? 'danger' : 'primary'}>
            {action.type.startsWith('new-') ? 'Create' : title}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
