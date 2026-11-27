import { samples, sourceText } from '../preview/samples.js';
import { sumTemplates } from './sumTemplates.js';

const maxFiles = 50;
const maxSourceBytes = 1024 * 1024;
const pathSegment = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const javaIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const fileModes = {
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp',
  java: 'java', py: 'python',
};
export const sourceFilenames = { c: 'main.c', cpp: 'main.cpp', java: 'Main.java', python: 'main.py' };
const sampleSymbols = {
  c: ['sum_to', 'main'], cpp: ['sum_to', 'main'], java: ['Main', 'sumTo', 'main'], python: ['sum_to'],
};

export const languages = { c: 'C', cpp: 'C++', java: 'Java', python: 'Python' };
export const templates = Object.entries(sourceFilenames).flatMap(([language, name]) => [
  { id: language, language, name, label: languages[language] },
  { id: language + '-sum', language, name, label: languages[language] + ' · Two-number sum' },
]);

export class ProjectFileError extends Error {}

export function basename(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function parentPath(path) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

export function joinPath(parent, name) {
  if (!pathSegment.test(name) || name.endsWith('.')) {
    throw new ProjectFileError('Use letters, numbers, underscores, dots, or hyphens in the name. Start with a letter, number, or underscore.');
  }
  return parent ? parent + '/' + name : name;
}

export function extension(path) {
  return basename(path).split('.').slice(1).at(-1) ?? '';
}

export function fileMode(path) {
  const suffix = extension(path).toLowerCase();
  return Object.hasOwn(fileModes, suffix) ? fileModes[suffix] : undefined;
}

export function executionTarget(file) {
  if (!file || file.kind !== 'file') return null;
  const suffix = extension(file.path);
  const language = fileMode(file.path);
  if (suffix === 'java') {
    const parts = file.path.slice(0, -5).split('/');
    return parts.every((part) => javaIdentifier.test(part))
      ? { language, entry_file: file.path, main_class: parts.join('.') }
      : null;
  }
  return ['c', 'cc', 'cpp', 'cxx', 'py'].includes(suffix) ? { language, entry_file: file.path } : null;
}

export function projectEntry(project) {
  const selected = project.entries.find((entry) => entry.id === project.targetId);
  if (executionTarget(selected)) return selected;
  const candidates = project.entries.filter(executionTarget);
  return candidates.length === 1 ? candidates[0] : null;
}

export function templateContent(path, template) {
  if (!template) return '';
  const selected = templates.find(({ id }) => id === template);
  const target = executionTarget({ kind: 'file', path });
  if (!selected || target?.language !== selected.language) {
    throw new ProjectFileError('Choose a source filename and folder path that match the template language.');
  }
  const source = template.endsWith('-sum') ? sumTemplates[selected.language] : sourceText(samples[selected.language].lines);
  if (selected.language === 'java') {
    const packageName = target.main_class.split('.').slice(0, -1).join('.');
    const header = packageName ? 'package ' + packageName + ';\n\n' : '';
    return header + source.replace('class Main {', 'class ' + basename(path).slice(0, -5) + ' {');
  }
  return source;
}

function validateEntries(entries) {
  const paths = new Set();
  const folders = new Set(entries.filter(({ kind }) => kind === 'folder').map(({ path }) => path));
  let fileCount = 0;
  for (const { path, kind } of entries) {
    if (path.length > 240 || path.split('/').some((part) => !pathSegment.test(part) || part.endsWith('.'))) {
      throw new ProjectFileError('Use a relative path of up to 240 characters with valid names.');
    }
    if (paths.has(path)) throw new ProjectFileError('A file or folder with this name already exists.');
    if (parentPath(path) && !folders.has(parentPath(path))) {
      throw new ProjectFileError('The destination folder no longer exists.');
    }
    if (kind === 'file') {
      if (!fileMode(path)) throw new ProjectFileError('Use a C, C++, Java, Python, or supported header extension.');
      if (++fileCount > maxFiles) throw new ProjectFileError('A workspace can contain up to 50 source files.');
    }
    paths.add(path);
  }
}

export function createProject(firstId = 1, { empty = false } = {}) {
  if (empty) return { entries: [], nextId: firstId, tabs: [], activeId: null, targetId: null };
  const entries = Object.entries(samples).map(([language, sample], index) => ({
    id: firstId + index, kind: 'file', path: sample.filename, content: sourceText(sample.lines), symbols: sampleSymbols[language],
  }));
  return { entries, nextId: firstId + entries.length, tabs: [firstId], activeId: firstId, targetId: firstId };
}

export function restoreProject(saved) {
  if (!Array.isArray(saved?.entries) || !Array.isArray(saved.tabs)) {
    throw new ProjectFileError('The saved workspace has an invalid format.');
  }
  const ids = new Set();
  const files = new Map();
  const entries = saved.entries.map(({ id, kind, path, content, symbols, sumTemplate } = {}) => {
    if (!Number.isSafeInteger(id) || id < 1 || id > Number.MAX_SAFE_INTEGER - 100 || ids.has(id)
      || typeof path !== 'string' || (kind !== 'file' && kind !== 'folder')
      || (kind === 'file' && typeof content !== 'string')) {
      throw new ProjectFileError('The saved workspace has invalid file metadata.');
    }
    ids.add(id);
    if (kind === 'folder') return { id, kind, path };
    const entry = { id, kind, path, content };
    const target = executionTarget(entry);
    if (sumTemplate === true || (target && content === templateContent(path, target.language + '-sum'))) {
      entry.sumTemplate = true;
    }
    if (Array.isArray(symbols) && symbols.every((symbol) => typeof symbol === 'string')) entry.symbols = symbols;
    files.set(id, entry);
    return entry;
  });
  validateEntries(entries);
  const tabs = [...new Set(saved.tabs.filter((id) => files.has(id)))];
  const nextAvailable = entries.reduce((next, entry) => Math.max(next, entry.id + 1), 1);
  const nextId = Number.isSafeInteger(saved.nextId) && saved.nextId <= Number.MAX_SAFE_INTEGER - 100
    ? Math.max(nextAvailable, saved.nextId) : nextAvailable;
  const activeId = tabs.includes(saved.activeId) ? saved.activeId : tabs[0] ?? null;
  const targetId = executionTarget(files.get(saved.targetId)) ? saved.targetId : null;
  return { entries, nextId, tabs, activeId, targetId };
}

export function openFile(project, id) {
  if (!project.entries.some((entry) => entry.id === id && entry.kind === 'file')) return project;
  const tabs = project.tabs.includes(id) ? project.tabs : [...project.tabs, id];
  return { ...project, tabs, activeId: id };
}

export function closeTab(project, id) {
  const position = project.tabs.indexOf(id);
  if (position < 0) return project;
  const tabs = project.tabs.filter((tab) => tab !== id);
  const activeId = id === project.activeId ? tabs[position] ?? tabs[position - 1] ?? null : project.activeId;
  return { ...project, tabs, activeId };
}

export function addEntries(project, additions) {
  if (!additions.length) return project;
  const added = additions.map((entry, index) => ({ ...entry, id: project.nextId + index }));
  const entries = [...project.entries, ...added];
  validateEntries(entries);
  const next = { ...project, entries, nextId: project.nextId + added.length };
  const file = added.find(({ kind }) => kind === 'file');
  return file ? openFile(next, file.id) : next;
}

function isIn(path, ancestor) {
  return path === ancestor || path.startsWith(ancestor + '/');
}

export function renameEntry(project, id, name) {
  const item = project.entries.find((entry) => entry.id === id);
  if (!item) throw new ProjectFileError('This item no longer exists.');
  const destination = joinPath(parentPath(item.path), name);
  const entries = project.entries.map((entry) => isIn(entry.path, item.path)
    ? { ...entry, path: destination + entry.path.slice(item.path.length) }
    : entry);
  validateEntries(entries);
  const targetId = executionTarget(entries.find((entry) => entry.id === project.targetId)) ? project.targetId : null;
  return { ...project, entries, targetId };
}

export function deleteEntry(project, id) {
  const item = project.entries.find((entry) => entry.id === id);
  if (!item) return project;
  const removed = new Set(project.entries.filter(({ path }) => isIn(path, item.path)).map((entry) => entry.id));
  const entries = project.entries.filter((entry) => !removed.has(entry.id));
  const tabs = project.tabs.filter((tab) => !removed.has(tab));
  const firstFollowingTab = project.tabs.slice(project.tabs.indexOf(project.activeId) + 1).find((tab) => !removed.has(tab));
  const activeId = removed.has(project.activeId) ? firstFollowingTab ?? tabs.at(-1) ?? null : project.activeId;
  const targetId = removed.has(project.targetId) ? null : project.targetId;
  return { ...project, tabs, activeId, entries, targetId };
}

export async function readUploads(files, folder) {
  if (files.length > maxFiles) throw new ProjectFileError('Upload up to 50 source files at a time.');
  if (files.reduce((sum, file) => sum + file.size, 0) > maxSourceBytes) {
    throw new ProjectFileError('Upload up to 1 MiB of source text at a time.');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return Promise.all(files.map(async (file) => {
    const path = joinPath(folder, file.name);
    if (!fileMode(path)) throw new ProjectFileError('Unsupported source file: ' + file.name);
    try {
      return { kind: 'file', path, content: decoder.decode(await file.arrayBuffer()) };
    } catch {
      throw new ProjectFileError('Could not read ' + file.name + ' as UTF-8 source text.');
    }
  }));
}
