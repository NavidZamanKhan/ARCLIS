import { useEffect, useMemo, useReducer } from 'react';

import { createExecutionClient } from './protocol.js';

const statusLabels = {
  READY: 'Ready',
  CONNECTING: 'Connecting',
  QUEUED: 'Queued',
  PREPARING: 'Preparing',
  COMPILING: 'Compiling',
  RUNNING: 'Running',
  CANCELLING: 'Stopping',
  COMPLETED: 'Completed',
  COMPILATION_FAILED: 'Build failed',
  RUNTIME_FAILED: 'Runtime error',
  TIMEOUT: 'Timed out',
  RESOURCE_LIMIT_EXCEEDED: 'Resource limit',
  CANCELLED: 'Stopped',
  INTERNAL_ERROR: 'Worker error',
  CONNECTION_ERROR: 'Unable to run',
};

const activeStates = new Set(['CONNECTING', 'QUEUED', 'PREPARING', 'COMPILING', 'RUNNING', 'CANCELLING']);
const failureStates = new Set([
  'COMPILATION_FAILED', 'RUNTIME_FAILED', 'TIMEOUT', 'RESOURCE_LIMIT_EXCEEDED', 'INTERNAL_ERROR', 'CONNECTION_ERROR',
]);
const initial = {
  state: 'READY',
  build: '',
  target: null,
  frames: [],
  log: '',
  result: null,
  error: '',
  inputClosed: false,
  sequence: 0,
};

function update(run, event) {
  switch (event.type) {
    case 'start':
      return { ...initial, state: 'CONNECTING', target: event.target, sequence: run.sequence + 1 };
    case 'status': {
      const build = { COMPILING: 'Compiling', RUNNING: 'Succeeded' }[event.state] ?? run.build;
      return { ...run, state: event.state, build };
    }
    case 'result': {
      const build = event.state === 'COMPILATION_FAILED' ? 'Failed' : run.build === 'Compiling' ? 'Interrupted' : run.build;
      return { ...run, state: event.state, build, result: event, error: event.message };
    }
    case 'stopped':
      return { ...run, state: 'CANCELLED', error: 'Stopped before the execution socket opened.' };
    case 'connection-error':
      return {
        ...run, state: 'CONNECTION_ERROR', error: event.message,
        build: run.build === 'Compiling' ? 'Interrupted' : run.build,
      };
    case 'error':
      return { ...run, error: event.message, inputClosed: event.code === 'stdin_rejected' ? false : run.inputClosed };
    case 'input-closed':
      return { ...run, inputClosed: true };
    case 'diagnostics':
      return { ...run, frames: [...run.frames, event], log: run.log + event.data };
    case 'stdout':
    case 'stderr':
      return { ...run, frames: [...run.frames, event] };
    case 'clear':
      return { ...run, frames: [] };
    default:
      return run;
  }
}

export function useExecution() {
  const [run, dispatch] = useReducer(update, initial);
  const client = useMemo(() => createExecutionClient(dispatch), []);
  useEffect(() => () => client.dispose(), [client]);

  return {
    run,
    label: statusLabels[run.state],
    active: activeStates.has(run.state),
    failed: failureStates.has(run.state),
    start: client.start,
    stop: client.stop,
    input: client.input,
    endInput: client.endInput,
    clear: () => dispatch({ type: 'clear' }),
    reject(target, message) {
      dispatch({ type: 'start', target });
      dispatch({ type: 'connection-error', message });
    },
  };
}
