"""
WealthGenie ML Microservice - ModelRegistry Test Suite
Tests predictor registration, dynamic retrieval, and BasePredictor interface compliance.
"""

import numpy as np
from model.architecture.base import BasePredictor
from model.serving.registry import ModelRegistry


class DummyPredictor(BasePredictor):
    def __init__(self, name: str = "DummyModel"):
        self._name = name
        self._loaded = True

    def load_artifacts(self) -> None:
        pass

    def predict_proba(self, feature_array: np.ndarray) -> np.ndarray:
        return np.ones((len(feature_array), 6)) / 6.0

    def predict(self, feature_array: np.ndarray) -> dict:
        return {
            "model_used": self._name,
            "primary": "Equity_MF",
            "secondary": "ELSS",
            "tertiary": "ETF",
            "confidence_scores": {"Equity_MF": 0.5},
            "primary_confidence": 0.5,
            "low_confidence": False,
            "latency_ms": 1.2,
        }

    @property
    def model_name(self) -> str:
        return self._name

    @property
    def is_loaded(self) -> bool:
        return self._loaded


def test_model_registry_operations():
    reg = ModelRegistry()
    p1 = DummyPredictor("ModelA")
    p2 = DummyPredictor("ModelB")

    reg.register("model_a", p1)
    reg.register("model_b", p2)

    assert reg.get("model_a") == p1
    assert reg.get("MODEL_B") == p2
    assert reg.get("non_existent") is None

    models = reg.list_models()
    assert len(models) == 2
    assert models[0]["key"] == "model_a"
    assert models[1]["key"] == "model_b"
