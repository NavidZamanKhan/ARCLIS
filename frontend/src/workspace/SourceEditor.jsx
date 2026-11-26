import { useEffect, useId, useImperativeHandle, useRef } from 'react';
import { ChevronRight, FileCode, FolderOpen, ListOrdered, Replace, Search, X } from 'lucide-react';

import { createSourceEditor } from './monaco.js';
import { basename } from './projectFiles.js';

const actions = [
  ['Find', 'actions.find', Search],
  ['Replace', 'editor.action.startFindReplaceAction', Replace],
  ['Go to line', 'editor.action.gotoLine', ListOrdered],
];

export function SourceEditor({
  ref, files, activeFile, tabs, modified, openFile, closeTab, revealFolder, theme,
  preferences, hidden, markersByFile, onLineCount, onFileEdited, location, showQuickOpen, createFile, focusRequest,
}) {
  const host = useRef(null);
  const selectedTab = useRef(null);
  const restoreTabFocus = useRef(false);
  const jumpFiles = useRef(null);
  const session = useRef(null);
  const scope = useId();

  useEffect(() => {
    const sourceEditor = createSourceEditor(host.current, scope, onLineCount, onFileEdited);
    session.current = sourceEditor;
    return () => {
      sourceEditor.dispose();
      session.current = null;
    };
  }, [scope, onLineCount, onFileEdited]);

  useEffect(() => { session.current.syncFiles(files, activeFile, markersByFile); }, [files, activeFile, markersByFile]);
  useEffect(() => { session.current.setTheme(theme); }, [theme]);
  useEffect(() => { session.current.setPreferences(preferences); }, [preferences]);
  useEffect(() => { if (!hidden && activeFile) session.current.layout(); }, [hidden, activeFile]);
  useEffect(() => { if (location) session.current.goToLocation(location); }, [location]);
  useEffect(() => { if (focusRequest) session.current.focus(); }, [focusRequest]);
  useEffect(() => {
    if (hidden) return;
    selectedTab.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (restoreTabFocus.current) {
      restoreTabFocus.current = false;
      (selectedTab.current ?? jumpFiles.current)?.focus();
    }
  }, [tabs, activeFile, hidden]);

  useImperativeHandle(ref, () => ({
    goToSymbol(symbol) {
      session.current?.goToSymbol(symbol);
    },
  }), []);

  const path = activeFile?.path.split('/') ?? [];
  return (
    <section className="workspace-editor" aria-label="Editor">
      <div className="workspace-bar editor-bar">
        <div className="editor-tabs" role="group" aria-label="Open files">
          {tabs.map((id) => {
            const file = files.find((entry) => entry.id === id);
            return (
              <div className="editor-tab" key={id} data-active={id === activeFile?.id}>
                <button
                  ref={id === activeFile?.id ? selectedTab : undefined}
                  type="button" aria-pressed={id === activeFile?.id} title={file.path}
                  aria-label={file.path + (modified.has(id) ? ', modified' : '')} onClick={() => openFile(id)}
                >
                  <FileCode size={14} aria-hidden="true" />
                  <span>{basename(file.path)}</span>
                  {modified.has(id) && <span className="editor-tab-modified" aria-hidden="true" />}
                </button>
                <button type="button" className="editor-tab-close" aria-label={'Close ' + file.path} onClick={() => {
                  restoreTabFocus.current = true;
                  closeTab(id);
                }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="editor-actions" role="group" aria-label="Source editor actions">
          <button type="button" aria-label="Quick Open" title="Quick Open" aria-keyshortcuts="Control+P Meta+P"
            onClick={showQuickOpen}>
            <FolderOpen size={16} aria-hidden="true" />
          </button>
          {actions.map(([label, id, Icon]) => (
            <button
              key={id} type="button" aria-label={label} title={label} disabled={!activeFile}
              onClick={() => session.current?.runAction(id)}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <nav className="editor-jump-bar" aria-label="Jump bar">
        <div className="editor-breadcrumbs">
          <button type="button" onClick={() => revealFolder('')}>Workspace</button>
          {path.slice(0, -1).map((segment, index) => {
            const folder = path.slice(0, index + 1).join('/');
            return (
              <span key={folder}>
                <ChevronRight size={13} aria-hidden="true" />
                <button type="button" title={folder} onClick={() => revealFolder(folder)}>{segment}</button>
              </span>
            );
          })}
          {activeFile && (
            <span aria-current="page" title={activeFile.path}>
              <ChevronRight size={13} aria-hidden="true" />{path.at(-1)}
            </span>
          )}
        </div>
        <select ref={jumpFiles} aria-label="Jump to file" value="" onChange={(event) => openFile(Number(event.target.value))} disabled={!files.length}>
          <option value="" disabled>Jump to file</option>
          {files.map((file) => <option key={file.id} value={file.id}>{file.path}</option>)}
        </select>
      </nav>
      <div className="source-editor-frame">
        <div className="source-editor-host" ref={host} hidden={!activeFile} />
        {!activeFile && (
          <div className="editor-empty">
            <p>{files.length ? 'No file open.' : 'Start with a source file.'}</p>
            <button type="button" onClick={files.length ? showQuickOpen : createFile}>{files.length ? 'Open file' : 'New file'}</button>
          </div>
        )}
      </div>
    </section>
  );
}
