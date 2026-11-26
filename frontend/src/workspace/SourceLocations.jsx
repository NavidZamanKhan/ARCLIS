import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { searchSource } from './sourceLocations.js';

export function WorkspaceSearch({ files, content, contentVersion, goToLocation, focusRequest }) {
  const input = useRef(null);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const { matches, truncated } = useMemo(
    () => searchSource(files, content, deferred), [files, content, contentVersion, deferred],
  );

  useEffect(() => { input.current?.focus(); }, [focusRequest]);

  return (
    <div className="navigator-locations">
      <input
        ref={input} type="search" aria-label="Search workspace" placeholder="Search source files"
        maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)}
      />
      {deferred && (
        <p className="navigator-empty">
          {truncated ? 'First 100 matches' : matches.length === 1 ? '1 match' : matches.length + ' matches'}
        </p>
      )}
      <ul className="workspace-location-list" aria-label="Search results">
        {matches.map((match) => (
          <li key={[match.id, match.line, match.column].join(':')}>
            <button type="button" onClick={() => goToLocation(match)}>
              <span className="location-address">{match.path}:{match.line}:{match.column}</span>
              <span className="location-snippet">{match.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const severityLabel = { error: 'Error', warning: 'Warning', note: 'Note' };

export function IssueList({ issues, goToLocation }) {
  if (!issues.length) return <p className="navigator-empty">No source diagnostics.</p>;
  return (
    <ul className="workspace-location-list" aria-label="Compiler issues">
      {issues.map((issue) => (
        <li key={issue.key}>
          <button type="button" disabled={issue.stale} onClick={() => goToLocation(issue)}>
            <span className="location-address">{issue.path}:{issue.line}:{issue.column}</span>
            <span className="location-severity" data-severity={issue.severity}>
              {severityLabel[issue.severity]}{issue.stale ? ' · Source changed' : ''}
            </span>
            <span className="location-snippet">{issue.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
