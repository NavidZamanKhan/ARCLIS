import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { analysisMarkers, sourceRanges } from '../analysis/sourceRanges.js';
import { useAnalysis } from '../analysis/useAnalysis.js';
import { backendUrl, restrictedDeployment } from '../backend.js';
import { DebugPanel } from '../execution/DebugPanel.jsx';
import { makeExecutionPayload } from '../execution/payload.js';
import { useExecution } from '../execution/useExecution.js';
import { ProjectDialog } from './ProjectDialog.jsx';
import { ProjectNavigator } from './ProjectNavigator.jsx';
import { QuickOpen } from './QuickOpen.jsx';
import { SourceEditor } from './SourceEditor.jsx';
import { Splitter } from './Splitter.jsx';
import { WorkspaceInspector } from './WorkspaceInspector.jsx';
import { WorkspaceToolbar } from './WorkspaceToolbar.jsx';
import { editorDefaults, readEditorPreferences, saveEditorPreferences } from './editorPreferences.js';
import { clampSize, panelOptions } from './panelLayout.js';
import { currentIssues, issueMarkers, readBuildIssues } from './sourceLocations.js';
import { useWorkspaceProject } from './useWorkspaceProject.js';
import {
  addEntries, basename, closeTab, createProject, deleteEntry, executionTarget, fileMode,
  joinPath, openFile, parentPath, ProjectFileError, readUploads, renameEntry, templateContent,
} from './projectFiles.js';

const emptyMarkers = {};

