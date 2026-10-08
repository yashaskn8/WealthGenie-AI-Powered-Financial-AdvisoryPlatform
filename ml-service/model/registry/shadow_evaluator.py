"""
WealthGenie ML Microservice - Shadow / Canary Model Evaluator
Phase 5 MLOps Implementation.

Enables risk-free shadow validation of registered candidate models. The active model
remains authoritative. Candidate evaluations are copied into a bounded queue and run
by one daemon worker; queue saturation drops shadow work without delaying the request.
Only results from the currently configured candidate are retained in the sliding buffer.
"""

import collections
import logging
import queue
import threading
import time
from typing import Any, Dict, Optional

import numpy as np

logger = logging.getLogger("wealthgenie.shadow_evaluator")


class ShadowEvaluator:
    """Thread-safe evaluator tracking active vs shadow candidate predictions."""

    def __init__(self, history_capacity: int = 1000, queue_capacity: int = 64):
        if history_capacity < 1:
            raise ValueError("history_capacity must be positive")
        if queue_capacity < 1:
            raise ValueError("queue_capacity must be positive")
        self.history_capacity = history_capacity
        self.queue_capacity = queue_capacity
        self.shadow_version_id: Optional[str] = None
        self.shadow_architecture: Optional[str] = None
        self.shadow_predictor: Optional[Any] = None
        self._lock = threading.Lock()
        self._generation = 0
        self._queue: queue.Queue = queue.Queue(maxsize=queue_capacity)
        self._in_flight = 0
        self._dropped_evaluations = 0
        self._discarded_evaluations = 0
        self._failed_evaluations = 0
        self._shutdown = False
        self._worker = threading.Thread(
            target=self._run_worker,
            name="wealthgenie-shadow-evaluator",
            daemon=True,
        )
        self._worker.start()

        # Metrics counters
        self.total_evaluations: int = 0
        self.agreement_count: int = 0
        self.disagreement_count: int = 0
        self.history = collections.deque(maxlen=history_capacity)
        self.started_at: Optional[str] = None

    def configure_shadow(self, version_id: str, architecture: str, predictor: Any) -> None:
        """Configures an active shadow candidate model for dual-inference evaluation."""
        with self._lock:
            if self._shutdown:
                raise RuntimeError("Shadow evaluator has been shut down")
            self._generation += 1
            self.shadow_version_id = version_id
            self.shadow_architecture = architecture
            self.shadow_predictor = predictor
            self.total_evaluations = 0
            self.agreement_count = 0
            self.disagreement_count = 0
            self._dropped_evaluations = 0
            self._discarded_evaluations = 0
            self._failed_evaluations = 0
            self.history.clear()
            from datetime import datetime, timezone
            self.started_at = datetime.now(timezone.utc).isoformat()
            logger.info(f"Shadow evaluator configured with candidate version {version_id} ({architecture}).")

    def clear_shadow(self) -> None:
        """Removes the shadow candidate configuration."""
        with self._lock:
            self._generation += 1
            self.shadow_version_id = None
            self.shadow_architecture = None
            self.shadow_predictor = None
            logger.info("Shadow evaluator cleared.")

    def is_active(self) -> bool:
        with self._lock:
            return self.shadow_predictor is not None

    def evaluate(self, active_result: Dict[str, Any], model_input: np.ndarray) -> bool:
        """
        Enqueues a bounded shadow evaluation without waiting for inference.

        Returns False when no candidate is active or the bounded queue is full.
        Shadow work never holds the shared state lock while the model runs.
        """
        with self._lock:
            if self.shadow_predictor is None or self._shutdown:
                return False
            task = (
                self._generation,
                self.shadow_predictor,
                dict(active_result),
                np.array(model_input, copy=True),
            )
            try:
                self._queue.put_nowait(task)
            except queue.Full:
                self._dropped_evaluations += 1
                return False
            return True

    def _run_worker(self) -> None:
        while True:
            task = self._queue.get()
            try:
                if task is None:
                    return

                generation, predictor, active_result, model_input = task
                with self._lock:
                    if (
                        self._shutdown
                        or generation != self._generation
                        or predictor is not self.shadow_predictor
                    ):
                        self._discarded_evaluations += 1
                        continue
                    self._in_flight += 1

                try:
                    start = time.perf_counter()
                    shadow_res = predictor.predict(model_input)
                    shadow_latency = round((time.perf_counter() - start) * 1000.0, 3)
                    active_primary = active_result.get("primary")
                    shadow_primary = shadow_res.get("primary")
                    agrees = active_primary == shadow_primary
                    comparison_record = {
                        "timestamp": time.time(),
                        "active_primary": active_primary,
                        "shadow_primary": shadow_primary,
                        "agrees": bool(agrees),
                        "active_confidence": active_result.get("primary_confidence", 0.0),
                        "shadow_confidence": shadow_res.get("primary_confidence", 0.0),
                        "active_latency_ms": active_result.get("latency_ms", 0.0),
                        "shadow_latency_ms": shadow_latency,
                    }
                except Exception as exc:
                    with self._lock:
                        if (
                            not self._shutdown
                            and generation == self._generation
                            and predictor is self.shadow_predictor
                        ):
                            self._failed_evaluations += 1
                    # Exception messages may contain request/model details. Keep
                    # the operational signal while avoiding sensitive payloads.
                    logger.warning(
                        "Shadow candidate inference failed (error_type=%s)",
                        type(exc).__name__,
                    )
                    continue

                with self._lock:
                    if (
                        generation != self._generation
                        or predictor is not self.shadow_predictor
                        or self._shutdown
                    ):
                        self._discarded_evaluations += 1
                        continue
                    self.total_evaluations += 1
                    if agrees:
                        self.agreement_count += 1
                    else:
                        self.disagreement_count += 1
                    self.history.append(comparison_record)
            finally:
                if task is not None:
                    with self._lock:
                        if self._in_flight:
                            self._in_flight -= 1
                self._queue.task_done()

    def shutdown(self, timeout: float = 1.0) -> None:
        """Stops the daemon worker for tests and orderly process teardown."""
        with self._lock:
            if self._shutdown:
                return
            self._shutdown = True
            self._generation += 1
            self.shadow_predictor = None
            self.shadow_version_id = None
            self.shadow_architecture = None

        # Make room for the sentinel without waiting on an inference that may
        # be stuck inside native model code. The worker is daemonized, so a
        # timed-out inference cannot prevent service process shutdown.
        while True:
            try:
                queued = self._queue.get_nowait()
            except queue.Empty:
                break
            else:
                if queued is not None:
                    with self._lock:
                        self._discarded_evaluations += 1
                self._queue.task_done()
        self._queue.put_nowait(None)
        if threading.current_thread() is not self._worker:
            self._worker.join(timeout=max(0.0, timeout))

    def get_summary(self) -> Dict[str, Any]:
        """Returns aggregated agreement statistics across all evaluations in the current window."""
        with self._lock:
            if self.shadow_version_id is None:
                return {
                    "status": "INACTIVE",
                    "message": "No shadow candidate currently configured for evaluation.",
                    "total_evaluations": 0,
                    "agreement_rate": 0.0,
                    "pending": self._queue.qsize(),
                    "in_flight": self._in_flight,
                    "dropped_evaluations": self._dropped_evaluations,
                    "discarded_evaluations": self._discarded_evaluations,
                    "failed_evaluations": self._failed_evaluations,
                }

            agreement_rate = (
                round(self.agreement_count / self.total_evaluations, 4)
                if self.total_evaluations > 0 else None
            )
            if self._failed_evaluations:
                evaluation_status = "DEGRADED" if self.total_evaluations else "FAILED"
            elif self._dropped_evaluations:
                evaluation_status = "BACKPRESSURED"
            elif self.total_evaluations:
                evaluation_status = "HEALTHY"
            else:
                evaluation_status = "PENDING"

            # Class breakdown
            class_agreements: Dict[str, Dict[str, int]] = {}
            for rec in self.history:
                act = rec["active_primary"]
                if act not in class_agreements:
                    class_agreements[act] = {"match": 0, "mismatch": 0}
                if rec["agrees"]:
                    class_agreements[act]["match"] += 1
                else:
                    class_agreements[act]["mismatch"] += 1

            return {
                "status": "ACTIVE",
                "shadow_version_id": self.shadow_version_id,
                "shadow_architecture": self.shadow_architecture,
                "evaluation_status": evaluation_status,
                "started_at": self.started_at,
                "total_evaluations": self.total_evaluations,
                "pending": self._queue.qsize(),
                "in_flight": self._in_flight,
                "dropped_evaluations": self._dropped_evaluations,
                "discarded_evaluations": self._discarded_evaluations,
                "failed_evaluations": self._failed_evaluations,
                "agreements": self.agreement_count,
                "disagreements": self.disagreement_count,
                "agreement_rate": agreement_rate,
                "per_class_summary": class_agreements,
                "recent_sample_comparisons": list(self.history)[-5:] if self.history else [],
            }


# Global singleton evaluator instance
shadow_evaluator = ShadowEvaluator()
