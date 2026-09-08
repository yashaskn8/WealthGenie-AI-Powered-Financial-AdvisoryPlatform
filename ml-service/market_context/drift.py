"""Diagnostic-only market feature drift metrics; no automatic retraining."""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.stats import ks_2samp


def _psi(reference: np.ndarray, observed: np.ndarray, bins: int = 10) -> float:
    edges = np.unique(np.quantile(reference, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return 0.0
    edges[0] = -np.inf
    edges[-1] = np.inf
    reference_counts = np.histogram(reference, bins=edges)[0].astype(float)
    observed_counts = np.histogram(observed, bins=edges)[0].astype(float)
    reference_rates = np.clip(reference_counts / max(reference_counts.sum(), 1), 1e-6, None)
    observed_rates = np.clip(observed_counts / max(observed_counts.sum(), 1), 1e-6, None)
    return float(np.sum((observed_rates - reference_rates) * np.log(observed_rates / reference_rates)))


def drift_diagnostics(
    reference_features: np.ndarray,
    observed_features: np.ndarray,
    feature_names: tuple[str, ...],
) -> dict[str, Any]:
    reference = np.asarray(reference_features, dtype=float)
    observed = np.asarray(observed_features, dtype=float)
    if reference.ndim != 2 or observed.ndim != 2 or reference.shape[1] != observed.shape[1]:
        raise ValueError("DRIFT_FEATURE_DIMENSION_MISMATCH")
    if reference.shape[1] != len(feature_names) or not np.isfinite(reference).all() or not np.isfinite(observed).all():
        raise ValueError("DRIFT_FEATURE_VALUES_INVALID")
    if len(observed) < 20:
        return {
            "classification": "DRIFT_MONITORING_DIAGNOSTIC",
            "thresholdStatus": None,
            "available": False,
            "reasonCodes": ["INSUFFICIENT_OBSERVATIONS_FOR_DRIFT_DIAGNOSTIC"],
            "metrics": {},
        }
    metrics = {}
    for index, name in enumerate(feature_names):
        ks = ks_2samp(reference[:, index], observed[:, index], alternative="two-sided", method="auto")
        metrics[name] = {
            "populationStabilityIndex": _psi(reference[:, index], observed[:, index]),
            "ksStatistic": float(ks.statistic),
            "ksPValue": float(ks.pvalue),
            "referenceMean": float(np.mean(reference[:, index])),
            "observedMean": float(np.mean(observed[:, index])),
        }
    return {
        "classification": "DRIFT_MONITORING_DIAGNOSTIC",
        "thresholdStatus": None,
        "available": True,
        "reasonCodes": ["RAW_DRIFT_METRICS_ONLY_NO_AUTOMATIC_ACTION"],
        "metrics": metrics,
    }
