import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';

import { ProjectDialog } from './ProjectDialog.jsx';
import { ProjectNavigator } from './ProjectNavigator.jsx';
import { SourceEditor } from './SourceEditor.jsx';
import { Splitter } from './Splitter.jsx';
import { readEditorPreferences, saveEditorPreferences, tabSizes } from './editorPreferences.js';
import { clampSize, panelOptions } from './panelLayout.js';
import {
  addEntries, basename, closeTab, createProject, deleteEntry, executionTarget, fileMode,
  joinPath, languages, openFile, parentPath, ProjectFileError, readUploads, renameEntry, templateContent,
} from './projectFiles.js';

const emptyMarkers = {};

function Inspector({ file, lineCount, files, targetId, selectTarget, preferences, setPreference, visible }) {
  return (
    <aside className="workspace-inspector" id="workspace-inspector" aria-label="Inspector" hidden={!visible}>
      <div className="workspace-bar"><h2>Inspector</h2></div>
      <div className="inspector-body">
        <h3 className="inspector-heading">File details</h3>
        {file ? (
          <dl>
            <dt>Path</dt><dd>{file.path}</dd>
            <dt>Language</dt><dd>{languages[fileMode(file.path)]}</dd>
            <dt>Lines</dt><dd>{lineCount}</dd>
          </dl>
        ) : <p className="navigator-empty">No file open.</p>}
        <div className="editor-preferences target-control">
          <label>
            Execution target
            <select value={targetId ?? ''} onChange={(event) => selectTarget(Number(event.target.value) || null)}>
              <option value="">None selected</option>
              {files.filter(executionTarget).map((target) => <option key={target.id} value={target.id}>{target.path}</option>)}
            </select>
          </label>
        </div>
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

export function Workspace({ hidden, layout, onResize, showNavigator, theme, markersByFile = emptyMarkers }) {
  const viewport = useRef(null);
  const editor = useRef(null);
  const uploadInput = useRef(null);
  const uploadFolder = useRef(null);
  const [project, setProject] = useState(createProject);
  const currentProject = useRef(project);
  const [modified, setModified] = useState(new Set());
  const [reveal, setReveal] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [lineCount, setLineCount] = useState(0);
  const [preferences, setPreferences] = useState(readEditorPreferences);
  const [extent, setExtent] = useState({ width: 1200, height: 800 });
  const files = useMemo(() => project.entries.filter(({ kind }) => kind === 'file'), [project.entries]);
  const activeFile = files.find((file) => file.id === project.activeId);

  const markFile = useCallback((id, dirty) => {
    setModified((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function updateProject(change) {
    const next = change(currentProject.current);
    currentProject.current = next;
    setProject(next);
    return next;
  }

  function selectFile(id) {
    updateProject((state) => openFile(state, id));
  }

  function revealFolder(path) {
    showNavigator();
    setReveal({ path });
  }

  function choose(type, item) {
    setFeedback(null);
    if (type === 'upload') {
      uploadFolder.current = item?.id ?? null;
      uploadInput.current.click();
    } else if (type === 'download') {
      const content = editor.current?.getContent(item.id) ?? item.content;
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const download = document.createElement('a');
      download.href = url;
      download.download = basename(item.path);
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } else {
      setDialog({ type, item });
    }
  }

  async function handleUpload(event) {
    const input = event.currentTarget;
    const selected = [...input.files];
    const folderId = uploadFolder.current;
    input.value = '';
    if (!selected.length) return;
    try {
      const uploads = await readUploads(selected, '');
      updateProject((state) => {
        const folder = state.entries.find((entry) => entry.id === folderId);
        if (folderId !== null && !folder) throw new ProjectFileError('The destination folder no longer exists.');
        return addEntries(state, uploads.map((file) => ({ ...file, path: joinPath(folder?.path ?? '', file.path) })));
      });
      if (folderId !== null) setReveal({ path: currentProject.current.entries.find((entry) => entry.id === folderId).path });
      setFeedback({ message: selected.length === 1 ? 'File uploaded.' : selected.length + ' files uploaded.' });
    } catch (error) {
      if (!(error instanceof ProjectFileError)) throw error;
      setFeedback({ message: error.message, error: true });
    }
  }

  function applyFileAction({ type, item }, name, template) {
    if (type === 'rename') {
      updateProject((state) => renameEntry(state, item.id, name));
    } else if (type === 'delete') {
      const next = updateProject((state) => deleteEntry(state, item.id));
      setModified((previous) => new Set(next.entries.filter(({ id }) => previous.has(id)).map(({ id }) => id)));
      setReveal({ path: parentPath(item.path) });
    } else {
      updateProject((state) => {
        const path = joinPath(item?.path ?? '', name);
        const entry = type === 'new-file'
          ? { kind: 'file', path, content: templateContent(path, template) }
          : { kind: 'folder', path };
        return addEntries(state, [entry]);
      });
      if (item) setReveal({ path: item.path });
    }
  }

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
    <main className="workspace-layout" aria-label="Workspace" ref={viewport} hidden={hidden} style={tracks}>
      <ProjectNavigator
        project={project} activeFile={activeFile} openFile={selectFile} visible={layout.navigator.visible}
        goToSymbol={(symbol) => editor.current?.goToSymbol(symbol)} choose={choose} reveal={reveal} feedback={feedback}
      />
      {splitter('navigator')}
      <div className="workspace-center">
        <SourceEditor
          ref={editor} files={files} activeFile={activeFile} tabs={project.tabs} modified={modified}
          openFile={selectFile} closeTab={(id) => updateProject((state) => closeTab(state, id))}
          revealFolder={revealFolder} theme={theme} hidden={hidden} preferences={preferences}
          markersByFile={markersByFile} onLineCount={setLineCount} onFileEdited={markFile}
        />
        {splitter('debug')}
        <DebugPanel visible={layout.debug.visible} />
      </div>
      {splitter('inspector')}
      <Inspector
        file={activeFile} lineCount={lineCount} files={files} targetId={project.targetId}
        selectTarget={(targetId) => updateProject((state) => ({ ...state, targetId }))}
        preferences={preferences} visible={layout.inspector.visible}
        setPreference={(key, value) => setPreferences((previous) => ({ ...previous, [key]: value }))}
      />
      <input
        ref={uploadInput} type="file" multiple hidden aria-label="Upload source files"
        accept=".c,.cc,.cpp,.cxx,.h,.hh,.hpp,.hxx,.java,.py" onChange={handleUpload}
      />
      {dialog && (
        <ProjectDialog
          action={dialog} submit={applyFileAction} close={() => setDialog(null)}
          occupied={new Set(project.entries.filter(({ path }) => parentPath(path) === (dialog.item?.path ?? ''))
            .map(({ path }) => basename(path)))}
        />
      )}
    </main>
  );
}
