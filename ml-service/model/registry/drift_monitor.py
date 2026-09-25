"""
WealthGenie ML Microservice - Automated Drift Monitor & Retrain Trigger
Phase 5 MLOps Implementation.

Monitors incoming inference distributions against registered active model
reference distributions using Population Stability Index (PSI).
When statistically significant feature drift is detected (PSI >= 0.20),
automatically triggers a retraining pipeline, computes new model rigor metrics,
and registers a new NOT-yet-active candidate model version in the registry.
"""

import collections
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from model.registry.drift_detection import (
    PSI_THRESHOLD_FAIL,
    compute_reference_distributions,
    run_drift_check,
)
from model.data.preprocessing import (
    prepare_synthetic_training_data,
    compute_dataset_hash_from_arrays,
    get_dataset_generation_params,
)
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION

logger = logging.getLogger("wealthgenie.drift_monitor")

_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_DEFAULT_CANDIDATE_MODELS_DIR = _BASE_DIR / "model" / "saved_models"
MIN_OBSERVATIONS_PER_PSI_BIN = 10


def _minimum_drift_sample_count(reference_distributions: Dict[str, Any]) -> Optional[int]:
    """Derive a conservative sample floor from the active model's PSI bins.

    Reference metadata is the authority for the configured histogram shape. Do
    not silently substitute the default bin count when it is absent or corrupt.
    Ten observations per configured bin is the minimum operational evidence
    contract used by this monitor; it is not a claim of statistical power.
    """
    bin_counts = []
    for distribution in reference_distributions.values():
        if not isinstance(distribution, dict):
            return None
        edges = distribution.get("bin_edges")
        proportions = distribution.get("bin_proportions")
        if not isinstance(edges, list) or not isinstance(proportions, list):
            return None
        if len(proportions) < 1 or len(edges) != len(proportions) + 1:
            return None
        try:
            edge_values = np.asarray(edges, dtype=float)
            proportion_values = np.asarray(proportions, dtype=float)
        except (TypeError, ValueError):
            return None
        if (
            not np.all(np.isfinite(edge_values))
            or not np.all(np.isfinite(proportion_values))
            or np.any(np.diff(edge_values) <= 0)
            or np.any(proportion_values < 0)
            or not np.isclose(float(proportion_values.sum()), 1.0, atol=1e-6)
        ):
            return None
        bin_counts.append(len(proportions))

    if not bin_counts:
        return None
    return max(bin_counts) * MIN_OBSERVATIONS_PER_PSI_BIN


def _candidate_models_dir() -> Path:
    """Resolve candidate output at call time so tests and operators can isolate it."""
    import os
    configured = os.environ.get("ML_CANDIDATE_MODEL_DIR", "").strip()
    target = Path(configured) if configured else _DEFAULT_CANDIDATE_MODELS_DIR
    target.mkdir(parents=True, exist_ok=True)
    return target


class InferenceBuffer:
    """Thread-safe circular buffer collecting recent inference feature vectors."""

    def __init__(self, capacity: int = 2000):
        self.capacity = capacity
        self._buffer = collections.deque(maxlen=capacity)
        self._lock = threading.Lock()
        self.last_check_timestamp: Optional[str] = None
        self.last_check_verdict: Optional[str] = None
        self.last_drift_score: Optional[float] = None

    def record(self, feature_dict: Dict[str, Any]) -> None:
        with self._lock:
            self._buffer.append(feature_dict)

    def record_batch(self, feature_dicts: List[Dict[str, Any]]) -> None:
        with self._lock:
            for item in feature_dicts:
                self._buffer.append(item)

    def get_dataframe(self) -> Optional[pd.DataFrame]:
        with self._lock:
            if not self._buffer:
                return None
            return pd.DataFrame(list(self._buffer))

    def clear(self) -> None:
        with self._lock:
            self._buffer.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._buffer)

    def discard_oldest(self, count: int) -> int:
        """Discard only an evaluated prefix while preserving concurrent arrivals."""
        if not isinstance(count, int) or count < 0:
            raise ValueError("count must be a non-negative integer")
        with self._lock:
            removed = min(count, len(self._buffer))
            for _ in range(removed):
                self._buffer.popleft()
            return removed


# Singleton buffer instance
inference_buffer = InferenceBuffer(capacity=2000)


def generate_synthetic_feature_batch(
    n_samples: int = 300,
    seed: int = 42,
    shift_feature: Optional[str] = None,
    shift_multiplier: float = 1.0,
    shift_offset: float = 0.0,
) -> pd.DataFrame:
    """
    Generates a batch of synthetic feature observations for drift verification.
    If shift_feature is specified, alters that feature's distribution by shift_multiplier/offset.
    """
    features, _ = prepare_synthetic_training_data(num_samples=n_samples, seed=seed)
    df = pd.DataFrame(features, columns=FEATURE_NAMES)

    if shift_feature and shift_feature not in df.columns:
        raise ValueError(
            f"shift_feature must use {FEATURE_SCHEMA_VERSION}; unsupported feature: {shift_feature}"
        )
    if shift_feature:
        df[shift_feature] = (df[shift_feature] * shift_multiplier) + shift_offset
        logger.info(f"Applied simulated distribution shift to '{shift_feature}' (mult={shift_multiplier}, offset={shift_offset})")

    return df


