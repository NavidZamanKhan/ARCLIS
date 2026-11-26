import { expect, it } from 'vitest';

import { currentIssues, issueMarkers, readBuildIssues, searchSource } from './sourceLocations.js';

const files = [
  { id: 1, path: 'src/main.c', content: 'int main() {\n    return 0;\n}\n' },
  { id: 2, path: 'pkg/Test.java', content: 'class Test {}\n' },
  { id: 3, path: 'main.py', content: '\uFEFFprint(BAD)\r\nprint(".* [X]")\r\n' },
];
const content = (file) => file.content;
const sources = new Map(files.map((file) => [file.path, file]));

it('parses known compiler formats and discards unknown files, invalid lines and duplicates', () => {
  const log = [
    '/workspace/src/main.c:2:5: warning: unused value',
    '/workspace/src/main.c:2:5: warning: unused value',
    '/workspace/src/main.c:88:5: error: invalid line',
    '/workspace/pkg/Test.java:1: error: missing identifier',
    '  File "<string>", line 4, in <module>',
    '  File "/workspace/main.py", line 2',
    'SyntaxError: invalid syntax',
    '/tmp/other.c:1:1: error: unknown file',
  ].join('\n');
  const issues = readBuildIssues(log, sources);
  expect(issues.map(({ id, line, column, severity }) => [id, line, column, severity])).toEqual([
    [1, 2, 5, 'warning'], [2, 1, 1, 'error'], [3, 2, 1, 'error'],
  ]);
});

it('only places markers for the submitted file while its path and contents match', () => {
  const log = '/workspace/src/main.c:2:5: error: invalid value\n/workspace/main.py:2: error: syntax';
  const changed = [{ ...files[0], content: 'edited' }, files[1], { ...files[2], path: 'renamed.py' }];
  const issues = readBuildIssues(log, sources);
  expect(currentIssues(issues, sources, changed, content).every((issue) => issue.stale)).toBe(true);
  expect(Object.keys(issueMarkers(currentIssues(issues, sources, changed, content)))).toEqual([]);
  expect(issueMarkers(currentIssues(issues, sources, files, content))['src/main.c']).toEqual([
    { message: 'invalid value', severity: 8, startLineNumber: 2, endLineNumber: 2, startColumn: 5, endColumn: 6 },
  ]);
});

it('searches literal text in all buffers with Monaco-compatible BOM and CRLF coordinates', () => {
  expect(searchSource(files, content, 'PRINT').matches.map(({ path, line, column, length }) => (
    [path, line, column, length]
  ))).toEqual([['main.py', 1, 1, 5], ['main.py', 2, 1, 5]]);
  expect(searchSource(files, content, '.* [x]').matches).toMatchObject([{ path: 'main.py', line: 2, column: 8, length: 6 }]);
  expect(searchSource([{ id: 9, path: 'many.c', content: 'a'.repeat(101) }], content, 'a')).toMatchObject({ truncated: true });
});
