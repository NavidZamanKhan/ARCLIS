import { useCallback, useEffect, useRef, useState } from 'react';

import { createProject } from './projectFiles.js';
import {
  createWorkspaceSaver, decodeWorkspaceRecord, openWorkspaceStorage, readWorkspaceDraft, saveConflict, saveUnavailable,
} from './workspaceStorage.js';

export function useWorkspaceProject() {
  const [project, setProject] = useState(createProject);
  const currentProject = useRef(project);
  const buffers = useRef(new Map());
  const saver = useRef(null);
  const [modified, setModified] = useState(new Set());
  const [contentVersion, setContentVersion] = useState(0);
  const [loading, setLoading] = useState(() => typeof indexedDB !== 'undefined');
  const [storageIssue, setStorageIssue] = useState(() => typeof indexedDB === 'undefined' ? saveUnavailable : '');

  const readContent = useCallback((file) => buffers.current.get(file.id) ?? file.content, []);
  const snapshot = useCallback(() => ({
    ...currentProject.current,
    entries: currentProject.current.entries.map((entry) => entry.kind === 'file' && buffers.current.has(entry.id)
      ? { ...entry, content: readContent(entry) } : entry),
  }), [readContent]);

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return undefined;
    let disposed = false;
    let storage;

    async function load() {
      const draft = readWorkspaceDraft();
      try {
        storage = await openWorkspaceStorage();
        if (disposed) { storage.close(); return; }
        const saved = decodeWorkspaceRecord(await storage.read());
        if (disposed) return;
        const changedElsewhere = draft && draft.revision !== saved.revision && draft.inFlight !== saved.revision;
        const alreadySaved = changedElsewhere && JSON.stringify(draft.project) === JSON.stringify(saved.project);
        const recovery = alreadySaved ? null : draft;
        const conflict = Boolean(changedElsewhere && recovery);
        const restored = recovery?.project ?? saved.project;
        if (restored) {
          currentProject.current = restored;
          setProject(restored);
        }
        if (conflict) setStorageIssue(saveConflict);
        saver.current = createWorkspaceSaver(storage, saved.revision, snapshot, (message) => {
          if (!disposed) setStorageIssue(message);
        }, conflict);
        if (recovery) saver.current.schedule();
      } catch {
        storage?.close();
        if (disposed) return;
        if (draft) {
          currentProject.current = draft.project;
          setProject(draft.project);
        }
        setStorageIssue(saveUnavailable);
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    function protect() { saver.current?.protect(); }
    function visibilityChanged() {
      if (document.visibilityState === 'hidden') protect();
    }

    void load();
    window.addEventListener('pagehide', protect);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      disposed = true;
      window.removeEventListener('pagehide', protect);
      document.removeEventListener('visibilitychange', visibilityChanged);
      if (saver.current) saver.current.close();
      else storage?.close();
      saver.current = null;
    };
  }, [snapshot]);

  const markFile = useCallback((id, dirty, content) => {
    buffers.current.set(id, content);
    setContentVersion((version) => version + 1);
    setModified((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
    saver.current?.schedule();
  }, []);

  function updateProject(change) {
    const previous = currentProject.current;
    const next = change(previous);
    if (previous === next) return;
    if (previous.entries !== next.entries) {
      const ids = new Set(next.entries.map((entry) => entry.id));
      for (const id of buffers.current.keys()) if (!ids.has(id)) buffers.current.delete(id);
      setModified((current) => new Set([...current].filter((id) => ids.has(id))));
    }
    currentProject.current = next;
    setProject(next);
    saver.current?.schedule();
  }

  return {
    project, currentProject, modified, contentVersion, readContent, markFile, updateProject, loading, storageIssue,
    saveNow: () => saver.current?.protect(),
  };
}
