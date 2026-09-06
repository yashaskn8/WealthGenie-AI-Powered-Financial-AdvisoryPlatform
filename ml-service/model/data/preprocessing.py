"""
WealthGenie ML Microservice - Preprocessing Module
Handles feature normalization, tensor formatting, and preprocessor persistence.
"""

import sys
from pathlib import Path

_ml_service_dir = str(Path(__file__).resolve().parent.parent)
if _ml_service_dir not in sys.path:
    sys.path.insert(0, _ml_service_dir)

import json
import joblib
import numpy as np
import torch
from sklearn.preprocessing import StandardScaler
from typing import Dict, Tuple, Any, Optional

from model.config import ArtifactPaths, PyTorchModelConfig




class FeaturePreprocessor:
    """Standardizes numerical features and formats data for PyTorch neural network training and inference."""

    def __init__(self):
        self.scaler = StandardScaler()
        self.is_fitted = False

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        """Fits the scaler on training feature matrix X and returns scaled features."""
        X_scaled = self.scaler.fit_transform(X)
        self.is_fitted = True
        return X_scaled

    def transform(self, X: np.ndarray) -> np.ndarray:
        """Transforms feature matrix X using the fitted scaler."""
        if not self.is_fitted:
            raise RuntimeError("Preprocessor must be fitted or loaded before calling transform()")
        return self.scaler.transform(X)

    def transform_to_tensor(self, X: np.ndarray, device: torch.device) -> torch.Tensor:
        """Scales feature matrix X and returns a PyTorch FloatTensor on the target device."""
        X_scaled = self.transform(X)
        return torch.tensor(X_scaled, dtype=torch.float32, device=device)

    def save(self, scaler_path: Path) -> None:
        """Persists the fitted StandardScaler object to disk."""
        if not self.is_fitted:
            raise RuntimeError("Cannot save an unfitted preprocessor")
        scaler_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.scaler, scaler_path)

    def load(self, scaler_path: Path) -> None:
        """Loads a pre-fitted StandardScaler object from disk."""
        if not scaler_path.exists():
            raise FileNotFoundError(f"Scaler artifact not found at {scaler_path}")
        self.scaler = joblib.load(scaler_path)
        self.is_fitted = True


def prepare_synthetic_training_data(
    num_samples: int = 1500, seed: int = 42
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate deterministic v4 boundary-conformant training examples.

    Labels approximate a transparent suitability policy; they are not claimed
    to be observed investor outcomes. The final server-side suitability guard
    remains authoritative after ML ranking.
    """
    from model.data.feature_engineering import engineer_features, to_model_array

    rng = np.random.default_rng(seed)
    rows = []
    labels = []
    risk_names = np.asarray(["Conservative", "Moderate", "Aggressive"])
    preference_levels = {"Conservative": 1, "Moderate": 3, "Aggressive": 5}
    final_labels = {1: "Conservative", 2: "Conservative-Moderate", 3: "Moderate", 4: "Moderate-Aggressive", 5: "Aggressive"}
    goal_names = np.asarray(["Retirement", "Wealth Growth", "Tax Saving", "Emergency Fund"])

    for _ in range(num_samples):
        age = int(rng.integers(18, 81))
        take_home = float(rng.uniform(20_000, 500_000))
        savings_rate = float(rng.uniform(0.03, 0.70))
        monthly_savings = take_home * savings_rate
        horizon = int(rng.integers(1, 31))
        liquid_savings = float(take_home * rng.uniform(0, 18))
        emi_burden = float(rng.uniform(0, 80))
        dependents = int(rng.integers(0, 7))
        emergency_months = float(rng.uniform(0, 12))
        deployable_lump = float(rng.choice([0.0, take_home * rng.uniform(1, 24)]))
        risk_tolerance = str(rng.choice(risk_names))
        goals = [str(rng.choice(goal_names))]
        if rng.random() < 0.25:
            second = str(rng.choice(goal_names))
            if second not in goals:
                goals.append(second)

        age_component = np.clip((70 - age) / 52, 0, 1) * 25
        horizon_component = np.clip(horizon / 30, 0, 1) * 25
        savings_component = np.clip(savings_rate / 0.30, 0, 1) * 20
        emergency_component = np.clip(emergency_months / 6, 0, 1) * 15
        liquidity_component = np.clip((liquid_savings / take_home) / 6, 0, 1) * 10
        emi_penalty = np.clip((emi_burden - 20) / 80, 0, 1) * 15
        dependents_penalty = min(10, dependents * 2.5)
        capacity_score = int(round(np.clip(
            age_component + horizon_component + savings_component + emergency_component
            + liquidity_component - emi_penalty - dependents_penalty,
            0,
            100,
        )))
        capacity_level = min(5, capacity_score // 20 + 1)
        final_level = min(capacity_level, preference_levels[risk_tolerance])
        final_risk = final_labels[final_level]

        feature_row = engineer_features(
            age=age,
            monthly_take_home=take_home,
            monthly_savings=monthly_savings,
            investment_horizon_years=horizon,
            liquid_savings=liquid_savings,
            emi_burden_pct=emi_burden,
            financial_dependents=dependents,
            emergency_fund_months=emergency_months,
            deployable_lump_sum=deployable_lump,
            risk_capacity_score=capacity_score,
            risk_tolerance=risk_tolerance,
            final_suitability_risk=final_risk,
            investment_goals=goals,
        )
        rows.append(to_model_array(feature_row)[0])

        if "Emergency Fund" in goals or emergency_months < 2:
            label = 4 if horizon <= 3 else 3  # FD / Debt_MF
        elif "Tax Saving" in goals and horizon >= 3:
            label = 1  # ELSS characteristics, not personalized tax savings
        elif final_level >= 4 and horizon >= 5:
            label = 0  # Equity_MF
        elif final_level >= 3 and horizon >= 3:
            label = 2  # ETF
        elif final_level >= 2:
            label = 3  # Debt_MF
        else:
            label = 5 if horizon >= 5 else 4  # RBI_Bond / FD
        labels.append(label)

    return np.asarray(rows, dtype=np.float64), np.asarray(labels, dtype=int)


import hashlib


def compute_dataset_hash_from_arrays(X: np.ndarray, y: np.ndarray) -> str:
    """Computes a deterministic SHA-256 hash over the combined feature matrix and labels."""
    combined = np.column_stack([X, y.reshape(-1, 1)]).astype(np.float64)
    return hashlib.sha256(combined.tobytes()).hexdigest()


def get_dataset_generation_params(num_samples: int = 1500, seed: int = 42) -> Dict[str, Any]:
    """Returns the exact generation parameters required to deterministically reproduce the training data."""
    return {
        "generator_name": "prepare_synthetic_training_data",
        "seed": seed,
        "num_samples": num_samples,
        "feature_count": 19,
        "class_count": 6,
        "age_range": [18.0, 80.0],
        "monthly_take_home_range": [20000.0, 500000.0],
        "savings_rate_range": [0.03, 0.70],
        "investment_horizon_years_range": [1.0, 30.0],
        "feature_schema_version": "recommendation-features-4.0.0",
        "target_classes": ["Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"],
    }


def regenerate_synthetic_dataset_and_hash(params: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, str]:
    """
    Given stored generation parameters from a registered model version's lineage metadata,
    independently regenerates the exact training dataset and returns (X, y, sha256_hash).
    """
    seed = params.get("seed", 42)
    num_samples = params.get("num_samples", 1500)
    X, y = prepare_synthetic_training_data(num_samples=num_samples, seed=seed)
    data_hash = compute_dataset_hash_from_arrays(X, y)
    return X, y, data_hash
