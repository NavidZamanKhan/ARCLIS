import { ProjectFileError, sourceFilenames } from './projectFiles.js';

export function createQuickRun() {
  const entries = Object.values(sourceFilenames).map((path, index) => ({
    kind: 'file', id: -(index + 1), path, content: '',
  }));
  return { entries, activeId: entries[0].id, tabs: [] };
}

function restoreQuickRun(record) {
  const initial = createQuickRun();
  if (!Array.isArray(record?.entries) || record.entries.length !== initial.entries.length
    || !initial.entries.some(({ id }) => id === record.activeId)) {
    throw new ProjectFileError('The saved Quick Run drafts have an invalid format.');
  }
  const entries = initial.entries.map((entry) => {
    const saved = record.entries.find(({ id }) => id === entry.id);
    if (saved?.path !== entry.path || typeof saved.content !== 'string') {
      throw new ProjectFileError('A saved Quick Run draft is invalid.');
    }
    return { ...entry, content: saved.content };
  });
  return { ...initial, entries, activeId: record.activeId };
}

export const quickRunStorage = {
  recordKey: 'quick-run-v1',
  draftKey: 'arclis.quick-run-draft',
  restore: restoreQuickRun,
};
