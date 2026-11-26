import { useEffect, useRef, useState } from 'react';
import { PanelBottom, PanelLeft, PanelRight, Play, ScanLine, SlidersHorizontal, Square } from 'lucide-react';

import { Brand } from '../components/Brand.jsx';
import { Button } from '../components/controls.jsx';
import { ThemeSelector } from '../components/ThemeSelector.jsx';
import { panelOptions } from './panelLayout.js';

const panelIcons = { navigator: PanelLeft, inspector: PanelRight, debug: PanelBottom };

function LayoutMenu({ showPreview, toggleView, resetLayout }) {
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  const trigger = useRef(null);
  const dialog = useRef(null);

  function closeMenu() {
    trigger.current.focus();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    function outsidePointer(event) {
      if (!menu.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outsidePointer);
    return () => document.removeEventListener('pointerdown', outsidePointer);
  }, [open]);

  return (
    <>
      <div
        className="layout-menu"
        ref={menu}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeMenu();
          }
        }}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
          }
        }}
      >
        <Button ref={trigger} icon={SlidersHorizontal} aria-expanded={open}
          aria-controls="layout-options" onClick={() => setOpen(!open)}>
          View
        </Button>
        <div className="layout-options" id="layout-options" hidden={!open}>
          {!showPreview && (
            <button type="button" onClick={() => { closeMenu(); dialog.current.showModal(); }}>
              Reset layout…
            </button>
          )}
          <button type="button" onClick={() => { closeMenu(); toggleView(); }}>
            {showPreview ? 'Workspace' : 'Design system'}
          </button>
        </div>
      </div>

      <dialog className="layout-dialog" ref={dialog} aria-labelledby="reset-layout-title"
        aria-describedby="reset-layout-description" onClose={() => trigger.current.focus()}>
        <h2 id="reset-layout-title">Reset workspace layout?</h2>
        <p id="reset-layout-description">Show all panels and restore their default sizes.</p>
        <div className="layout-dialog-actions">
          <Button onClick={() => dialog.current.close()}>Cancel</Button>
          <Button variant="primary" onClick={() => { resetLayout(); dialog.current.close(); }}>
            Reset layout
          </Button>
        </div>
      </dialog>
    </>
  );
}

export function WorkspaceToolbar({
  theme, changeTheme, layout, togglePanel, showPreview, toggleView, resetLayout,
  target, execution, runTarget,
  canAnalyze, analyzeActiveFile, analysisStatus,
}) {
  const ViewTitle = showPreview ? 'span' : 'h1';

  return (
    <header className="workspace-toolbar" aria-label="Workspace toolbar">
      <div className="workspace-identity">
        <Brand />
        <ViewTitle className="workspace-name">{showPreview ? 'Design system' : 'Workspace'}</ViewTitle>
      </div>
      {(!showPreview || execution.active) && (
        <div className="execution-toolbar" aria-label="Source actions">
          <Button icon={Play} aria-label="Run" title={target ? 'Run ' + target.entry_file : 'Select an execution target'}
            aria-keyshortcuts="Control+Enter Meta+Enter" disabled={showPreview || !target || execution.active} onClick={runTarget} />
          <Button icon={Square} aria-label="Stop" title="Stop execution"
            aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
            disabled={!execution.active || execution.run.state === 'CANCELLING'} onClick={execution.stop} />
          {!showPreview && (
            <Button icon={ScanLine} aria-label="Analyze" title={analysisStatus === 'running' ? 'Analyzing source'
              : canAnalyze ? 'Analyze the active file' : 'Analysis is available for C and Python files'}
              disabled={!canAnalyze} onClick={analyzeActiveFile}>Analyze</Button>
          )}
          <span
            className="execution-status" role="status" aria-label="Execution status"
            data-state={execution.failed ? 'failed' : execution.active ? 'active' : 'idle'}
          >{execution.label}</span>
        </div>
      )}
      <div className="workspace-toolbar-actions">
        <ThemeSelector value={theme} onChange={changeTheme} />
        {!showPreview && (
          <div className="toolbar-panels" role="group" aria-label="Panel visibility">
            {Object.entries(panelOptions).map(([panel, { label }]) => (
              <Button
                key={panel}
                icon={panelIcons[panel]}
                aria-label={label + ' panel'}
                aria-controls={'workspace-' + panel}
                aria-pressed={layout[panel].visible}
                title={(layout[panel].visible ? 'Hide ' : 'Show ') + label.toLowerCase()}
                onClick={(event) => {
                  event.currentTarget.focus();
                  togglePanel(panel);
                }}
              />
            ))}
          </div>
        )}
        <LayoutMenu showPreview={showPreview} toggleView={toggleView} resetLayout={resetLayout} />
      </div>
    </header>
  );
}
