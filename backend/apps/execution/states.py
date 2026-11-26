from enum import StrEnum


class ExecutionState(StrEnum):
    CREATED = "CREATED"
    QUEUED = "QUEUED"
    PREPARING = "PREPARING"
    COMPILING = "COMPILING"
    RUNNING = "RUNNING"
    CANCELLING = "CANCELLING"
    COMPLETED = "COMPLETED"
    COMPILATION_FAILED = "COMPILATION_FAILED"
    RUNTIME_FAILED = "RUNTIME_FAILED"
    TIMEOUT = "TIMEOUT"
    RESOURCE_LIMIT_EXCEEDED = "RESOURCE_LIMIT_EXCEEDED"
    CANCELLED = "CANCELLED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


_ACTIVE_FAILURES = {
    ExecutionState.TIMEOUT,
    ExecutionState.RESOURCE_LIMIT_EXCEEDED,
    ExecutionState.INTERNAL_ERROR,
}
_TRANSITIONS = {
    ExecutionState.CREATED: {ExecutionState.QUEUED, ExecutionState.PREPARING},
    ExecutionState.QUEUED: {
        ExecutionState.PREPARING,
        ExecutionState.CANCELLING,
        ExecutionState.INTERNAL_ERROR,
    },
    ExecutionState.PREPARING: {
        ExecutionState.COMPILING,
        ExecutionState.RUNNING,
        ExecutionState.CANCELLING,
        *_ACTIVE_FAILURES,
    },
    ExecutionState.COMPILING: {
        ExecutionState.RUNNING,
        ExecutionState.COMPILATION_FAILED,
        ExecutionState.CANCELLING,
        *_ACTIVE_FAILURES,
    },
    ExecutionState.RUNNING: {
        ExecutionState.COMPLETED,
        ExecutionState.RUNTIME_FAILED,
        ExecutionState.CANCELLING,
        *_ACTIVE_FAILURES,
    },
    ExecutionState.CANCELLING: {
        ExecutionState.CANCELLED,
        ExecutionState.INTERNAL_ERROR,
    },
}


class ExecutionSession:
    """State history for one job, owned by a single worker."""

    def __init__(self):
        self._history = [ExecutionState.CREATED]

    @property
    def history(self):
        return tuple(self._history)

    def transition(self, state: ExecutionState):
        current = self._history[-1]
        if not isinstance(state, ExecutionState) or state not in _TRANSITIONS.get(current, ()):
            raise ValueError(f"Invalid execution transition from {current} to {state}.")
        self._history.append(state)
