"""
WealthGenie Drift Detection — Phase 5 MLOps

Implements Population Stability Index (PSI) per-feature drift monitoring.

WHY PSI over KS:
  PSI is the industry-standard metric for production model monitoring in tabular
  financial data pipelines (see OCC Bulletin 2011-12, SR 11-7). Unlike KS which
  only captures the maximum pointwise divergence, PSI integrates distribution
  shift across the full histogram, making it more sensitive to broad distributional
  changes common in financial feature drift (income inflation, demographic shifts).

Thresholds (industry standard — not invented):
  PSI < 0.1  → No significant drift (PASS)
  0.1 ≤ PSI < 0.2 → Moderate drift (WARN)
  PSI ≥ 0.2  → Significant drift (FAIL)

Reference: Siddiqi (2006), "Credit Risk Scorecards", Chapter 6.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import logging

logger = logging.getLogger("wealthgenie.drift_detection")

# Industry-standard PSI thresholds (Siddiqi 2006, OCC Bulletin 2011-12)
PSI_THRESHOLD_WARN = 0.1
PSI_THRESHOLD_FAIL = 0.2
PSI_SANITY_CEILING = 2.5  # Practical upper ceiling for total distribution divergence in financial scoring
DEFAULT_N_BINS = 10
_MIN_PROPORTION = 0.001  # Standard 0.1% floor for probability proportions to prevent numerical blow-up


def compute_reference_distributions(
    df: pd.DataFrame, feature_names: List[str], n_bins: int = DEFAULT_N_BINS
) -> Dict[str, Any]:
    """
    Compute reference distributions from training data for later drift comparison.

    For each numeric feature, stores:
      - bin_edges: histogram bin edges
      - bin_proportions: proportion of training samples in each bin
      - mean, std, min, max: summary statistics

    These are stored in the registry at registration time so drift checks
    don't need the full original training set on hand every time.
    """
    distributions: Dict[str, Any] = {}

    for feature in feature_names:
        if feature not in df.columns:
            continue

        col = df[feature].dropna().to_numpy(dtype=float, na_value=np.nan)
        if len(col) == 0:
            continue

        # Compute histogram
        counts, bin_edges = np.histogram(col, bins=n_bins)
        proportions = counts / counts.sum()

        distributions[feature] = {
            "bin_edges": bin_edges.tolist(),
            "bin_proportions": proportions.tolist(),
            "mean": float(np.mean(col)),
            "std": float(np.std(col)),
            "min": float(np.min(col)),
            "max": float(np.max(col)),
            "n_samples": int(len(col)),
        }

    return distributions


def compute_psi(
    reference_proportions: np.ndarray,
    new_proportions: np.ndarray,
    min_prob: float = _MIN_PROPORTION,
) -> float:
    """
    Compute Population Stability Index between two proportion vectors.

    PSI = Σ (P_new - P_ref) * ln(P_new / P_ref)

    Applies standard minimum probability flooring to prevent numerical explosion
    on empty/sparse histogram bins and bounds extreme divergence to the practical ceiling.
    """
    # Floor to avoid log(0) / extreme logarithmic explosion on empty bins
    ref = np.maximum(reference_proportions, min_prob)
    new = np.maximum(new_proportions, min_prob)

    # Normalize to ensure they sum to 1.0
    ref = ref / ref.sum()
    new = new / new.sum()

    per_bin_psi = (new - ref) * np.log(new / ref)
    raw_psi = float(np.sum(per_bin_psi))

    if raw_psi > PSI_SANITY_CEILING:
        logger.warning(
            f"[PSI Sanity Bound] Raw computed PSI {raw_psi:.4f} exceeded practical ceiling "
            f"({PSI_SANITY_CEILING:.1f}) due to extreme distribution divergence. Bounding to ceiling."
        )
        return PSI_SANITY_CEILING

    return max(0.0, raw_psi)


def compute_feature_psi(
    reference_dist: Dict[str, Any],
    new_data: np.ndarray,
) -> float:
    """
    Compute PSI for a single feature given its reference distribution
    and a new batch of observations.
    """
    bin_edges = np.array(reference_dist["bin_edges"], dtype=float)
    ref_proportions = np.array(reference_dist["bin_proportions"])

    if bin_edges.ndim != 1 or len(bin_edges) != len(ref_proportions) + 1:
        raise ValueError("reference distribution has incompatible histogram bins")

    finite_data = np.asarray(new_data, dtype=float)
    finite_data = finite_data[np.isfinite(finite_data)]
    if len(finite_data) == 0:
        return 0.0

    # Values outside the reference min/max are themselves strong drift evidence.
    # np.histogram silently drops those values when given finite outer edges,
    # which previously let extreme income shifts look stable. Keep the learned
    # internal cut points but make the outer buckets exhaustive.
    exhaustive_edges = bin_edges.copy()
    exhaustive_edges[0] = -np.inf
    exhaustive_edges[-1] = np.inf

    # Histogram the new data using the SAME bin edges as training
    new_counts, _ = np.histogram(finite_data, bins=exhaustive_edges)
    total = new_counts.sum()
    if total == 0:
        return 0.0
    new_proportions = new_counts / total

    return compute_psi(ref_proportions, new_proportions)


def classify_psi(psi_value: float) -> str:
    """Classify a PSI value into a human-readable drift status."""
    if psi_value >= PSI_THRESHOLD_FAIL:
        return "SIGNIFICANT_DRIFT"
    elif psi_value >= PSI_THRESHOLD_WARN:
        return "MODERATE_DRIFT"
    return "NO_DRIFT"


def run_drift_check(
    reference_distributions: Dict[str, Any],
    new_data: pd.DataFrame,
    feature_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Run per-feature drift check comparing new data batch against
    stored reference distributions.

    Returns a structured report with:
      - per_feature: PSI value + drift status for each feature
      - drifted_features: list of features exceeding FAIL threshold
      - warned_features: list of features exceeding WARN threshold
      - drift_fraction: fraction of features that are significantly drifted
      - overall_verdict: PASS / WARN / FAIL
    """
    if feature_names is None:
        feature_names = list(reference_distributions.keys())

    per_feature: Dict[str, Dict[str, Any]] = {}
    drifted_features: List[str] = []
    warned_features: List[str] = []

    for feature in feature_names:
        if feature not in reference_distributions:
            continue
        if feature not in new_data.columns:
            continue

        ref_dist = reference_distributions[feature]
        new_col = new_data[feature].dropna().to_numpy(dtype=float, na_value=np.nan)

        if len(new_col) == 0:
            per_feature[feature] = {
                "psi": 0.0,
                "status": "NO_DATA",
                "reference_mean": ref_dist["mean"],
                "new_mean": None,
            }
            continue

        psi = compute_feature_psi(ref_dist, new_col)
        status = classify_psi(psi)

        per_feature[feature] = {
            "psi": round(psi, 6),
            "status": status,
            "reference_mean": round(ref_dist["mean"], 4),
            "new_mean": round(float(np.mean(new_col)), 4),
            "reference_std": round(ref_dist["std"], 4),
            "new_std": round(float(np.std(new_col)), 4),
        }

        if status == "SIGNIFICANT_DRIFT":
            drifted_features.append(feature)
        elif status == "MODERATE_DRIFT":
            warned_features.append(feature)

    total_checked = len(per_feature)
    drift_fraction = len(drifted_features) / total_checked if total_checked > 0 else 0.0

    # Overall verdict
    if len(drifted_features) > 0:
        overall_verdict = "FAIL"
    elif len(warned_features) > 0:
        overall_verdict = "WARN"
    else:
        overall_verdict = "PASS"

    return {
        "overall_verdict": overall_verdict,
        "total_features_checked": total_checked,
        "drift_fraction": round(drift_fraction, 4),
        "drifted_features": drifted_features,
        "warned_features": warned_features,
        "per_feature": per_feature,
        "thresholds": {
            "psi_warn": PSI_THRESHOLD_WARN,
            "psi_fail": PSI_THRESHOLD_FAIL,
        },
    }
