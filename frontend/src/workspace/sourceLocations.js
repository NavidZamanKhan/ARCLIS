const compilerLine = /^([^:\r\n]+):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.+)$/;
const pythonLocation = /^\s*File "([^"]+)", line (\d+)(?:,|$)/;
const pythonError = /^(?:SyntaxError|IndentationError|TabError):\s*(.+)$/;
const markerSeverity = { error: 8, warning: 4, note: 2 };

function sourcePath(path) {
  return path.replace(/^\/workspace\//, '').replace(/^\.\//, '');
}

export function readBuildIssues(log, sources) {
  const issues = new Map();
  const lineCounts = new Map();
  let pythonFrame = null;

  function add(path, line, column, severity, message) {
    const source = sources.get(sourcePath(path));
    if (!source || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return;
    if (!lineCounts.has(source.path)) lineCounts.set(source.path, source.content.split(/\r\n|\r|\n/).length);
    if (line > lineCounts.get(source.path)) return;
    const key = JSON.stringify([source.path, line, column, severity, message]);
    if (!issues.has(key)) issues.set(key, { key, id: source.id, path: source.path, line, column, severity, message });
  }

  for (const logLine of log.split(/\r\n|\r|\n/)) {
    const compiler = logLine.match(compilerLine);
    if (compiler) {
      const [, path, line, column, kind, message] = compiler;
      add(path, Number(line), Number(column ?? 1), kind === 'fatal error' ? 'error' : kind, message);
      continue;
    }
    const location = logLine.match(pythonLocation);
    if (location) pythonFrame = location;
    const python = logLine.match(pythonError);
    if (python && pythonFrame) {
      add(pythonFrame[1], Number(pythonFrame[2]), 1, 'error', logLine);
      pythonFrame = null;
    }
  }
  return [...issues.values()];
}

export function currentIssues(issues, sources, files, content) {
  if (!issues.length) return issues;
  const byId = new Map(files.map((file) => [file.id, file]));
  const fresh = new Map();
  return issues.map((issue) => {
    if (!fresh.has(issue.id)) {
      const file = byId.get(issue.id);
      fresh.set(issue.id, file?.path === issue.path && content(file) === sources.get(issue.path)?.content);
    }
    return { ...issue, stale: !fresh.get(issue.id) };
  });
}

export function issueMarkers(issues) {
  const markers = Object.create(null);
  for (const { stale, path, line, column, severity, message } of issues) {
    if (stale) continue;
    (markers[path] ??= []).push({
      message, severity: markerSeverity[severity],
      startLineNumber: line, endLineNumber: line, startColumn: column, endColumn: column + 1,
    });
  }
  return markers;
}

export function searchSource(files, content, query) {
  if (!query) return { matches: [], truncated: false };
  const limit = 100;
  const pattern = new RegExp(query.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'), 'giu');
  const matches = [];
  for (const file of files) {
    const lines = content(file).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(pattern)) {
        if (matches.length === limit) return { matches, truncated: true };
        const column = match.index + 1;
        const length = match[0].length;
        const start = Math.max(0, match.index - 24);
        const end = Math.min(line.length, match.index + length + 44);
        const snippet = (start ? '…' : '') + line.slice(start, end).trim() + (end < line.length ? '…' : '');
        matches.push({ id: file.id, path: file.path, line: index + 1, column, length, snippet });
      }
    }
  }
  return { matches, truncated: false };
}
