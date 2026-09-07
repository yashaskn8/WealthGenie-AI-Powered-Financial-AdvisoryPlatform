"""Auditable evaluation for the v4 Financial Profile feature contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score

from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.data.preprocessing import prepare_synthetic_training_data

MODEL_DIR = Path(__file__).resolve().parents[1]
REPORT_OUTPUT = MODEL_DIR / "rigor_evaluation_report.json"
FORBIDDEN_PROFILE_FEATURES = {
    "annual_income", "gross_income", "ctc", "basic_salary", "tax_regime",
    "section_80c", "section_80d", "hra", "home_loan_interest", "income_source",
    "goal_type", "sold_property_proceeds",
}


def audit_feature_overlap() -> Dict[str, Any]:
    forbidden = sorted(set(FEATURE_NAMES) & FORBIDDEN_PROFILE_FEATURES)
    return {
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "classifier_feature_count": len(FEATURE_NAMES),
        "feature_names": list(FEATURE_NAMES),
        "forbidden_feature_overlap": forbidden,
        "forbidden_feature_overlap_percentage": round(len(forbidden) / len(FEATURE_NAMES) * 100, 2),
        "finding": "PASS" if not forbidden else "FAIL",
    }


def audit_formula_logic_overlap() -> Dict[str, Any]:
    return {
        "formula_overlap_percentage": 100.0,
        "shared_math_terms": ["frozen_suitability_policy"],
        "audit_finding": (
            "The synthetic labels intentionally approximate the disclosed frozen suitability policy. "
            "Reported fidelity is not investment-outcome accuracy."
        ),
    }


def construct_independent_cfp_benchmark_targets(df: pd.DataFrame) -> pd.Series:
    """Compatibility helper using only v4 approved/derived columns."""
    targets = []
    for _, row in df.iterrows():
        final_level = int(round(float(row["final_suitability_risk_encoded"])))
        horizon = float(row["investment_horizon_years"])
        if float(row["goal_emergency_fund"]) == 1.0 or float(row["emergency_fund_months"]) < 2:
            target = "FD" if horizon <= 3 else "Debt_MF"
        elif float(row["goal_tax_saving"]) == 1.0 and horizon >= 3:
            target = "ELSS"
        elif final_level >= 4 and horizon >= 5:
            target = "Equity_MF"
        elif final_level >= 3 and horizon >= 3:
            target = "ETF"
        elif final_level >= 2:
            target = "Debt_MF"
        else:
            target = "RBI_Bond" if horizon >= 5 else "FD"
        targets.append(target)
    return pd.Series(targets, name="policy_target")


def evaluate_feature_ablation(model: Any, x_test: pd.DataFrame, y_test: np.ndarray, baseline: float) -> Dict[str, float]:
    impacts = {}
    for column in x_test.columns:
        ablated = x_test.copy()
        ablated[column] = x_test[column].median()
        impacts[column] = round(baseline - float(accuracy_score(y_test, model.predict(ablated.to_numpy()))), 4)
    return dict(sorted(impacts.items(), key=lambda item: item[1], reverse=True))


def evaluate_noise_robustness(
    model: Any,
    x_test: pd.DataFrame,
    y_test: np.ndarray,
    noise_levels: List[float] | None = None,
    seed: int = 42,
) -> Dict[str, float]:
    rng = np.random.default_rng(seed)
    results = {}
    for level in noise_levels or [0.05, 0.10, 0.20]:
        noisy = x_test.to_numpy(dtype=float).copy()
        scales = np.std(noisy, axis=0) * level
        noisy += rng.normal(0, scales, size=noisy.shape)
        results[f"noise_std_{int(level * 100)}pct_accuracy"] = round(float(accuracy_score(y_test, model.predict(noisy))), 4)
    return results


def run_full_rigor_audit() -> Dict[str, Any]:
    metadata_path = MODEL_DIR / "metadata.json"
    model_path = MODEL_DIR / "model.pkl"
    encoder_path = MODEL_DIR / "label_encoder.pkl"
    if not metadata_path.exists() or not model_path.exists() or not encoder_path.exists():
        raise FileNotFoundError("v4 model, label encoder, or metadata artifact is missing")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or metadata.get("feature_names") != FEATURE_NAMES:
        raise ValueError("stale or incompatible model metadata")

    model = joblib.load(model_path)
    label_encoder = joblib.load(encoder_path)
    x_test, generator_targets = prepare_synthetic_training_data(num_samples=2_000, seed=20260907)
    generator_class_order = np.asarray(["Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"])
    y_test = label_encoder.transform(generator_class_order[generator_targets])
    x_frame = pd.DataFrame(x_test, columns=FEATURE_NAMES)
    baseline = float(accuracy_score(y_test, model.predict(x_test)))
    report = {
        "feature_contract_audit": audit_feature_overlap(),
        "formula_logic_overlap_audit": audit_formula_logic_overlap(),
        "metric_reframe": {
            "reframed_metric_name": "Suitability-Policy Approximation Fidelity",
            "policy_approximation_fidelity_random_forest": round(baseline, 4),
            "outcome_accuracy_claimed": False,
        },
        "feature_ablation_impact": evaluate_feature_ablation(model, x_frame, y_test, baseline),
        "noise_robustness": evaluate_noise_robustness(model, x_frame, y_test),
    }
    REPORT_OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(run_full_rigor_audit(), indent=2))
