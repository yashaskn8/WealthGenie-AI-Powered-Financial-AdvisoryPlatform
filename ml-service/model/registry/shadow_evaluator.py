"""
WealthGenie ML Microservice - Shadow / Canary Model Evaluator
Phase 5 MLOps Implementation.

Enables risk-free canary validation of newly trained/registered candidate models.
During live inference, incoming requests are evaluated by BOTH the active production model
and the configured shadow candidate model in parallel. The active model's response is returned
to the user uninterrupted, while shadow predictions and cross-model agreement statistics
are logged in a sliding evaluation buffer.
"""

import collections
import logging
import threading
import time
from typing import Any, Dict, Optional

import numpy as np

logger = logging.getLogger("wealthgenie.shadow_evaluator")


class ShadowEvaluator:
    """Thread-safe evaluator tracking active vs shadow candidate predictions."""

    def __init__(self, history_capacity: int = 1000):
        self.history_capacity = history_capacity
        self.shadow_version_id: Optional[str] = None
        self.shadow_architecture: Optional[str] = None
        self.shadow_predictor: Optional[Any] = None
        self._lock = threading.Lock()

        # Metrics counters
        self.total_evaluations: int = 0
        self.agreement_count: int = 0
        self.disagreement_count: int = 0
        self.history = collections.deque(maxlen=history_capacity)
        self.started_at: Optional[str] = None

    def configure_shadow(self, version_id: str, architecture: str, predictor: Any) -> None:
        """Configures an active shadow candidate model for dual-inference evaluation."""
        with self._lock:
            self.shadow_version_id = version_id
            self.shadow_architecture = architecture
            self.shadow_predictor = predictor
            self.total_evaluations = 0
            self.agreement_count = 0
            self.disagreement_count = 0
            self.history.clear()
            from datetime import datetime, timezone
            self.started_at = datetime.now(timezone.utc).isoformat()
            logger.info(f"Shadow evaluator configured with candidate version {version_id} ({architecture}).")

    def clear_shadow(self) -> None:
        """Removes the shadow candidate configuration."""
        with self._lock:
            self.shadow_version_id = None
            self.shadow_architecture = None
            self.shadow_predictor = None
            logger.info("Shadow evaluator cleared.")

    def is_active(self) -> bool:
        with self._lock:
            return self.shadow_predictor is not None

    def evaluate(self, active_result: Dict[str, Any], model_input: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        Executes inference on the shadow predictor, logs agreement statistics,
        and records the side-by-side comparison without altering the active response.
        """
        with self._lock:
            if self.shadow_predictor is None:
                return None

            try:
                start = time.perf_counter()
                shadow_res = self.shadow_predictor.predict(model_input)
                shadow_latency = round((time.perf_counter() - start) * 1000.0, 3)

                active_primary = active_result.get("primary")
                shadow_primary = shadow_res.get("primary")
                agrees = (active_primary == shadow_primary)

                self.total_evaluations += 1
                if agrees:
                    self.agreement_count += 1
                else:
                    self.disagreement_count += 1

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
                self.history.append(comparison_record)
                return comparison_record
            except Exception as e:
                logger.error(f"Shadow evaluation failed: {e}")
                return None

    def get_summary(self) -> Dict[str, Any]:
        """Returns aggregated agreement statistics across all evaluations in the current window."""
        with self._lock:
            if self.shadow_version_id is None:
                return {
                    "status": "INACTIVE",
                    "message": "No shadow candidate currently configured for evaluation.",
                    "total_evaluations": 0,
                    "agreement_rate": 0.0,
                }

            agreement_rate = (
                round(self.agreement_count / self.total_evaluations, 4)
                if self.total_evaluations > 0 else 1.0
            )

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
                "started_at": self.started_at,
                "total_evaluations": self.total_evaluations,
                "agreements": self.agreement_count,
                "disagreements": self.disagreement_count,
                "agreement_rate": agreement_rate,
                "per_class_summary": class_agreements,
                "recent_sample_comparisons": list(self.history)[-5:] if self.history else [],
            }


# Global singleton evaluator instance
shadow_evaluator = ShadowEvaluator()
