"""
WealthGenie ML Microservice - Concrete Model Predictor Implementations
Implements BasePredictor interface for RandomForest, PyTorch MLP, and FT-Transformer models.
Supports dynamic artifact loading from persistent ModelRegistry.
"""

import json
import logging
import time
from pathlib import Path
from typing import Dict, Any, Optional

import joblib
import numpy as np
import torch

from model.architecture.base import BasePredictor
from model.config import ArtifactPaths, PyTorchModelConfig, SAVED_MODELS_DIR, get_device
from model.architecture.ft_transformer import FTTransformer, FTTransformerConfig
from model.architecture.model import FinancialMLP
from model.data.preprocessing import FeaturePreprocessor
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION

logger = logging.getLogger("wealthgenie.inference")

_BASE_MODEL_DIR = Path(__file__).resolve().parents[1]


class RandomForestPredictor(BasePredictor):
    """Predictor wrapping trained Scikit-Learn RandomForest classifier."""

    def __init__(self, model_path: Optional[Path] = None, label_encoder_path: Optional[Path] = None):
        self.model_path = model_path or (_BASE_MODEL_DIR / "model.pkl")
        self.label_encoder_path = label_encoder_path or (_BASE_MODEL_DIR / "label_encoder.pkl")
        self.model = None
        self.label_encoder = None
        self._class_labels = list(self.TARGET_CLASSES)
        self._is_loaded = False

    def load_artifacts(self, artifact_path: Optional[Path] = None, label_encoder_path: Optional[Path] = None) -> None:
        """Loads RandomForest pkl and label encoder from disk."""
        self._is_loaded = False
        self.loaded_version_id = None
        if artifact_path:
            self.model_path = Path(artifact_path)
        if label_encoder_path:
            self.label_encoder_path = Path(label_encoder_path)

        if not self.model_path.exists() or not self.label_encoder_path.exists():
            logger.warning(f"RandomForest artifacts missing at {self.model_path}")
            return
        metadata_path = _BASE_MODEL_DIR / "metadata.json"
        if not metadata_path.exists():
            logger.warning("RandomForest metadata is missing; rejecting unversioned artifact.")
            return
        with open(metadata_path, "r", encoding="utf-8") as metadata_file:
            metadata = json.load(metadata_file)
        if metadata.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or metadata.get("feature_names") != FEATURE_NAMES:
            logger.warning("RandomForest artifact is stale or feature-incompatible; rejecting it.")
            return
        candidate_model = joblib.load(self.model_path)
        if getattr(candidate_model, "n_features_in_", None) != len(FEATURE_NAMES):
            logger.warning("RandomForest artifact feature count is incompatible; rejecting it.")
            return
        candidate_encoder = joblib.load(self.label_encoder_path)
        try:
            class_labels = [str(value) for value in candidate_encoder.inverse_transform(candidate_model.classes_)]
        except Exception as exc:
            logger.warning("RandomForest class metadata is incompatible; rejecting it: %s", exc)
            return
        if len(class_labels) != len(self.TARGET_CLASSES) or set(class_labels) != set(self.TARGET_CLASSES):
            logger.warning("RandomForest class allowlist is incompatible; rejecting it.")
            return
        self.model = candidate_model
        self.label_encoder = candidate_encoder
        self._class_labels = class_labels
        self.loaded_version_id = metadata.get("model_version")
        self._is_loaded = True
        logger.info(f"RandomForestPredictor loaded successfully from {self.model_path}.")

    def predict_proba(self, feature_array: np.ndarray) -> np.ndarray:
        if not self._is_loaded or self.model is None:
            raise RuntimeError("RandomForestPredictor not loaded.")
        return self.model.predict_proba(feature_array)

    def predict(self, feature_array: np.ndarray) -> Dict[str, Any]:
        start_time = time.perf_counter()
        proba = self.predict_proba(feature_array)[0]
        latency_ms = (time.perf_counter() - start_time) * 1000.0

        sorted_idx = np.argsort(proba)[::-1]
        confidence_scores = {
            self._class_labels[i]: round(float(proba[i]), 4)
            for i in range(len(self._class_labels))
        }

        return {
            "model_used": self.model_name,
            "primary": self._class_labels[sorted_idx[0]],
            "secondary": self._class_labels[sorted_idx[1]],
            "tertiary": self._class_labels[sorted_idx[2]],
            "confidence_scores": confidence_scores,
            "primary_confidence": round(float(proba[sorted_idx[0]]), 4),
            "low_confidence": float(proba[sorted_idx[0]]) < 0.45,
            "latency_ms": round(latency_ms, 3),
        }

    @property
    def model_name(self) -> str:
        return "RandomForest"

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded


