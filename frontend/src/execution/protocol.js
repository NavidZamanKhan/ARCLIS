import { backendUrl } from '../backend.js';

const subprotocol = 'arclis.v1';
const encoder = new TextEncoder();

const activeStates = new Set(['QUEUED', 'PREPARING', 'COMPILING', 'RUNNING', 'CANCELLING']);
const outcomes = new Set([
  'COMPLETED', 'COMPILATION_FAILED', 'RUNTIME_FAILED', 'TIMEOUT',
  'RESOURCE_LIMIT_EXCEEDED', 'CANCELLED', 'INTERNAL_ERROR',
]);
const streams = new Set(['stdout', 'stderr', 'diagnostics']);

export function printableOutput(text) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (character) => {
    const code = character.charCodeAt(0);
    if (code === 13) return '';
    return code < 32 ? String.fromCharCode(0x2400 + code) : '\uFFFD';
  });
}

function parsePacket(raw) {
  if (typeof raw !== 'string' || raw.length > 32 * 1024) throw new Error();
  const packet = JSON.parse(raw);
  if (!packet || typeof packet !== 'object') throw new Error();
  switch (packet.type) {
    case 'status':
      if (activeStates.has(packet.state)) return { type: 'status', state: packet.state };
      break;
    case 'result':
      if (outcomes.has(packet.state) && (packet.exit_code === null || Number.isInteger(packet.exit_code))
        && Number.isSafeInteger(packet.execution_time_ms) && packet.execution_time_ms >= 0) {
        return {
          type: 'result', state: packet.state, exit_code: packet.exit_code,
          execution_time_ms: packet.execution_time_ms,
          message: typeof packet.message === 'string' ? packet.message.slice(0, 512) : '',
          ...(packet.state === 'INTERNAL_ERROR' && packet.code === 'worker_unavailable' && { code: packet.code }),
        };
      }
      break;
    case 'error':
      if (typeof packet.message === 'string') {
        return { type: 'error', code: packet.code, message: packet.message.slice(0, 512), request_id: packet.request_id };
      }
      break;
    case 'input_ack':
      if (Number.isSafeInteger(packet.request_id) && packet.request_id > 0) {
        return { type: 'input_ack', request_id: packet.request_id };
      }
      break;
    default:
      if (streams.has(packet.type) && typeof packet.data === 'string') {
        return { type: packet.type, data: printableOutput(packet.data) };
      }
  }
  throw new Error();
}

