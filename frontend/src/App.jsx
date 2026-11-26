import { useLayoutEffect, useState } from 'react';

import { ComponentPreview } from './preview/ComponentPreview.jsx';
import { readTheme, saveTheme } from './theme/preferences.js';
import { Workspace } from './workspace/Workspace.jsx';
import { WorkspaceToolbar } from './workspace/WorkspaceToolbar.jsx';
import { defaultLayout } from './workspace/panelLayout.js';

export default function App() {
  const [theme, setTheme] = useState(readTheme);
  const [showPreview, setShowPreview] = useState(false);
  const [layout, setLayout] = useState(defaultLayout);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  function togglePanel(panel) {
    setLayout((previous) => ({
      ...previous, [panel]: { ...previous[panel], visible: !previous[panel].visible },
    }));
  }

  function resizePanel(panel, size) {
    setLayout((previous) => ({ ...previous, [panel]: { ...previous[panel], size } }));
  }

  return (
    <div className="app-frame min-h-svh bg-workspace">
      <WorkspaceToolbar
        theme={theme} changeTheme={setTheme} layout={layout} togglePanel={togglePanel}
        showPreview={showPreview} toggleView={() => setShowPreview(!showPreview)}
        resetLayout={() => setLayout(defaultLayout())}
      />
      <Workspace hidden={showPreview} layout={layout} onResize={resizePanel} theme={theme} />
      {showPreview && (
        <main className="preview">
          <h1>Cupertino Graphite</h1>
          <p className="preview-description">Preview source, controls, and status in both workspace themes.</p>
          <ComponentPreview />
        </main>
      )}
    </div>
  );
}
