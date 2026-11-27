import { restoreProject } from './projectFiles.js';

const databaseName = 'arclis';
const storeName = 'workspace';
const version = 1;
export const projectStorage = {
  recordKey: 'current', draftKey: 'arclis.workspace-draft', restore: restoreProject,
};
export const saveUnavailable = 'Workspace saving is unavailable. Changes are held in this tab.';
export const saveConflict = 'Another tab saved this workspace. Copy your source before reloading.';

export function openWorkspaceStorage(recordKey = projectStorage.recordKey) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, version);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Workspace storage is blocked.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve({
        read() {
          return new Promise((finish, fail) => {
            const tx = database.transaction(storeName);
            const get = tx.objectStore(storeName).get(recordKey);
            tx.oncomplete = () => finish(get.result);
            tx.onabort = () => fail(tx.error);
          });
        },
        write(record, expectedRevision) {
          return new Promise((finish, fail) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const get = store.get(recordKey);
            let accepted = false;
            get.onsuccess = () => {
              if ((get.result?.revision ?? null) !== expectedRevision) return;
              store.put(record, recordKey);
              accepted = true;
            };
            tx.oncomplete = () => finish(accepted);
            tx.onabort = () => fail(tx.error);
          });
        },
        close() { database.close(); },
      });
    };
  });
}

export function readWorkspaceDraft({ draftKey, restore } = projectStorage) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey));
    if (draft?.version !== version) return null;
    return { ...draft, project: restore(draft.project) };
  } catch {
    return null;
  }
}

export function decodeWorkspaceRecord(record, restore = restoreProject) {
  if (!record) return { project: null, revision: null };
  if (record.version !== version || typeof record.revision !== 'string') throw new Error('Invalid workspace record.');
  return { project: restore(record.project), revision: record.revision };
}

export function createWorkspaceSaver(storage, baseRevision, snapshot, onIssue, conflict = false, draftKey = projectStorage.draftKey) {
  let revision = baseRevision;
  let timer;
  let dirty = false;
  let inFlight = null;
  let closing = false;
  let blocked = conflict;

  async function flush() {
    clearTimeout(timer);
    if (!dirty || inFlight || blocked) return;
    dirty = false;
    const record = { version, revision: crypto.randomUUID(), project: snapshot() };
    inFlight = record.revision;
    try {
      if (!await storage.write(record, revision)) {
        blocked = true;
        dirty = true;
        onIssue(saveConflict);
      } else {
        revision = record.revision;
        if (!dirty) {
          try { sessionStorage.removeItem(draftKey); } catch { /* IndexedDB already saved the workspace. */ }
        }
      }
    } catch {
      blocked = true;
      dirty = true;
      onIssue(saveUnavailable);
    } finally {
      inFlight = null;
      if (dirty && !blocked) void flush();
      else if (closing) storage.close();
    }
  }

  function protect() {
    if (!dirty && !inFlight) return;
    try {
      // A reload can exit before the asynchronous IndexedDB transaction completes.
      sessionStorage.setItem(draftKey, JSON.stringify({
        version, revision, inFlight, project: snapshot(),
      }));
    } catch {
      // Flush to IndexedDB even when session storage is full or unavailable.
    }
    void flush();
  }

  return {
    schedule() {
      dirty = true;
      clearTimeout(timer);
      if (!blocked) timer = setTimeout(flush, 250);
    },
    protect,
    close() {
      closing = true;
      protect();
      if (!inFlight) storage.close();
    },
  };
}
