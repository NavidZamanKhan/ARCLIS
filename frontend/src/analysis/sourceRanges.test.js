import { expect, it } from 'vitest';

import { analysisMarkers, sourceRanges } from './sourceRanges.js';

it('maps the analyzer byte columns to Monaco columns across BOM, CRLF and surrogate pairs', () => {
  const locate = sourceRanges('\uFEFFπ😀xyz\r\nend');
  expect(locate({ start: { line: 1, column: 7 }, end: { line: 2, column: 3 } })).toEqual({
    line: 1, column: 4, endLine: 2, endColumn: 3,
  });
  expect(locate({ start: { line: 1, column: 4 }, end: { line: 1, column: 5 } })).toEqual({
    line: 1, column: 2, endLine: 1, endColumn: 4,
  });
  expect(locate({ start: { line: 3, column: 1 }, end: { line: 3, column: 1 } })).toBeNull();
});

it('maps diagnostics to marked ranges and gives point diagnostics one column', () => {
  const point = { line: 1, column: 2 };
  const diagnostics = [{ range: { start: point, end: point }, code: 'syntax-error', message: 'Syntax error' }];
  expect(analysisMarkers({ diagnostics }, sourceRanges('a;'))).toEqual([{
    source: 'ARCLIS analysis', code: 'syntax-error', message: 'Syntax error', severity: 8,
    startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 3,
  }]);
});
