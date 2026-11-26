function byteColumns(line) {
  const starts = [];
  const ends = [];
  for (let index = 0; index < line.length;) {
    const codePoint = line.codePointAt(index);
    const characters = codePoint > 0xffff ? 2 : 1;
    const bytes = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    starts.push(index + 1);
    ends.push(index + 1);
    for (let byte = 1; byte < bytes; ++byte) {
      starts.push(index + 1);
      ends.push(index + 1 + characters);
    }
    index += characters;
  }
  return { starts, ends };
}

export function sourceRanges(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const cache = new Map();
  function columnAt({ line, column }, field) {
    const text = lines[line - 1];
    if (!cache.has(line)) cache.set(line, byteColumns(text));
    return cache.get(line)[field][column - 1] ?? text.length + 1;
  }
  return (range) => {
    const { start, end } = range ?? {};
    const first = lines[start?.line - 1];
    const last = lines[end?.line - 1];
    if (first === undefined || last === undefined || !Number.isSafeInteger(start.column) || start.column < 1
      || !Number.isSafeInteger(end.column) || end.column < 1 || end.line < start.line) return null;
    const column = columnAt(start, 'starts');
    const endColumn = columnAt(end, 'ends');
    return { line: start.line, column, endLine: end.line, endColumn };
  };
}

export function analysisMarkers(report, locate) {
  return report.diagnostics.flatMap(({ range, message, code }) => {
    const location = locate(range);
    if (!location) return [];
    const { line, column, endLine, endColumn } = location;
    return [{
      severity: 8, message, code, source: 'ARCLIS analysis',
      startLineNumber: line, startColumn: column, endLineNumber: endLine,
      endColumn: line === endLine ? Math.max(column + 1, endColumn) : endColumn,
    }];
  });
}