function address(session) {
  if (typeof session?.id !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(session.id)
    || typeof session.owner_token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(session.owner_token)
    || session.websocket_path !== '/ws/executions/' + session.id + '/') {
    throw new Error('The local server returned an invalid session.');
  }
  const url = backendUrl(session.websocket_path);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

async function requestError(response) {
  if (response.status === 404) return 'Local execution is disabled. Start the loopback backend with execution enabled.';
  if (response.status === 403) return 'This frontend origin is not allowed by the local backend.';
  if (response.status === 429) return 'The local backend is at capacity. Try again shortly.';
  if (response.status === 413) return 'The execution request exceeds the server limit.';
  if (response.status !== 400) return 'The local server could not start the execution.';
  const { error } = await response.json().catch(() => ({})) ?? {};
  const details = error?.details;
  const message = details && !Array.isArray(details)
    ? Object.values(details).flat().find((detail) => typeof detail === 'string')
    : undefined;
  return message?.slice(0, 512) || 'The local server rejected the execution request.';
}

export function createExecutionClient(onEvent, { request = globalThis.fetch, Socket = globalThis.WebSocket } = {}) {
  let active = null;

  function release(attempt) {
    active = null;
    clearTimeout(attempt.timer);
    settleInput(attempt, 'The run ended before input acceptance was confirmed.');
    attempt.abort.abort();
    const socket = attempt.socket;
    if (socket && socket.readyState < 2) socket.close();
  }

  function finish(attempt, event) {
    if (attempt !== active) return;
    release(attempt);
    onEvent(event);
  }

  function failure(attempt, message) {
    finish(attempt, { type: 'connection-error', message });
  }

  function deadline(attempt, milliseconds, message) {
    clearTimeout(attempt.timer);
    attempt.timer = setTimeout(() => failure(attempt, message), milliseconds);
  }

  function send(attempt, packet) {
    if (attempt.socket?.readyState !== 1 || attempt.socket.bufferedAmount > 64 * 1024) return false;
    try {
      attempt.socket.send(JSON.stringify(packet));
      return true;
    } catch {
      failure(attempt, 'The local execution connection was lost.');
      return false;
    }
  }

  function settleInput(attempt, message) {
    const pending = attempt.pendingInput;
    if (!pending) return;
    attempt.pendingInput = null;
    clearTimeout(pending.timer);
    if (!message && pending.packet.type === 'eof') {
      attempt.inputClosed = true;
      onEvent({ type: 'input-closed' });
    } else if (!message) {
      onEvent({ type: 'input-accepted', data: printableOutput(pending.packet.data) });
    }
    pending.resolve(message);
  }

  async function submitInput(packet) {
    if (!active?.running || active.stopping || active.inputClosed) return 'Standard input is unavailable.';
    const attempt = active;
    if (attempt.pendingInput) return 'Waiting for the previous input to be accepted.';
    const message = { ...packet, request_id: ++attempt.inputSequence };
    return new Promise((resolve) => {
      const timer = setTimeout(() => failure(attempt, 'The server did not confirm input acceptance.'), 5000);
      attempt.pendingInput = { packet: message, resolve, timer };
      if (!send(attempt, message)) settleInput(attempt, 'The input could not be sent.');
    });
  }

  function endInput() {
    return submitInput({ type: 'eof' });
  }

  async function start(payload, testCase = null) {
    if (active) return;
    const attempt = {
      abort: new AbortController(), running: false, inputClosed: false, stopping: false, inputSequence: 0,
    };
    active = attempt;
    onEvent({ type: 'start', target: { language: payload.language, entry_file: payload.entry_file }, ...(testCase && { testCase }) });
    deadline(attempt, 15000, 'Timed out connecting to the local execution server.');
    const body = JSON.stringify(payload);
    if (encoder.encode(body).length > 2 * 1024 * 1024) {
      failure(attempt, 'The execution request exceeds the 2 MiB JSON limit.');
      return;
    }
    try {
      const response = await request(backendUrl('/api/v1/executions/').href, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: attempt.abort.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      });
      if (active !== attempt) return;
      if (response.status !== 201) {
        failure(attempt, await requestError(response));
        return;
      }
      const session = await response.json();
      if (active !== attempt) return;
      let url;
      try {
        url = address(session);
      } catch (error) {
        failure(attempt, error.message);
        return;
      }
      const socket = new Socket(url, [subprotocol, 'owner.' + session.owner_token]);
      attempt.socket = socket;
      socket.addEventListener('open', () => {
        if (active !== attempt) return;
        if (socket.protocol !== subprotocol) {
          failure(attempt, 'The local execution connection negotiated an unexpected protocol.');
          return;
        }
        deadline(attempt, 150000, 'The local execution connection timed out.');
      });
      socket.addEventListener('message', ({ data }) => {
        if (active !== attempt) return;
        let packet;
        try {
          packet = parsePacket(data);
        } catch {
          failure(attempt, 'The local server sent an invalid execution message.');
          return;
        }
        if (packet.type === 'result') {
          finish(attempt, packet);
          return;
        }
        if (packet.type === 'status') {
          if (attempt.stopping && packet.state !== 'CANCELLING') return;
          attempt.running = packet.state === 'RUNNING';
        }
        if (packet.type === 'input_ack' || (packet.type === 'error' && packet.request_id !== undefined)) {
          if (attempt.pendingInput && packet.request_id === attempt.pendingInput.packet.request_id) {
            settleInput(attempt, packet.type === 'error' ? packet.message : '');
          }
          return;
        }
        onEvent(packet);
        if (testCase && packet.type === 'status' && packet.state === 'RUNNING'
          && !attempt.inputClosed && !attempt.pendingInput) {
          void endInput().then((problem) => { if (problem) failure(attempt, problem); });
        }
      });
      socket.addEventListener('error', () => failure(attempt, 'Could not connect to the local execution socket.'));
      socket.addEventListener('close', () => failure(attempt, 'The local execution connection closed before a result arrived.'));
    } catch {
      failure(attempt, 'Could not reach the local execution server on port 8000.');
    }
  }

  return {
    start,
    stop() {
      const attempt = active;
      if (!attempt || attempt.stopping) return;
      if (attempt.socket?.readyState !== 1) {
        finish(attempt, { type: 'stopped' });
        return;
      }
      if (!send(attempt, { type: 'cancel' })) {
        failure(attempt, 'Could not confirm cancellation. The local execution socket was closed.');
        return;
      }
      attempt.stopping = true;
      onEvent({ type: 'status', state: 'CANCELLING' });
      deadline(attempt, 10000, 'The server did not confirm cancellation. The local execution socket was closed.');
    },
    async input(line) {
      const data = line + '\n';
      if (encoder.encode(data).length > 4096) return 'Each input line is limited to 4096 UTF-8 bytes including the newline.';
      return submitInput({ type: 'stdin', data });
    },
    endInput,
    dispose() {
      if (active) release(active);
    },
  };
}
