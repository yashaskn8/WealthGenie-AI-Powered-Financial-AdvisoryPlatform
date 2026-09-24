"""
WealthGenie ML Microservice - Abstract Base Predictor Interface
Defines the standard contract for all model predictors in the platform.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List
import numpy as np


class BasePredictor(ABC):
    """
    Abstract Base Class for all machine learning models in WealthGenie.
    Guarantees unified inference contracts across Random Forest, PyTorch MLP, and FT-Transformer.
    """

    TARGET_CLASSES: List[str] = ["Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"]
    # Version of the artifact bytes currently held by this predictor instance.
    # The serving API must never substitute the registry's newer pointer here.
    loaded_version_id: str | None = None

    @abstractmethod
    def load_artifacts(self) -> None:
        """Loads trained weights, scalers, encoders, and metadata from storage."""
        pass

    @abstractmethod
    def predict(self, feature_array: np.ndarray) -> Dict[str, Any]:
        """
        Executes model inference on a v4 feature matrix (1x19 or Nx19).
        Returns primary, secondary, tertiary predictions, confidence scores, and latency.
        """
        pass

    @abstractmethod
    def predict_proba(self, feature_array: np.ndarray) -> np.ndarray:
        """
        Executes model forward pass returning probability distribution matrix of shape (N, 6).
        """
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Returns the canonical unique identifier of the model."""
        pass

    @property
    @abstractmethod
    def is_loaded(self) -> bool:
        """Returns True if model artifacts are loaded and ready for inference."""
        pass
