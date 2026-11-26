import { useEffect, useState } from 'react';

import { Brand } from './components/Brand.jsx';
import { Button } from './components/controls.jsx';
import { ThemeSelector } from './components/ThemeSelector.jsx';
import { ComponentPreview } from './preview/ComponentPreview.jsx';
import { readTheme, saveTheme } from './theme/preferences.js';
import { Workspace } from './workspace/Workspace.jsx';

export default function App() {
  const [theme, setTheme] = useState(readTheme);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  return (
    <div className="app-frame min-h-svh bg-workspace">
      <header className="workspace-toolbar" aria-label="Workspace toolbar">
        <Brand />
        <div className="workspace-toolbar-actions">
          <ThemeSelector value={theme} onChange={setTheme} />
          <Button onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Workspace' : 'Design system'}
          </Button>
        </div>
      </header>
      {showPreview ? (
        <main className="preview">
          <h1>Cupertino Graphite</h1>
          <p className="preview-description">Preview source, controls, and status in both workspace themes.</p>
          <ComponentPreview />
        </main>
      ) : <Workspace />}
    </div>
  );
}