def trigger_candidate_retrain(
    architecture: str = "RandomForest",
    store: Any = None,
    trigger_reason: str = "Automated retrain triggered by feature drift detection",
    registered_by: str = "manual_api_call",
) -> Dict[str, Any]:
    """
    Executes a retrain job for the specified architecture and registers the new candidate
    model version with is_active=False.
    """
    import joblib
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler, LabelEncoder

    candidate_id = f"candidate_{uuid.uuid4().hex[:8]}"

    if architecture.lower() in ["randomforest", "rf", "random_forest"]:
        candidate_dir = _candidate_models_dir()
        candidate_artifact_path = candidate_dir / f"rf_{candidate_id}.pkl"
        candidate_le_path = candidate_dir / f"le_{candidate_id}.pkl"

        # Generate fresh training dataset
        seed = int(time.time()) % 100000
        num_samples = 2500
        X, y_indices = prepare_synthetic_training_data(num_samples=num_samples, seed=seed)

        target_classes = ["Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"]
        y_labels = [target_classes[idx] for idx in y_indices]

        le = LabelEncoder()
        y = le.fit_transform(y_labels)

        pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("clf", RandomForestClassifier(
                n_estimators=100,
                max_depth=12,
                random_state=seed,
                n_jobs=-1,
                class_weight="balanced",
            )),
        ])
        X_train, X_validation, y_train, y_validation = train_test_split(
            X,
            y,
            test_size=0.2,
            random_state=seed,
            stratify=y,
        )
        pipeline.fit(X_train, y_train)

        training_predictions = pipeline.predict(X_train)
        validation_predictions = pipeline.predict(X_validation)
        training_metrics = {
            "accuracy": float(accuracy_score(y_train, training_predictions)),
        }
        validation_metrics = {
            "accuracy": float(accuracy_score(y_validation, validation_predictions)),
            "balanced_accuracy": float(balanced_accuracy_score(y_validation, validation_predictions)),
            "macro_f1": float(f1_score(y_validation, validation_predictions, average="macro", zero_division=0)),
        }

        joblib.dump(pipeline, candidate_artifact_path)
        joblib.dump(le, candidate_le_path)



        data_hash = compute_dataset_hash_from_arrays(X, np.array(y_indices))
        lineage_params = get_dataset_generation_params(num_samples=num_samples, seed=seed)

        df_train = pd.DataFrame(X_train, columns=FEATURE_NAMES)
        ref_dist = compute_reference_distributions(df_train, list(df_train.columns))

        metrics = {
            "rule_approximation_fidelity": round(validation_metrics["accuracy"], 4),
            "balanced_accuracy": round(validation_metrics["balanced_accuracy"], 4),
            "macro_f1": round(validation_metrics["macro_f1"], 4),
            "training_metrics": training_metrics,
            "validation_metrics": validation_metrics,
            "holdout_metrics": None,
            "metric_interpretation": "policy-approximation fidelity, not investment outcome accuracy",
        }
        hparams = {
            "n_estimators": 100,
            "max_depth": 12,
            "seed": seed,
            "num_samples": num_samples,
            "model_type": "RandomForestClassifier",
            "dataset_lineage": lineage_params,
            "dataset_kind": "synthetic_policy_approximation",
            "dataset_split": {"method": "stratified_train_validation", "validation_fraction": 0.2, "seed": seed},
            "serving_qualified": False,
            "registered_by": registered_by,
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "feature_names": FEATURE_NAMES,
        }

        # Register in persistent store
        if store is not None:
            version_id = store.register_model(
                model_architecture="RandomForest",
                artifact_path=candidate_artifact_path,
                training_data_hash=data_hash,
                training_timestamp=datetime.now(timezone.utc).isoformat(),
                hyperparameters=hparams,
                metrics=metrics,
                reference_distributions=ref_dist,
                notes=f"[registered_by={registered_by}] {trigger_reason}",
                set_active=False,  # MUST NOT be active until passing promotion gate
            )
        else:
            version_id = candidate_id

        logger.info(f"Successfully retrained and registered candidate model version '{version_id}' (is_active=False, registered_by={registered_by}).")
        return {
            "version_id": version_id,
            "model_architecture": "RandomForest",
            "artifact_path": str(candidate_artifact_path),
            "metrics": metrics,
            "is_active": False,
            "registered_by": registered_by,
            "registered_at": datetime.now(timezone.utc).isoformat(),
        }

    else:
        raise ValueError(f"Retraining for architecture '{architecture}' not supported in automated trigger.")


