import { useEffect, useRef, useState } from 'react';

const endpoint = 'http://127.0.0.1:8000/api/v1/analysis/';
const sourceLimit = 64 * 1024;
const encoder = new TextEncoder();

const errors = {
  403: 'This frontend origin is not allowed by the analyzer.',
  404: 'Local C analysis is disabled. Start the loopback backend with analysis enabled.',
  413: 'The analysis request exceeds the server limit.',
  429: 'The analyzer is busy. Try again shortly.',
  503: 'The analyzer is unavailable. Check the local Docker image and worker.',
};

async function requestAnalysis(source, signal) {
  if (encoder.encode(source).length > sourceLimit) {
    throw new Error('C analysis accepts up to 64 KiB of UTF-8 source.');
  }
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
      credentials: 'omit',
      signal,
    });
  } catch {
    throw new Error('Could not reach the loopback backend.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 422 && typeof data?.error?.details?.detail === 'string') {
      throw new Error(data.error.details.detail);
    }
    throw new Error(errors[response.status] ?? 'The local server could not analyze the source.');
  }
  if (typeof data?.syntax_valid !== 'boolean' || ![true, false, null].includes(data.semantic_valid)
    || !['tokens', 'diagnostics', 'symbols', 'scopes'].every((field) => Array.isArray(data[field]))
    || (data.ast !== null && data.ast?.kind !== 'Program')
    || (data.ir !== null && (!Array.isArray(data.ir?.initializers) || !Array.isArray(data.ir?.instructions)))) {
    throw new Error('The local server returned an invalid analysis report.');
  }
  return data;
}

export function useAnalysis() {
  const pending = useRef(null);
  const [state, setState] = useState(null);

  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  async function start(file, content) {
    if (pending.current) return;
    const snapshot = { id: file.id, path: file.path, content };
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setState({ snapshot, status: 'running' });
    try {
      const report = await requestAnalysis(content, controller.signal);
      if (pending.current === controller) setState({ snapshot, status: 'complete', report });
    } catch (error) {
      if (pending.current === controller) {
        setState({ snapshot, status: 'error', message: controller.signal.aborted ? 'The analysis request timed out.' : error.message });
      }
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) pending.current = null;
    }
  }

  return { state, start };
}
