import { executionTarget, extension, parentPath } from '../workspace/projectFiles.js';

const nativeHeaders = { c: ['h'], cpp: ['h', 'hh', 'hpp', 'hxx'] };
const nativeSources = { c: ['c'], cpp: ['cc', 'cpp', 'cxx'] };
const encoder = new TextEncoder();

export function makeExecutionPayload(entries, targetId, getContent) {
  const selected = entries.find((item) => item.id === targetId);
  const target = executionTarget(selected);
  if (!target) throw new Error('Choose a runnable project entry file.');
  const { language, entry_file } = target;
  const directory = parentPath(entry_file);
  const files = [];
  let size = 0;
  for (const file of entries) {
    if (file.kind !== 'file') continue;
    const suffix = extension(file.path);
    const compatible = nativeSources[language]
      ? nativeHeaders[language].includes(suffix) || (
        nativeSources[language].includes(suffix) && parentPath(file.path) === directory
      )
      : suffix === (language === 'java' ? 'java' : 'py');
    if (!compatible) continue;
    const content = getContent(file) ?? file.content;
    if (content.length > 1024 * 1024 - size) throw new Error('Execution is limited to 1 MiB of source.');
    size += encoder.encode(content).length;
    if (size > 1024 * 1024) throw new Error('Execution is limited to 1 MiB of source.');
    files.push({ path: file.path, content });
  }
  return { ...target, files, interactive: true };
}
