from queue import Empty, Full, Queue
from threading import Lock
from time import monotonic

from .states import ExecutionState

MAX_STDIN_BYTES = 64 * 1024
MAX_INPUT_CHUNK = 4096
MAX_EVENT_CHUNK = 4096
MAX_RUNTIME_SECONDS = 120
IDLE_SECONDS = 30
POLL_SECONDS = 0.05
EOF = object()


class InputRejected(ValueError):
    """Input cannot be accepted by this execution session."""


class Interaction:
    def __init__(self, initial=b"", *, idle_seconds=IDLE_SECONDS):
        self.events = Queue(maxsize=64)
        self._input = Queue(maxsize=16)
        self._input_bytes = len(initial)
        self._input_closed = False
        self._idle_seconds = idle_seconds
        self._last_activity = None
        self._stop = None
        self._lock = Lock()
        if initial:
            self._input.put_nowait(initial)

    def send_input(self, data):
        if not data or len(data) > MAX_INPUT_CHUNK:
            raise InputRejected("Each input message must contain 1–4096 UTF-8 bytes.")
        with self._lock:
            if self._input_bytes + len(data) > MAX_STDIN_BYTES:
                raise InputRejected("The session input limit is 64 KiB.")
            self._enqueue(data)
            self._input_bytes += len(data)

    def end_input(self):
        with self._lock:
            self._enqueue(EOF)
            self._input_closed = True

    def _enqueue(self, data):
        if self._input_closed or self._stop is not None:
            raise InputRejected("Standard input is closed.")
        try:
            self._input.put_nowait(data)
        except Full as error:
            raise InputRejected("Input queue is full. Retry after the program reads input.") from error
        if self._last_activity is not None:
            self._last_activity = monotonic()

    def read_input(self):
        try:
            return self._input.get_nowait()
        except Empty:
            return None

    def emit(self, kind, data):
        if self.interruption() is not None:
            return
        try:
            self.events.put((kind, data), timeout=POLL_SECONDS)
        except Full:
            self.stop(ExecutionState.RESOURCE_LIMIT_EXCEEDED)
            return
        with self._lock:
            if self._last_activity is not None:
                self._last_activity = monotonic()

    def begin_runtime(self):
        with self._lock:
            self._last_activity = monotonic()
        self.emit("status", ExecutionState.RUNNING)

    def stop(self, state=ExecutionState.CANCELLED):
        with self._lock:
            if self._stop is not None:
                return False
            self._stop = state
            return True

    def interruption(self):
        with self._lock:
            if (
                self._stop is None
                and self._last_activity is not None
                and monotonic() - self._last_activity >= self._idle_seconds
            ):
                self._stop = ExecutionState.TIMEOUT
            return self._stop