export function Workspace({ hidden, layout, onResize, showPanel, theme, toolbar, markersByFile = emptyMarkers }) {
  const viewport = useRef(null);
  const editor = useRef(null);
  const uploadInput = useRef(null);
  const uploadFolder = useRef(null);
  const uploadGeneration = useRef(0);
  const {
    project, currentProject, modified, markFile, readContent, contentVersion, updateProject, saveNow, storageIssue, loading,
  } = useWorkspaceProject();
  const [modeRequest, setModeRequest] = useState(null);
  const [location, setLocation] = useState(null);
  const [inspectorMode, setInspectorMode] = useState('file');
  const [buildSources, setBuildSources] = useState(new Map());
  const [reveal, setReveal] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [lineCount, setLineCount] = useState(0);
  const [serviceStatus, setServiceStatus] = useState('Checking services…');
  const [preferences, setPreferences] = useState(readEditorPreferences);
  const [extent, setExtent] = useState({ width: 1200, height: 800 });
  const files = useMemo(() => project.entries.filter(({ kind }) => kind === 'file'), [project.entries]);
  const activeFile = files.find((file) => file.id === project.activeId);
  const target = executionTarget(files.find((file) => file.id === project.targetId));
  const execution = useExecution();
  const analysis = useAnalysis();
  const snapshot = analysis.state?.snapshot;
  const analyzedFile = snapshot && files.find(({ id }) => id === snapshot.id);
  const staleAnalysis = Boolean(snapshot && (analyzedFile?.path !== snapshot.path || readContent(analyzedFile) !== snapshot.content));
  const locateAnalysisRange = useMemo(() => snapshot && sourceRanges(snapshot.content), [snapshot]);
  const report = analysis.state?.report;
  const analysisLanguage = activeFile && fileMode(activeFile.path);
  const canAnalyze = !restrictedDeployment && !loading && ['c', 'python'].includes(analysisLanguage)
    && analysis.state?.status !== 'running';
  const rawIssues = useMemo(() => readBuildIssues(execution.run.log, buildSources), [execution.run.log, buildSources]);
  const issues = useMemo(
    () => currentIssues(rawIssues, buildSources, files, readContent),
    [rawIssues, buildSources, files, readContent, contentVersion],
  );
  const markers = useMemo(() => {
    const merged = { ...markersByFile };
    for (const [path, annotations] of Object.entries(issueMarkers(issues))) {
      merged[path] = [...(markersByFile[path] ?? []), ...annotations];
    }
    if (report && !staleAnalysis) {
      const path = snapshot.path;
      merged[path] = [...(merged[path] ?? []), ...analysisMarkers(report, locateAnalysisRange)];
    }
    return merged;
  }, [issues, markersByFile, report, staleAnalysis, snapshot, locateAnalysisRange]);

  function selectFile(id) {
    updateProject((state) => openFile(state, id));
  }

  function revealFolder(path) {
    showPanel('navigator');
    setReveal({ path });
  }

  function showNavigatorMode(mode) {
    showPanel('navigator');
    setModeRequest({ mode });
  }

  function goToLocation(request) {
    selectFile(request.id);
    setLocation({ ...request });
  }

  function goToAnalysisRange(range) {
    if (!snapshot || staleAnalysis) return;
    const position = locateAnalysisRange(range);
    if (position) goToLocation({ id: snapshot.id, ...position });
  }

  function analyzeActiveFile() {
    if (!canAnalyze) return;
    showPanel('inspector');
    setInspectorMode('analysis');
    void analysis.start(activeFile, readContent(activeFile), analysisLanguage);
  }

  function runTarget(testCase = null) {
    if (restrictedDeployment || !target || execution.active) return;
    showPanel('debug');
    const { entries, targetId } = currentProject.current;
    let payload;
    try {
      payload = makeExecutionPayload(entries, targetId, readContent);
    } catch (error) {
      setBuildSources(new Map());
      execution.reject(target, error.message);
      return;
    }
    const ids = new Map(entries.filter(({ kind }) => kind === 'file').map(({ path, id }) => [path, id]));
    setBuildSources(new Map(payload.files.map((file) => [file.path, { ...file, id: ids.get(file.path) }])));
    if (testCase) payload.stdin = testCase.stdin;
    void execution.start(payload, testCase);
  }

  const handleShortcut = useEffectEvent((event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.repeat
      || document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    if (key === 'f' && event.shiftKey) {
      event.preventDefault();
      showNavigatorMode('search');
    } else if (key === 's' && !event.shiftKey) {
      event.preventDefault();
      saveNow();
    } else if (key === 'p' && !event.shiftKey) {
      event.preventDefault();
      setQuickOpen(true);
    } else if (key === 'enter') {
      event.preventDefault();
      if (event.shiftKey) execution.stop();
      else runTarget();
    }
  });

  async function choose(type, item) {
    setFeedback(null);
    if (type === 'upload') {
      uploadFolder.current = item?.id ?? null;
      uploadInput.current.click();
    } else if (type === 'download') {
      const content = readContent(item);
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const download = document.createElement('a');
      download.href = url;
      download.download = basename(item.path);
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } else if (type === 'set-target') {
      updateProject((state) => ({ ...state, targetId: item.id }));
      setFeedback({ message: 'Execution target set to ' + item.path + '.' });
    } else if (type === 'copy-path') {
      try {
        await navigator.clipboard.writeText(item.path);
        setFeedback({ message: 'Relative path copied.' });
      } catch {
        setFeedback({ message: 'Clipboard unavailable.', error: true });
      }
    } else {
      setDialog({ type, item });
    }
  }

  async function handleUpload(event) {
    const input = event.currentTarget;
    const selected = [...input.files];
    const folderId = uploadFolder.current;
    const generation = uploadGeneration.current;
    input.value = '';
    if (!selected.length) return;
    try {
      const uploads = await readUploads(selected, '');
      if (generation !== uploadGeneration.current) return;
      updateProject((state) => {
        const folder = state.entries.find((entry) => entry.id === folderId);
        if (folderId !== null && !folder) throw new ProjectFileError('The destination folder no longer exists.');
        return addEntries(state, uploads.map((file) => ({ ...file, path: joinPath(folder?.path ?? '', file.path) })));
      });
      if (folderId !== null) setReveal({ path: currentProject.current.entries.find((entry) => entry.id === folderId).path });
      setFeedback({ message: selected.length === 1 ? 'File uploaded.' : selected.length + ' files uploaded.' });
    } catch (error) {
      if (!(error instanceof ProjectFileError)) throw error;
      if (generation !== uploadGeneration.current) return;
      setFeedback({ message: error.message, error: true });
    }
  }

  function applyFileAction({ type, item }, name, template, { ownFolder, resetMode }) {
    if (type === 'rename') {
      updateProject((state) => renameEntry(state, item.id, name));
    } else if (type === 'delete') {
      updateProject((state) => deleteEntry(state, item.id));
      setReveal({ path: parentPath(item.path) });
    } else if (type === 'reset') {
      uploadGeneration.current++;
      execution.reset();
      analysis.reset();
      setBuildSources(new Map());
      setLocation(null);
      setInspectorMode('file');
      updateProject((state) => createProject(state.nextId, { empty: resetMode === 'empty' }));
      setReveal({ path: '' });
      setFeedback({ message: resetMode === 'empty' ? 'Empty workspace ready.' : 'Sample files restored.' });
    } else {
      const parent = item?.path ?? '';
      const folder = ownFolder ? joinPath(parent, name.slice(0, name.lastIndexOf('.'))) : parent;
      const path = joinPath(folder, name);
      const additions = ownFolder ? [{ kind: 'folder', path: folder }] : [];
      additions.push(type === 'new-file'
        ? { kind: 'file', path, content: templateContent(path, template) }
        : { kind: 'folder', path });
      updateProject((state) => {
        const next = addEntries(state, additions);
        return template.endsWith('-sum') ? { ...next, targetId: next.activeId } : next;
      });
      if (folder) setReveal({ path: folder });
    }
  }

  useEffect(() => { saveEditorPreferences(preferences); }, [preferences]);
  useEffect(() => {
    if (!restrictedDeployment) return undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    fetch(backendUrl('/api/v1/capabilities/'), { signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Capabilities unavailable');
        return response.json();
      })
      .then((data) => {
        if (data?.execution?.available !== false || data?.analysis?.available !== false) {
          throw new Error('Unexpected deployment capabilities');
        }
        if (!controller.signal.aborted) setServiceStatus('Restricted demo');
      })
      .catch(() => { if (!controller.signal.aborted) setServiceStatus('Service unavailable'); });
    return () => controller.abort();
  }, []);
  useLayoutEffect(() => {
    if (hidden || loading) return undefined;
    const listener = (event) => handleShortcut(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [hidden, loading]);

  useEffect(() => {
    if (hidden || loading || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([{ contentRect: { width, height } }]) => {
      if (width > 0 && height > 0) setExtent({ width, height });
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [hidden, loading]);

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
    <>
      <WorkspaceToolbar
        {...toolbar} theme={theme} layout={layout} showPreview={hidden}
        target={loading ? null : target} execution={execution} runTarget={() => runTarget()}
        canAnalyze={Boolean(canAnalyze)} analyzeActiveFile={analyzeActiveFile} analysisStatus={analysis.state?.status}
        serviceStatus={restrictedDeployment ? serviceStatus : null}
      />
      {storageIssue && !hidden && <p className="workspace-save-alert" role="alert">{storageIssue}</p>}
      {loading ? (
        <main className="workspace-loading" aria-label="Workspace" aria-busy="true" hidden={hidden}>
          <p role="status">Opening workspace…</p>
        </main>
      ) : (
        <main className="workspace-layout" aria-label="Workspace" ref={viewport} hidden={hidden} style={tracks}>
          <ProjectNavigator
            project={project} activeFile={activeFile} openFile={selectFile} visible={layout.navigator.visible}
            goToSymbol={(symbol) => editor.current?.goToSymbol(symbol)} choose={choose} reveal={reveal} feedback={feedback}
            files={files} readContent={readContent} contentVersion={contentVersion} issues={issues}
            goToLocation={goToLocation} modeRequest={modeRequest}
          />
          {splitter('navigator')}
          <div className="workspace-center">
            <SourceEditor
              ref={editor} files={files} activeFile={activeFile} tabs={project.tabs} modified={modified}
              openFile={selectFile} closeTab={(id) => updateProject((state) => closeTab(state, id))}
              revealFolder={revealFolder} theme={theme} hidden={hidden} preferences={preferences}
              markersByFile={markers} onLineCount={setLineCount} onFileEdited={markFile} location={location}
              showQuickOpen={() => setQuickOpen(true)} createFile={() => choose('new-file')}
              focusRequest={editorFocusRequest}
            />
            {splitter('debug')}
            <DebugPanel visible={layout.debug.visible} execution={execution} theme={theme} workspaceHidden={hidden}
              target={target} runCase={restrictedDeployment ? null : runTarget} />
          </div>
          {splitter('inspector')}
          <WorkspaceInspector
            file={activeFile} lineCount={lineCount} readContent={readContent} files={files} targetId={project.targetId}
            selectTarget={(targetId) => updateProject((state) => ({ ...state, targetId }))}
            preferences={preferences} visible={layout.inspector.visible}
            setPreference={(key, value) => setPreferences((previous) => ({ ...previous, [key]: value }))}
            resetPreferences={() => setPreferences(editorDefaults)}
            target={target} execution={execution} issueCount={issues.length} showIssues={() => showNavigatorMode('issues')}
            mode={inspectorMode} setMode={setInspectorMode} analysis={analysis.state}
            staleAnalysis={staleAnalysis} goToAnalysisRange={goToAnalysisRange}
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
          {quickOpen && (
            <QuickOpen files={files} close={() => setQuickOpen(false)} openFile={(id) => {
              selectFile(id);
              setEditorFocusRequest((request) => request + 1);
            }} />
          )}
        </main>
      )}
    </>
  );
}
