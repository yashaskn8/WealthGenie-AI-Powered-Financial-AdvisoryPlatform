"""Thread-safe LLM provider circuit breaker with a single half-open probe."""

import logging
import threading
import time
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional

logger = logging.getLogger("wealthgenie.llm.ops.circuit_breaker")


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass(frozen=True)
class CircuitPermit:
    """Opaque admission token used to fence stale call completions."""

    generation: int
    half_open_probe: bool
    nonce: object


class CircuitBreaker:
    """
    Provider-health state machine.

    CLOSED admits normal calls. OPEN rejects calls until the recovery window
    elapses. HALF_OPEN atomically admits one probe; the probe outcome is passed
    back with its permit so older in-flight calls cannot overwrite newer state.
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout_seconds: float = 30.0,
        name: str = "llm_circuit_breaker",
        clock: Callable[[], float] = time.monotonic,
    ):
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be positive")
        if recovery_timeout_seconds < 0:
            raise ValueError("recovery_timeout_seconds cannot be negative")
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout_seconds = recovery_timeout_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: Optional[float] = None
        self._success_count = 0
        self._generation = 0
        self._probe_in_flight = False
        self._active_permits: dict[object, tuple[int, bool]] = {}

    def _refresh_state_locked(self) -> None:
        if (self._state == CircuitState.OPEN
                and self._last_failure_time is not None
                and self._clock() - self._last_failure_time >= self.recovery_timeout_seconds):
            self._state = CircuitState.HALF_OPEN
            self._probe_in_flight = False
            logger.info("[%s] Recovery window elapsed; circuit entered HALF_OPEN.", self.name)

    @property
    def state(self) -> CircuitState:
        with self._lock:
            self._refresh_state_locked()
            return self._state

    def acquire_permit(self) -> Optional[CircuitPermit]:
        """Atomically admit a request and return its completion-fencing token."""
        with self._lock:
            self._refresh_state_locked()
            if self._state == CircuitState.OPEN:
                return None
            is_probe = self._state == CircuitState.HALF_OPEN
            if is_probe and self._probe_in_flight:
                return None
            if is_probe:
                self._probe_in_flight = True
            permit = CircuitPermit(self._generation, is_probe, object())
            self._active_permits[permit.nonce] = (permit.generation, permit.half_open_probe)
            return permit

    def allow_request(self) -> bool:
        """Legacy readiness check; HALF_OPEN callers must use acquire_permit()."""
        with self._lock:
            self._refresh_state_locked()
            return self._state == CircuitState.CLOSED

    def _consume_permit_locked(self, permit: Optional[CircuitPermit]):
        if permit is None:
            return None
        details = self._active_permits.pop(permit.nonce, None)
        if details is None or details[0] != self._generation:
            return None
        return details

    def record_success(self, permit: CircuitPermit) -> None:
        """Record a successful provider call; stale permits are ignored."""
        with self._lock:
            details = self._consume_permit_locked(permit)
            if details is None:
                return
            is_probe = details[1]
            self._success_count += 1
            self._failure_count = 0
            self._last_failure_time = None
            if is_probe:
                self._state = CircuitState.CLOSED
                self._probe_in_flight = False
                self._generation += 1
                logger.info("[%s] Half-open probe succeeded; circuit closed.", self.name)
            elif self._state == CircuitState.CLOSED:
                self._probe_in_flight = False

    def record_failure(self, permit: CircuitPermit) -> None:
        """Record provider-health failure; half-open probe failure reopens now."""
        with self._lock:
            details = self._consume_permit_locked(permit)
            if details is None:
                return
            is_probe = details[1]
            self._failure_count += 1
            self._last_failure_time = self._clock()
            if is_probe or (self._state == CircuitState.CLOSED and self._failure_count >= self.failure_threshold):
                self._state = CircuitState.OPEN
                self._probe_in_flight = False
                self._generation += 1
                logger.warning(
                    "[%s] Provider-health threshold reached; circuit opened for %.3fs.",
                    self.name,
                    self.recovery_timeout_seconds,
                )

    def record_neutral_outcome(self, permit: CircuitPermit) -> None:
        """A completed non-health outcome proves connectivity and releases probe."""
        with self._lock:
            details = self._consume_permit_locked(permit)
            if details is None:
                return
            self._failure_count = 0
            self._last_failure_time = None
            if details[1]:
                self._state = CircuitState.CLOSED
                self._probe_in_flight = False
                self._generation += 1

    def cancel_permit(self, permit: CircuitPermit) -> None:
        """Cancellation releases a half-open slot without counting a failure."""
        with self._lock:
            details = self._consume_permit_locked(permit)
            if details and details[1] and self._state == CircuitState.HALF_OPEN:
                self._probe_in_flight = False

    def reset(self) -> None:
        with self._lock:
            self._state = CircuitState.CLOSED
            self._failure_count = 0
            self._last_failure_time = None
            self._probe_in_flight = False
            self._generation += 1
            self._active_permits.clear()
        logger.info("[%s] Manually reset to CLOSED.", self.name)

    def get_status(self) -> dict:
        with self._lock:
            self._refresh_state_locked()
            return {
                "name": self.name,
                "state": self._state.value,
                "failure_count": self._failure_count,
                "failure_threshold": self.failure_threshold,
                "success_count": self._success_count,
                "recovery_timeout_seconds": self.recovery_timeout_seconds,
                "half_open_probe_in_flight": self._probe_in_flight,
            }