def check_drift_and_trigger_retrain(
    architecture: str = "RandomForest",
    input_df: Optional[pd.DataFrame] = None,
    store: Any = None,
    psi_threshold: float = PSI_THRESHOLD_FAIL,
    force_retrain_on_drift: bool = True,
    registered_by: str = "manual_api_call",
) -> Dict[str, Any]:
    """
    Core drift detector workflow:
    1. Loads reference distribution from currently active model version.
    2. Runs PSI drift detection on the provided/buffered observations.
    3. If drift >= threshold, executes automated retrain and registers candidate version (is_active=False).
    """
    if store is None:
        from store_factory import get_model_registry
        store = get_model_registry()

    active_version = store.get_active_model(architecture)
    if not active_version:
        raise ValueError(f"No active model found in registry for architecture '{architecture}'.")

    active_hyperparameters = active_version.get("hyperparameters") or {}
    if active_hyperparameters.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ValueError(
            f"Active model uses stale feature schema: "
            f"{active_hyperparameters.get('feature_schema_version')!r}"
        )

    ref_distributions = active_version.get("reference_distributions")
    if not ref_distributions:
        logger.error(
            "Drift cannot be evaluated: active model %s has no registered reference distribution",
            active_version.get("version_id"),
        )
        return {
            "status": "UNAVAILABLE",
            "reason": "DRIFT_REFERENCE_UNAVAILABLE",
            "active_version_id": active_version.get("version_id"),
            "drift_detected": None,
            "retrain_triggered": False,
            "candidate_version": None,
        }
    if set(ref_distributions) != set(FEATURE_NAMES):
        raise ValueError("Active model reference distributions do not match the v4 feature allowlist")

    minimum_sample_count = _minimum_drift_sample_count(ref_distributions)
    if minimum_sample_count is None:
        logger.error(
            "Drift cannot be evaluated: active model %s has invalid reference histogram metadata",
            active_version.get("version_id"),
        )
        return {
            "status": "UNAVAILABLE",
            "reason": "DRIFT_REFERENCE_UNAVAILABLE",
            "active_version_id": active_version.get("version_id"),
            "drift_detected": None,
            "retrain_triggered": False,
            "candidate_version": None,
        }

    if input_df is None or input_df.empty:
        input_df = inference_buffer.get_dataframe()

    if input_df is None or len(input_df) < minimum_sample_count:
        return {
            "status": "SKIPPED",
            "reason": f"Insufficient observations for drift calculation (need >= {minimum_sample_count} samples).",
            "minimum_sample_count": minimum_sample_count,
            "drift_detected": False,
            "retrain_triggered": False,
            "buffer_size": inference_buffer.size(),
        }

    missing = set(FEATURE_NAMES) - set(input_df.columns)
    unexpected = set(input_df.columns) - set(FEATURE_NAMES)
    if missing or unexpected:
        raise ValueError(
            f"Drift input feature contract mismatch: missing={sorted(missing)}, "
            f"unexpected={sorted(unexpected)}"
        )

    # Run PSI drift analysis
    drift_report = run_drift_check(ref_distributions, input_df)
    overall_verdict = drift_report["overall_verdict"]
    drifted_features = drift_report["drifted_features"]
    max_psi = 0.0

    for feat_info in drift_report["per_feature"].values():
        if isinstance(feat_info, dict) and "psi" in feat_info:
            max_psi = max(max_psi, feat_info["psi"])

    drift_detected = (overall_verdict == "FAIL") or (max_psi >= psi_threshold) or (len(drifted_features) > 0)

    inference_buffer.last_check_timestamp = datetime.now(timezone.utc).isoformat()
    inference_buffer.last_check_verdict = overall_verdict
    inference_buffer.last_drift_score = max_psi

    retrain_info = None
    environment = os.environ.get("ENVIRONMENT", "local").strip().lower()
    production_retrain_blocked = environment in {"production", "prod"} and force_retrain_on_drift
    if production_retrain_blocked:
        logger.warning(
            "Drift detected in production; candidate retraining is an explicit offline workflow and is disabled here."
        )
    if drift_detected and force_retrain_on_drift and not production_retrain_blocked:
        trigger_reason = (
            f"Auto-retrain triggered by PSI drift (verdict={overall_verdict}, "
            f"max_psi={max_psi:.4f}, drifted_features={drifted_features})"
        )
        logger.info(f"[DriftMonitor] {trigger_reason}. Initiating automated retraining...")
        retrain_info = trigger_candidate_retrain(
            architecture=architecture,
            store=store,
            trigger_reason=trigger_reason,
            registered_by=registered_by,
        )

    return {
        "status": "COMPLETED",
        "active_version_id": active_version["version_id"],
        "architecture": architecture,
        "sample_count": len(input_df),
        "overall_verdict": overall_verdict,
        "max_psi": round(max_psi, 4),
        "drift_detected": drift_detected,
        "drifted_features": drifted_features,
        "warned_features": drift_report["warned_features"],
        "retrain_triggered": bool(retrain_info is not None),
        "retrain_suppressed_reason": (
            "PRODUCTION_RETRAIN_DISABLED" if production_retrain_blocked and drift_detected else None
        ),
        "candidate_version": retrain_info,
        "drift_report": drift_report,
    }
