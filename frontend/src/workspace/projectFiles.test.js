import { describe, expect, it } from 'vitest';

import {
  addEntries, closeTab, createProject, deleteEntry, executionTarget, joinPath,
  openFile, projectEntry, readUploads, renameEntry, restoreProject, templateContent,
} from './projectFiles.js';

const folder = (path) => ({ kind: 'folder', path });
const file = (path, content = '') => ({ kind: 'file', path, content });

describe('project file operations', () => {
  it('uses the active runnable file in older workspaces with a different saved target', () => {
    const project = restoreProject({ ...createProject(), activeId: 2, tabs: [2, 4], targetId: 4 });
    expect(projectEntry(project).path).toBe('main.cpp');
    const withHeader = addEntries(project, [file('helpers.h')]);
    expect(projectEntry(withHeader).path).toBe('main.cpp');
  });

  it('restores only valid tab and target references while preserving current text', () => {
    const project = addEntries(createProject(), [folder('src'), file('src/module.py', '\uFEFFprint(2)\r\n')]);
    const restored = restoreProject({
      ...project, tabs: [project.activeId, project.activeId, 900], activeId: 900, targetId: 900, nextId: 1,
    });
    expect(restored.tabs).toEqual([project.activeId]);
    expect(restored.activeId).toBe(project.activeId);
    expect(restored.targetId).toBeNull();
    expect(restored.nextId).toBe(project.nextId);
    expect(restored.entries.at(-1).content).toBe('\uFEFFprint(2)\r\n');
    expect(() => restoreProject({ ...project, entries: [...project.entries, project.entries[0]] })).toThrow('metadata');
  });

  it('preserves file IDs, source, tabs and target when renaming a folder', () => {
    let project = addEntries(createProject(), [folder('pkg'), file('pkg/Runner.java', 'class Runner {}')]);
    const id = project.activeId;
    project = renameEntry({ ...project, targetId: id }, project.entries.find((item) => item.path === 'pkg').id, 'renamed');
    expect(project.entries.find((entry) => entry.id === id)).toMatchObject({
      path: 'renamed/Runner.java', content: 'class Runner {}',
    });
    expect(project.tabs).toEqual([1, id]);
    expect(executionTarget(project.entries.find((entry) => entry.id === project.targetId))).toEqual({
      language: 'java', entry_file: 'renamed/Runner.java', main_class: 'renamed.Runner',
    });
  });

  it('retains the two-number cases for an exercise saved by an earlier version', () => {
    const path = 'pkg/Runner.java';
    const content = templateContent(path, 'java-sum');
    const project = addEntries(createProject(), [folder('pkg'), file(path, content)]);
    const restored = restoreProject(project);
    expect(restored.entries.at(-1)).toMatchObject({ path, content, sumTemplate: true });
    expect(restored.entries[0].sumTemplate).toBeUndefined();
  });

  it('validates paths and rejects collisions, missing parents, and oversized file lists atomically', () => {
    const project = createProject();
    for (const path of ['/main.c', '../bad.py', 'a\\b.c', 'bad./x.c', 'bad.txt', 'absent/x.c', 'foo\n.c']) {
      expect(() => addEntries(project, [file(path)])).toThrow();
    }
    expect(() => joinPath('src', 'nested/main.c')).toThrow();
    expect(() => addEntries(project, [folder('main.c')])).toThrow('already exists');
    expect(() => addEntries(project, [file('name.py'), file('name.py')])).toThrow('already exists');
    expect(() => addEntries(project, [folder('a'.repeat(128)), file('a'.repeat(128) + '/' + 'b'.repeat(109) + '.cpp')])).toThrow('240');
    expect(() => addEntries(project, Array.from({ length: 47 }, (_, index) => file(index + '.c')))).toThrow('50');
    expect(project.entries).toHaveLength(4);
  });

  it('keeps closed files available and clears a deleted target and its tabs', () => {
    let project = openFile(createProject(), 2);
    project = closeTab(project, 2);
    expect(project.activeId).toBe(1);
    expect(project.entries.find((entry) => entry.id === 2)).toBeDefined();
    project = addEntries(project, [folder('src'), folder('src/nested'), file('src/nested/run.py')]);
    const activeId = project.activeId;
    const sourceFolder = project.entries.find((entry) => entry.path === 'src');
    project = deleteEntry({ ...project, targetId: activeId }, sourceFolder.id);
    expect(project.activeId).toBe(1);
    expect(project.tabs).toEqual([1]);
    expect(project.targetId).toBeNull();
    expect(project.entries.filter(({ path }) => path.startsWith('src'))).toEqual([]);
  });

  it('generates a packaged Java template and keeps headers out of the target list', () => {
    expect(templateContent('pkg/Runner.java', 'java')).toMatch(/^package pkg;\n\nclass Runner \{/);
    expect(templateContent('hello.py', 'python')).toContain('print');
    expect(templateContent('lib.h', '')).toBe('');
    expect(() => templateContent('pkg/Test.py', 'java')).toThrow('template language');
    expect(executionTarget(file('lib.h'))).toBeNull();
    expect(executionTarget(file('invalid-package/Runner.java'))).toBeNull();
  });

  it('preserves uploaded UTF-8, including BOM and line endings, and rejects invalid UTF-8', async () => {
    function upload(name, bytes) {
      return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer };
    }
    const text = '\uFEFF# π\r\nprint(42)\r\n';
    const additions = await readUploads([upload('run.py', new TextEncoder().encode(text))], 'src');
    expect(additions).toEqual([file('src/run.py', text)]);
    await expect(readUploads([upload('broken.py', Uint8Array.of(255))], '')).rejects.toThrow('UTF-8');
    await expect(readUploads([{ name: 'big.py', size: 1024 * 1024 + 1 }], '')).rejects.toThrow('1 MiB');
  });
});
