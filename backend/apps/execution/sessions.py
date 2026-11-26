from dataclasses import dataclass
from secrets import compare_digest, token_urlsafe
from threading import Lock, Timer
from time import monotonic

from .worker import CompiledJob

SESSION_TTL_SECONDS = 30
MAX_PENDING_SESSIONS = 8
MAX_RUNNING_SESSIONS = 2
SUBPROTOCOL = "arclis.v1"


class SessionCapacityError(RuntimeError):
    """The local execution server is at capacity."""


@dataclass(frozen=True)
class PendingSession:
    id: str
    owner_token: str
    job: CompiledJob
    stdin: bytes
    expires_at: float


class SessionRegistry:
    def __init__(self, *, ttl=SESSION_TTL_SECONDS, pending=MAX_PENDING_SESSIONS,
                 running=MAX_RUNNING_SESSIONS):
        self.ttl = ttl
        self._pending_limit = pending
        self._running_limit = running
        self._pending = {}
        self._running = set()
        self._lock = Lock()

    def create(self, job, stdin):
        with self._lock:
            if len(self._pending) >= self._pending_limit:
                raise SessionCapacityError("Too many execution sessions are waiting to connect.")
            session = PendingSession(
                token_urlsafe(18), token_urlsafe(32), job, stdin, monotonic() + self.ttl,
            )
            timer = Timer(self.ttl, self._expire, args=(session.id,))
            timer.daemon = True
            self._pending[session.id] = (session, timer)
            timer.start()
            return session

    def _expire(self, session_id):
        with self._lock:
            self._pending.pop(session_id, None)

    def claim(self, session_id, token):
        with self._lock:
            pending = self._pending.get(session_id)
            if pending is None:
                return None
            session, timer = pending
            if session.expires_at <= monotonic():
                del self._pending[session_id]
                timer.cancel()
                return None
            if not token.isascii() or not compare_digest(session.owner_token, token):
                return None
            if len(self._running) >= self._running_limit:
                raise SessionCapacityError("All local execution slots are occupied.")
            del self._pending[session_id]
            timer.cancel()
            self._running.add(session_id)
            return session

    def finish(self, session_id):
        with self._lock:
            self._running.discard(session_id)


sessions = SessionRegistry()
