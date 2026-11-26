import { useState } from 'react';
import { Check, CircleX, Copy, FileCode, Info, RotateCcw, TriangleAlert } from 'lucide-react';

import { Button, Select, Status } from '../components/controls.jsx';
import { samples, sourceText } from './samples.js';

const languageOptions = Object.entries(samples).map(([value, sample]) => ({ value, label: sample.label }));
const statuses = [
  { tone: 'success', icon: Check, label: 'Success' },
  { tone: 'warning', icon: TriangleAlert, label: 'Warning' },
  { tone: 'error', icon: CircleX, label: 'Error' },
  { tone: 'information', icon: Info, label: 'Information' },
];
const palette = [
  { label: 'Workspace', token: '--surface-workspace' },
  { label: 'Console', token: '--surface-console' },
  { label: 'Accent', token: '--accent' },
  { label: 'Selection', token: '--surface-selected' },
];

export function ComponentPreview() {
  const [language, setLanguage] = useState('c');
  const [feedback, setFeedback] = useState('');
  const sample = samples[language];

  function selectLanguage(value) {
    setLanguage(value);
    setFeedback('');
  }

  async function copySource() {
    try {
      await navigator.clipboard.writeText(sourceText(sample.lines));
      setFeedback('Sample copied.');
    } catch {
      setFeedback('Clipboard unavailable. Select the source to copy it.');
    }
  }

  return (
    <>
      <div className="preview-surface">
        <section className="source-panel" aria-label="Source preview">
          <div className="panel-bar source-title">
            <span className="source-file"><FileCode size={16} aria-hidden="true" />{sample.filename}</span>
            <span className="source-mode">Read-only</span>
          </div>
          <pre className="source-code font-mono" tabIndex={0} aria-label={sample.label + ' source sample'}>
            <code>
              {sample.lines.map((line, index) => (
                <span className="source-line" key={index}>
                  <span className="line-number" aria-hidden="true">{index + 1}</span>
                  <span className="line-text">
                    {line.map((part, offset) => typeof part === 'string' ? part : (
                      <span key={offset} data-syntax={part.kind}>{part.text}</span>
                    ))}
                  </span>
                </span>
              ))}
            </code>
          </pre>
        </section>

        <section className="controls-panel" aria-labelledby="controls-heading">
          <div className="panel-bar">
            <h2 id="controls-heading">Controls</h2>
          </div>
          <div className="controls-content">
            <Select label="Sample language" options={languageOptions} value={language} onChange={selectLanguage} />
            <div className="preview-actions">
              <Button variant="primary" icon={Copy} onClick={copySource}>Copy source</Button>
              <Button
                icon={RotateCcw}
                disabled={language === 'c' && !feedback}
                onClick={() => selectLanguage('c')}
              >
                Reset
              </Button>
            </div>
            <p className="preview-feedback" role="status">{feedback}</p>
            <section className="status-preview" aria-labelledby="status-heading">
              <h3 id="status-heading">Status indicators</h3>
              <ul className="status-grid">
                {statuses.map(({ tone, icon, label }) => (
                  <li key={tone}><Status tone={tone} icon={icon}>{label}</Status></li>
                ))}
              </ul>
            </section>
          </div>
        </section>
      </div>

      <section className="palette" aria-labelledby="palette-heading">
        <h2 id="palette-heading">Palette</h2>
        <ul className="palette-list">
          {palette.map(({ label, token }) => (
            <li key={token}>
              <span className="palette-swatch" style={{ '--swatch': 'var(' + token + ')' }} aria-hidden="true" />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
