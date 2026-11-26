import { expect, it } from 'vitest';

import { addEntries, createProject } from '../workspace/projectFiles.js';
import { makeExecutionPayload } from './payload.js';

it('selects the target toolchain, source directory and current editor text', () => {
  const project = addEntries(createProject(), [
    { kind: 'folder', path: 'app' },
    { kind: 'file', path: 'app/main.c', content: 'original' },
    { kind: 'file', path: 'app/helper.c', content: 'helper' },
    { kind: 'file', path: 'common.h', content: 'header' },
  ]);
  expect(makeExecutionPayload(project.entries, project.activeId,
    ({ id }) => id === project.activeId ? 'edited' : undefined)).toEqual({
    language: 'c', entry_file: 'app/main.c', interactive: true,
    files: [
      { path: 'app/main.c', content: 'edited' },
      { path: 'app/helper.c', content: 'helper' },
      { path: 'common.h', content: 'header' },
    ],
  });
});

it('collects Java package files and Python modules and respects the byte limit', () => {
  const project = addEntries(createProject(), [
    { kind: 'folder', path: 'pkg' },
    { kind: 'file', path: 'pkg/Run.java', content: 'java' },
    { kind: 'file', path: 'pkg/module.py', content: 'python' },
  ]);
  const read = () => undefined;
  const java = makeExecutionPayload(project.entries, project.activeId, read);
  expect(java.main_class).toBe('pkg.Run');
  expect(java.files.map(({ path }) => path)).toEqual(['Main.java', 'pkg/Run.java']);
  const python = makeExecutionPayload(project.entries, 4, read);
  expect(python.files.map(({ path }) => path)).toEqual(['main.py', 'pkg/module.py']);
  expect(() => makeExecutionPayload(project.entries, 4, () => 'π'.repeat(524289))).toThrow('1 MiB');
  expect(() => makeExecutionPayload(project.entries, null, read)).toThrow('Select an execution target');
});
