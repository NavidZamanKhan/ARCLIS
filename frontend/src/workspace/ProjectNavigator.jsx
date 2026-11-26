import { useCallback, useEffect, useRef, useState } from 'react';
import { Braces, ChevronDown, ChevronRight, Ellipsis, FileCode, Folder, FolderOpen, Plus } from 'lucide-react';

import { basename, fileMode, languages, parentPath } from './projectFiles.js';

function FileMenu({ menu, close, choose }) {
  const ref = useRef(null);
  const isFolder = menu.item?.kind === 'folder' || !menu.item;
  const actions = [
    ...(isFolder ? [['new-file', 'New File'], ['new-folder', 'New Folder'], ['upload', 'Upload Files']] : [['download', 'Download']]),
    ...(menu.item ? [['rename', 'Rename'], ['delete', 'Delete']] : []),
    ...(!menu.item ? [['reset', 'Reset Workspace']] : []),
  ];

  useEffect(() => {
    ref.current.querySelector('button').focus();
    function outside(event) {
      if (!ref.current?.contains(event.target)) close(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu, close]);

  function handleKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(ref.current.querySelectorAll('button'));
    const index = buttons.indexOf(document.activeElement);
    const next = { Home: 0, End: buttons.length - 1,
      ArrowDown: (index + 1) % buttons.length, ArrowUp: (index - 1 + buttons.length) % buttons.length };
    buttons[next[event.key]].focus();
  }

  return (
    <div
      ref={ref} className="project-menu" role="menu" aria-label="File actions"
      style={{ left: menu.left, top: menu.top }}
      onKeyDown={handleKey}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
    >
      {actions.map(([type, label]) => (
        <button key={type} type="button" role="menuitem" tabIndex={-1} onClick={() => { close(true); choose(type, menu.item); }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProjectNavigator({ project, activeFile, visible, openFile, goToSymbol, choose, reveal, feedback }) {
  const rootButton = useRef(null);
  const rows = useRef(new Map());
  const [view, setView] = useState('files');
  const [collapsed, setCollapsed] = useState(new Set());
  const [menu, setMenu] = useState(null);
  const [focusPath, setFocusPath] = useState(null);
  const closeMenu = useCallback((restore) => {
    if (restore) menu?.anchor.focus();
    setMenu(null);
  }, [menu]);

  useEffect(() => {
    if (!reveal) return;
    setView('files');
    setCollapsed((previous) => new Set([...previous].filter((id) => {
      const folder = project.entries.find((entry) => entry.id === id);
      return folder && folder.path !== reveal.path && !reveal.path.startsWith(folder.path + '/');
    })));
    setFocusPath(reveal.path);
  }, [reveal]); // A breadcrumb requests focus only when clicked.

  useEffect(() => {
    if (!visible || focusPath === null || view !== 'files') return;
    (rows.current.get(focusPath) ?? rootButton.current)?.focus();
    setFocusPath(null);
  }, [focusPath, visible, view, collapsed]);

  function openMenu(event, item, anchor = event.currentTarget) {
    const rect = anchor.getBoundingClientRect();
    setMenu({
      item, anchor,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 170)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 176)),
    });
  }

  function toggleFolder(id) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function handleTreeKey(event) {
    if (!event.target.matches('.navigator-row-main')) return;
    const buttons = [...event.currentTarget.querySelectorAll('.navigator-row-main')];
    const index = buttons.indexOf(event.target);
    const focus = {
      ArrowDown: buttons[index + 1], ArrowUp: buttons[index - 1], Home: buttons[0], End: buttons.at(-1),
    }[event.key];
    if (focus) {
      event.preventDefault();
      focus.focus();
    }
  }

  function tree(folder) {
    const items = project.entries.filter(({ path }) => parentPath(path) === folder)
      .sort((left, right) => left.kind === right.kind ? left.path.localeCompare(right.path) : left.kind === 'folder' ? -1 : 1);
    if (!items.length) return null;
    return (
      <ul className="navigator-list" onKeyDown={folder ? undefined : handleTreeKey}>
        {items.map((item) => {
          const nested = item.kind === 'folder';
          const expanded = nested && !collapsed.has(item.id);
          const label = nested ? item.path : item.path + ', ' + languages[fileMode(item.path)];
          const Disclosure = expanded ? ChevronDown : ChevronRight;
          return (
            <li key={item.id}>
              <div className="navigator-row" onContextMenu={(event) => {
                event.preventDefault();
                openMenu(event, item, rows.current.get(item.path));
              }}>
                <button
                  ref={(element) => {
                    if (element) rows.current.set(item.path, element);
                    else rows.current.delete(item.path);
                  }}
                  type="button" className="navigator-file navigator-row-main" aria-label={label} title={item.path}
                  aria-current={item.id === activeFile?.id ? 'true' : undefined} aria-expanded={nested ? expanded : undefined}
                  onClick={() => nested ? toggleFolder(item.id) : openFile(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      openMenu(event, item);
                    }
                    if (nested && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
                      event.preventDefault();
                      if (expanded === (event.key === 'ArrowLeft')) toggleFolder(item.id);
                    }
                  }}
                >
                  {nested ? <><Disclosure size={12} aria-hidden="true" /><Folder size={15} aria-hidden="true" /></>
                    : <FileCode size={15} aria-hidden="true" />}
                  <span>{basename(item.path)}</span>
                  {!nested && <span className="file-kind">{languages[fileMode(item.path)]}</span>}
                </button>
                <button
                  type="button" className="navigator-more" aria-haspopup="menu"
                  aria-label={'Actions for ' + item.path} aria-expanded={menu?.item?.id === item.id}
                  onClick={(event) => openMenu(event, item)}
                ><Ellipsis size={16} aria-hidden="true" /></button>
              </div>
              {expanded && tree(item.path)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <aside className="workspace-navigator" id="workspace-navigator" aria-label="Navigator" hidden={!visible}>
      <div className="workspace-bar navigator-bar">
        <h2>Navigator</h2>
        <button ref={rootButton} type="button" className="navigator-more" aria-label="Project actions" title="Project actions"
          aria-haspopup="menu" aria-expanded={Boolean(menu && !menu.item)} onClick={(event) => openMenu(event, null)}>
          <Plus size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="navigator-selector" aria-label="Navigator view" role="group">
        <button type="button" aria-pressed={view === 'files'} onClick={() => setView('files')}>
          <FolderOpen size={15} aria-hidden="true" />Files
        </button>
        <button type="button" aria-pressed={view === 'symbols'} onClick={() => setView('symbols')}>
          <Braces size={15} aria-hidden="true" />Symbols
        </button>
      </div>
      {view === 'files' ? (
        <>
          <h3 className="navigator-caption">Project files</h3>
          {tree('') ?? <p className="navigator-empty">No project files.</p>}
        </>
      ) : (
        <>
          <h3 className="navigator-caption">Sample declarations</h3>
          {activeFile?.symbols?.length ? (
            <ul className="navigator-list">
              {activeFile.symbols.map((symbol) => (
                <li key={symbol}>
                  <button type="button" className="navigator-file font-mono" onClick={() => goToSymbol(symbol)}>
                    <Braces size={15} aria-hidden="true" />{symbol}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="navigator-empty">No sample declarations.</p>}
        </>
      )}
      {feedback && <p className="navigator-empty" role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
      {visible && menu && <FileMenu menu={menu} close={closeMenu} choose={choose} />}
    </aside>
  );
}
