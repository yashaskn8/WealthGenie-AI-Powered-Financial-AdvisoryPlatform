"""Versioned feature builder for the frozen Financial Profile architecture."""

from __future__ import annotations

import numpy as np

FEATURE_SCHEMA_VERSION = "recommendation-features-4.0.0"

# This is a true feature allowlist. No dictionary spread or arbitrary dataframe
# columns can cross into a personalized recommendation model.
FEATURE_NAMES = [
    "age",
    "monthly_take_home",
    "monthly_savings",
    "investment_horizon_years",
    "liquid_savings",
    "emi_burden_pct",
    "financial_dependents",
    "emergency_fund_months",
    "deployable_lump_sum",
    "risk_capacity_score",
    "risk_tolerance_encoded",
    "final_suitability_risk_encoded",
    "savings_rate",
    "liquidity_months",
    "goal_retirement",
    "goal_wealth_growth",
    "goal_tax_saving",
    "goal_emergency_fund",
    "emergency_fund_gap_months",
]

FEATURE_DISPLAY = {
    "age": "Age",
    "monthly_take_home": "Monthly take-home",
    "monthly_savings": "Monthly savings",
    "investment_horizon_years": "Investment horizon",
    "liquid_savings": "Liquid savings",
    "emi_burden_pct": "EMI burden",
    "financial_dependents": "Financial dependents",
    "emergency_fund_months": "Emergency-fund coverage",
    "deployable_lump_sum": "Explicit deployable lump sum",
    "risk_capacity_score": "Risk capacity",
    "risk_tolerance_encoded": "Stated risk preference",
    "final_suitability_risk_encoded": "Final suitability risk",
    "savings_rate": "Savings rate",
    "liquidity_months": "Liquid-savings coverage",
    "goal_retirement": "Retirement goal",
    "goal_wealth_growth": "Wealth Growth goal",
    "goal_tax_saving": "Tax Saving goal",
    "goal_emergency_fund": "Emergency Fund goal",
    "emergency_fund_gap_months": "Emergency-fund gap",
}

_RISK_TOLERANCE = {"Conservative": 1.0, "Moderate": 3.0, "Aggressive": 5.0}
_FINAL_RISK = {
    "Conservative": 1.0,
    "Conservative-Moderate": 2.0,
    "Moderate": 3.0,
    "Moderate-Aggressive": 4.0,
    "Aggressive": 5.0,
}
_GOAL_FEATURES = {
    "Retirement": "goal_retirement",
    "Wealth Growth": "goal_wealth_growth",
    "Tax Saving": "goal_tax_saving",
    "Emergency Fund": "goal_emergency_fund",
}


def get_feature_names() -> list[str]:
    return list(FEATURE_NAMES)


def engineer_features(
    *,
    age: float,
    monthly_take_home: float,
    monthly_savings: float,
    investment_horizon_years: float,
    liquid_savings: float,
    emi_burden_pct: float,
    financial_dependents: float,
    emergency_fund_months: float,
    deployable_lump_sum: float,
    risk_capacity_score: float,
    risk_tolerance: str,
    final_suitability_risk: str,
    investment_goals: list[str],
) -> dict[str, float]:
    """Build only v4 features; unexpected keyword inputs are rejected by Python."""
    if risk_tolerance not in _RISK_TOLERANCE:
        raise ValueError("unsupported risk_tolerance")
    if final_suitability_risk not in _FINAL_RISK:
        raise ValueError("unsupported final_suitability_risk")
    unknown_goals = set(investment_goals) - set(_GOAL_FEATURES)
    if unknown_goals:
        raise ValueError(f"unsupported investment goals: {sorted(unknown_goals)}")
    if monthly_take_home <= 0 or monthly_savings <= 0 or monthly_savings >= monthly_take_home:
        raise ValueError("invalid monthly cash-flow relationship")

    goals = {feature_name: 0.0 for feature_name in _GOAL_FEATURES.values()}
    for goal in investment_goals:
        goals[_GOAL_FEATURES[goal]] = 1.0

    features = {
        "age": float(age),
        "monthly_take_home": float(monthly_take_home),
        "monthly_savings": float(monthly_savings),
        "investment_horizon_years": float(investment_horizon_years),
        "liquid_savings": float(liquid_savings),
        "emi_burden_pct": float(emi_burden_pct),
        "financial_dependents": float(financial_dependents),
        "emergency_fund_months": float(emergency_fund_months),
        "deployable_lump_sum": float(deployable_lump_sum),
        "risk_capacity_score": float(risk_capacity_score),
        "risk_tolerance_encoded": _RISK_TOLERANCE[risk_tolerance],
        "final_suitability_risk_encoded": _FINAL_RISK[final_suitability_risk],
        "savings_rate": float(monthly_savings / monthly_take_home),
        "liquidity_months": float(liquid_savings / monthly_take_home),
        **goals,
        "emergency_fund_gap_months": float(max(0.0, 6.0 - emergency_fund_months)),
    }
    if list(features) != FEATURE_NAMES:
        raise AssertionError("feature builder order diverged from FEATURE_NAMES")
    if not all(np.isfinite(value) for value in features.values()):
        raise ValueError("engineered features must all be finite")
    return features


def to_model_array(features_dict: dict[str, float]) -> np.ndarray:
    unexpected = set(features_dict) - set(FEATURE_NAMES)
    missing = set(FEATURE_NAMES) - set(features_dict)
    if unexpected or missing:
        raise ValueError(f"feature contract mismatch: missing={sorted(missing)}, unexpected={sorted(unexpected)}")
    return np.asarray([[features_dict[name] for name in FEATURE_NAMES]], dtype=np.float64)
