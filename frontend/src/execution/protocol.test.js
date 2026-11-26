import { afterEach, expect, it, vi } from 'vitest';

import { createExecutionClient } from './protocol.js';

const id = 's'.repeat(24);
const token = 't'.repeat(43);
const session = { id, owner_token: token, websocket_path: '/ws/executions/' + id + '/' };
const payload = { language: 'python', entry_file: 'main.py', files: [{ path: 'main.py', content: 'print(42)' }] };

function setup(request = vi.fn(async () => ({ status: 201, json: async () => session }))) {
  const events = [];
  let socket;
  class Socket extends EventTarget {
    constructor(url, protocols) {
      super();
      socket = this;
      this.url = url;
      this.protocols = protocols;
      this.protocol = 'arclis.v1';
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.send = vi.fn();
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
    message(packet) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(packet) }));
    }
  }
  const client = createExecutionClient((event) => events.push(event), { request, Socket });
  return { client, request, events, get socket() { return socket; } };
}

afterEach(() => vi.useRealTimers());

it('opens a loopback session, streams printable output and uses the token only as a subprotocol', async () => {
  const harness = setup();
  const { client, request, events } = harness;
  await client.start(payload);
  await client.start(payload);
  const { socket } = harness;
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:8000/api/v1/executions/');
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(payload);
  expect(socket.url).toBe('ws://127.0.0.1:8000/ws/executions/' + id + '/');
  expect(socket.protocols).toEqual(['arclis.v1', 'owner.' + token]);
  socket.open();
  socket.message({ type: 'status', state: 'COMPILING' });
  socket.message({ type: 'diagnostics', data: 'warn\r\n' });
  socket.message({ type: 'status', state: 'RUNNING' });
  socket.message({ type: 'stdout', data: '\u001b[31mPrompt: ' });
  socket.message({ type: 'stderr', data: 'error\n' });
  expect(client.input('hello π')).toBe('');
  expect(client.input('é'.repeat(2048))).toContain('4096');
  expect(client.endInput()).toBe('');
  expect(client.input('late')).toBe('Standard input is unavailable.');
  expect(socket.send.mock.calls.map(([sent]) => JSON.parse(sent))).toEqual([
    { type: 'stdin', data: 'hello π\n' }, { type: 'eof' },
  ]);
  socket.message({ type: 'result', state: 'COMPLETED', exit_code: 0, execution_time_ms: 42 });
  expect(events.map(({ type }) => type)).toEqual([
    'start', 'status', 'diagnostics', 'status', 'stdout', 'stderr', 'input-closed', 'result',
  ]);
  expect(events[2].data).toBe('warn\n');
  expect(events[4].data).toBe('␛[31mPrompt: ');
  expect(events.at(-1)).toMatchObject({ state: 'COMPLETED', exit_code: 0, execution_time_ms: 42 });
  expect(socket.readyState).toBe(3);
  expect(JSON.stringify(events)).not.toContain(token);
});

it('sends Stop once and keeps the backend result authoritative', async () => {
  const harness = setup();
  await harness.client.start(payload);
  harness.socket.open();
  harness.client.stop();
  harness.client.stop();
  harness.socket.message({ type: 'status', state: 'RUNNING' });
  expect(harness.events.at(-1).state).toBe('CANCELLING');
  expect(harness.socket.send.mock.calls).toEqual([['{"type":"cancel"}']]);
  harness.socket.message({ type: 'result', state: 'CANCELLED', exit_code: null, execution_time_ms: 108 });
  expect(harness.events.at(-1)).toMatchObject({ type: 'result', state: 'CANCELLED' });
});

it('sends case input in the session request and closes stdin once runtime starts', async () => {
  const harness = setup();
  const testCase = { name: 'Mixed signs', stdin: '-3 5\n', expected: '2\n' };
  await harness.client.start({ ...payload, stdin: testCase.stdin }, testCase);
  expect(JSON.parse(harness.request.mock.calls[0][1].body)).toEqual({ ...payload, stdin: testCase.stdin });
  expect(harness.events[0].testCase).toEqual(testCase);
  harness.socket.open();
  harness.socket.message({ type: 'status', state: 'COMPILING' });
  expect(harness.socket.send).not.toHaveBeenCalled();
  harness.socket.message({ type: 'status', state: 'RUNNING' });
  harness.socket.message({ type: 'status', state: 'RUNNING' });
  expect(harness.socket.send.mock.calls).toEqual([['{"type":"eof"}']]);
  expect(harness.client.input('late')).toBe('Standard input is unavailable.');
  harness.client.dispose();
});

it('aborts a pending request on Stop and ignores its late response', async () => {
  let complete;
  const request = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
  const harness = setup(request);
  const starting = harness.client.start(payload);
  harness.client.stop();
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  complete({ status: 201, json: async () => session });
  await starting;
  expect(harness.socket).toBeUndefined();
  expect(harness.events.map(({ type }) => type)).toEqual(['start', 'stopped']);
});

it('reports a lost connection and rejects a session address outside the expected route', async () => {
  const harness = setup();
  await harness.client.start(payload);
  harness.socket.open();
  harness.socket.close();
  expect(harness.events.at(-1)).toMatchObject({ type: 'connection-error', message: expect.stringContaining('before a result') });
  const invalid = setup(async () => ({
    status: 201, json: async () => ({ ...session, websocket_path: '/other/' }),
  }));
  await invalid.client.start(payload);
  expect(invalid.socket).toBeUndefined();
  expect(invalid.events.at(-1).message).toContain('invalid session');
});

it('times out an unresponsive local socket and permits a new attempt', async () => {
  vi.useFakeTimers();
  const harness = setup();
  await harness.client.start(payload);
  await vi.advanceTimersByTimeAsync(15000);
  expect(harness.events.at(-1).message).toContain('Timed out connecting');
  expect(harness.socket.readyState).toBe(3);
  await harness.client.start(payload);
  expect(harness.events.at(-1).type).toBe('start');
  harness.client.dispose();
});
