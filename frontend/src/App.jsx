import { useEffect, useState } from 'react';

import { Brand } from './components/Brand.jsx';
import { ThemeSelector } from './components/ThemeSelector.jsx';
import { readTheme, saveTheme } from './theme/preferences.js';

export default function App() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  return (
    <div className="min-h-svh bg-workspace">
      <header className="app-bar">
        <div className="app-bar-inner">
          <Brand />
          <ThemeSelector value={theme} onChange={setTheme} />
        </div>
      </header>
      <main className="preview">
        <h1>Cupertino Graphite</h1>
        <p className="preview-description">The design system for the ARCLIS workspace.</p>
      </main>
    </div>
  );
}