class MLPPredictor(BasePredictor):
    """Predictor wrapping trained PyTorch Multi-Layer Perceptron (MLP) model."""

    def __init__(self, paths: ArtifactPaths = ArtifactPaths()):
        self.paths = paths
        self.device = get_device()
        self.preprocessor = FeaturePreprocessor()
        self.model: Optional[FinancialMLP] = None
        self._is_loaded = False

    def load_artifacts(self, artifact_path: Optional[Path] = None) -> None:
        """Loads PyTorch model weights and scaler from disk."""
        self._is_loaded = False
        self.loaded_version_id = None
        if artifact_path:
            self.paths.model_weights = Path(artifact_path)

        if not self.paths.model_weights.exists() or not self.paths.scaler_path.exists():
            logger.warning(f"MLPPredictor weights missing at {self.paths.model_weights}")
            return

        metadata = {}
        if self.paths.metadata_path.exists():
            with open(self.paths.metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        if metadata.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or metadata.get("feature_names") != FEATURE_NAMES:
            logger.warning("MLP artifact is stale or feature-incompatible; rejecting it.")
            return

        self.preprocessor.load(self.paths.scaler_path)
        if getattr(self.preprocessor.scaler, "n_features_in_", None) != len(FEATURE_NAMES):
            logger.warning("MLP scaler feature count is incompatible; rejecting it.")
            return

        model_config = metadata.get("model_config", {})
        config = PyTorchModelConfig(**model_config) if model_config else PyTorchModelConfig()

        self.model = FinancialMLP(config).to(self.device)
        self.model.load_state_dict(
            torch.load(self.paths.model_weights, map_location=self.device, weights_only=True)
        )
        self.model.eval()
        self.loaded_version_id = metadata.get("version") or metadata.get("model_version")
        self._is_loaded = True
        logger.info(f"MLPPredictor loaded successfully from {self.paths.model_weights} on {self.device}.")

    def predict_proba(self, feature_array: np.ndarray) -> np.ndarray:
        if not self._is_loaded or self.model is None:
            raise RuntimeError("MLPPredictor not loaded.")
        X_tensor = self.preprocessor.transform_to_tensor(feature_array, self.device)
        with torch.no_grad():
            return self.model.predict_proba(X_tensor).cpu().numpy()

    def predict(self, feature_array: np.ndarray) -> Dict[str, Any]:
        start_time = time.perf_counter()
        proba = self.predict_proba(feature_array)[0]
        latency_ms = (time.perf_counter() - start_time) * 1000.0

        sorted_idx = np.argsort(proba)[::-1]
        confidence_scores = {
            self.TARGET_CLASSES[i]: round(float(proba[i]), 4)
            for i in range(len(self.TARGET_CLASSES))
        }

        return {
            "model_used": self.model_name,
            "primary": self.TARGET_CLASSES[sorted_idx[0]],
            "secondary": self.TARGET_CLASSES[sorted_idx[1]],
            "tertiary": self.TARGET_CLASSES[sorted_idx[2]],
            "confidence_scores": confidence_scores,
            "primary_confidence": round(float(proba[sorted_idx[0]]), 4),
            "low_confidence": float(proba[sorted_idx[0]]) < 0.45,
            "latency_ms": round(latency_ms, 3),
        }

    @property
    def model_name(self) -> str:
        return "PyTorch_FinancialMLP"

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded


class FTTransformerPredictor(BasePredictor):
    """Predictor wrapping trained PyTorch FT-Transformer model."""

    def __init__(self, weights_path: Optional[Path] = None, scaler_path: Optional[Path] = None):
        self.weights_path = weights_path or (SAVED_MODELS_DIR / "ft_transformer.pt")
        self.scaler_path = scaler_path or (SAVED_MODELS_DIR / "scaler.pkl")
        self.device = get_device()
        self.preprocessor = FeaturePreprocessor()
        self.model: Optional[FTTransformer] = None
        self._is_loaded = False

    def load_artifacts(self, artifact_path: Optional[Path] = None) -> None:
        """Loads FT-Transformer weights and preprocessor."""
        self._is_loaded = False
        self.loaded_version_id = None
        if artifact_path:
            self.weights_path = Path(artifact_path)

        if not self.weights_path.exists() or not self.scaler_path.exists():
            logger.warning(f"FTTransformerPredictor weights missing at {self.weights_path}")
            return

        metadata_path = self.weights_path.parent / "ft_transformer_metadata.json"
        if not metadata_path.exists():
            logger.warning("FT-Transformer metadata is missing; rejecting unversioned artifact.")
            return
        with open(metadata_path, "r", encoding="utf-8") as metadata_file:
            metadata = json.load(metadata_file)
        if metadata.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or metadata.get("feature_names") != FEATURE_NAMES:
            logger.warning("FT-Transformer artifact is stale or feature-incompatible; rejecting it.")
            return

        self.preprocessor.load(self.scaler_path)
        if getattr(self.preprocessor.scaler, "n_features_in_", None) != len(FEATURE_NAMES):
            logger.warning("FT-Transformer scaler feature count is incompatible; rejecting it.")
            return
        model_config = metadata.get("model_config", {})
        config = FTTransformerConfig(**model_config) if model_config else FTTransformerConfig()
        self.model = FTTransformer(config).to(self.device)
        try:
            self.model.load_state_dict(
                torch.load(self.weights_path, map_location=self.device, weights_only=True)
            )
        except RuntimeError as error:
            logger.warning(f"FT-Transformer artifact is feature-incompatible; rejecting it: {error}")
            self.model = None
            return
        self.model.eval()
        self.loaded_version_id = metadata.get("version") or metadata.get("model_version")
        self._is_loaded = True
        logger.info(f"FTTransformerPredictor loaded successfully from {self.weights_path} on {self.device}.")

    def predict_proba(self, feature_array: np.ndarray) -> np.ndarray:
        if not self._is_loaded or self.model is None:
            raise RuntimeError("FTTransformerPredictor not loaded.")
        X_tensor = self.preprocessor.transform_to_tensor(feature_array, self.device)
        with torch.no_grad():
            return self.model.predict_proba(X_tensor).cpu().numpy()

    def predict(self, feature_array: np.ndarray) -> Dict[str, Any]:
        start_time = time.perf_counter()
        proba = self.predict_proba(feature_array)[0]
        latency_ms = (time.perf_counter() - start_time) * 1000.0

        sorted_idx = np.argsort(proba)[::-1]
        confidence_scores = {
            self.TARGET_CLASSES[i]: round(float(proba[i]), 4)
            for i in range(len(self.TARGET_CLASSES))
        }

        return {
            "model_used": self.model_name,
            "primary": self.TARGET_CLASSES[sorted_idx[0]],
            "secondary": self.TARGET_CLASSES[sorted_idx[1]],
            "tertiary": self.TARGET_CLASSES[sorted_idx[2]],
            "confidence_scores": confidence_scores,
            "primary_confidence": round(float(proba[sorted_idx[0]]), 4),
            "low_confidence": float(proba[sorted_idx[0]]) < 0.45,
            "latency_ms": round(latency_ms, 3),
        }

    @property
    def model_name(self) -> str:
        return "PyTorch_FTTransformer"

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded


# Alias for backward compatibility
PyTorchInferenceEngine = MLPPredictor
