import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, PanelBottom, PanelLeft, PanelRight, Play, ScanLine, SlidersHorizontal, Square } from 'lucide-react';

import { Brand } from '../components/Brand.jsx';
import { Button } from '../components/controls.jsx';
import { ThemeSelector } from '../components/ThemeSelector.jsx';
import { panelOptions } from './panelLayout.js';
import { languages } from './projectFiles.js';

const panelIcons = { navigator: PanelLeft, inspector: PanelRight, debug: PanelBottom };
const statusIcons = { success: Check, failed: CircleAlert };

function ExecutionStatus({ execution, serviceStatus }) {
  let tone = 'idle';
  if (!serviceStatus) {
    if (execution.failed) tone = 'failed';
    else if (execution.active) tone = 'active';
    else if (execution.run.state === 'COMPLETED') tone = 'success';
  }
  const Icon = statusIcons[tone];

  return (
    <span className="execution-status" role="status" aria-label="Execution status" data-state={tone}>
      <span className="execution-status-content" key={serviceStatus ?? execution.run.state}>
        {Icon ? <Icon size={14} aria-hidden="true" /> : <span className="execution-status-dot" aria-hidden="true" />}
        {serviceStatus ?? execution.label}
      </span>
    </span>
  );
}

function LayoutMenu({ showPreview, toggleView, resetLayout, openPreferences, retryServices }) {
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
          {!showPreview && openPreferences && (
            <button type="button" onClick={() => { closeMenu(); openPreferences(); }}>Editor preferences</button>
          )}
          {!showPreview && retryServices && (
            <button type="button" onClick={() => { closeMenu(); retryServices(); }}>Retry services</button>
          )}
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
        <p id="reset-layout-description">Restore each panel’s default size and visibility.</p>
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
  canAnalyze, analyzeActiveFile, analysisStatus, serviceStatus, canRun, restricted, retryServices,
  quick, switchWorkspace, language, switchLanguage, showExample, openPreferences, supportsAnalysis, loading,
}) {
  const ViewTitle = showPreview ? 'span' : 'h1';

  return (
    <header className="workspace-toolbar" aria-label="Workspace toolbar">
      <div className="workspace-identity">
        <Brand />
        <ViewTitle className="workspace-name">{showPreview ? 'Design system' : quick ? 'Quick Run' : 'Projects'}</ViewTitle>
      </div>
      {(!showPreview || execution.active) && (
        <div className="execution-toolbar" role="group" aria-label="Source actions">
          <div className="source-buttons">
            {quick && <select className="language-select" aria-label="Programming language" value={language ?? 'c'}
              disabled={loading || execution.active} onChange={(event) => switchLanguage(event.target.value)}>
              {Object.entries(languages).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>}
            <Button variant="primary" icon={Play} aria-label="Run" title={restricted ? 'Execution is disabled in this demo'
              : !canRun ? 'Local execution is unavailable' : target ? `Run ${target.entry_file} (Ctrl+Enter)` : 'Add or choose a project entry file'}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              disabled={!canRun || showPreview || !target || execution.active} onClick={runTarget}>Run</Button>
            <Button icon={Square} aria-label="Stop" title="Stop execution"
              aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
              disabled={!execution.active || execution.run.state === 'CANCELLING'} onClick={execution.stop} />
            {!showPreview && (!quick || supportsAnalysis) && (
              <Button icon={ScanLine} aria-label="Analyze" title={restricted ? 'Analysis is disabled in this demo'
                : analysisStatus === 'running' ? 'Analyzing source'
                : canAnalyze ? 'Analyze the active file'
                : supportsAnalysis ? 'Local analysis is unavailable' : 'Analysis is available for C and Python files'}
                disabled={!canAnalyze} onClick={analyzeActiveFile}>Analyze</Button>
            )}
          </div>
          <ExecutionStatus execution={execution} serviceStatus={serviceStatus} />
          {!quick && (execution.active ? execution.run.target : target)?.entry_file && (
            <span className="toolbar-entry" title={(execution.active ? execution.run.target : target).entry_file}>
              {(execution.active ? execution.run.target : target).entry_file}
            </span>
          )}
        </div>
      )}
      <div className="workspace-toolbar-actions">
        {!showPreview && quick && <Button disabled={loading || execution.active} onClick={showExample}>Examples</Button>}
        {!showPreview && <Button disabled={execution.active} onClick={switchWorkspace}>{quick ? 'Projects' : 'Quick Run'}</Button>}
        <ThemeSelector value={theme} onChange={changeTheme} />
        {!showPreview && (
          <div className="toolbar-panels" role="group" aria-label="Panel visibility">
            {Object.entries(panelOptions).filter(([panel]) => !quick || panel === 'debug').map(([panel, { label }]) => (
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
        <LayoutMenu showPreview={showPreview} toggleView={toggleView} resetLayout={resetLayout}
          openPreferences={openPreferences} retryServices={retryServices} />
      </div>
    </header>
  );
}
