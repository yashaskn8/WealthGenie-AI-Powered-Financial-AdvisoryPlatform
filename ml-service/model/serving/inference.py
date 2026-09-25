"""
WealthGenie ML Microservice - Concrete Model Predictor Implementations
Implements BasePredictor interface for RandomForest, PyTorch MLP, and FT-Transformer models.
Supports dynamic artifact loading from persistent ModelRegistry.
"""

import json
import logging
import shutil
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
from model.artifacts.bundle import ArtifactBundleError, materialize_verified_bundle, verify_bundle

logger = logging.getLogger("wealthgenie.inference")

_BASE_MODEL_DIR = Path(__file__).resolve().parents[1]


def _verified_bundle(
    *,
    bundle_dir: Path,
    expected_bundle_hash: Optional[str],
    architecture: str,
    require_serving_qualified: bool = True,
) -> tuple[Path, dict[str, Any]]:
    if not expected_bundle_hash:
        raise ArtifactBundleError("a registry-pinned bundle manifest hash is required")
    verified = verify_bundle(
        Path(bundle_dir),
        expected_bundle_hash,
        require_serving_qualified=require_serving_qualified,
    )
    manifest = verified["manifest"]
    if manifest["architecture"] != architecture:
        raise ArtifactBundleError("artifact bundle architecture does not match predictor")
    if manifest["feature_schema_version"] != FEATURE_SCHEMA_VERSION or manifest["feature_names"] != FEATURE_NAMES:
        raise ArtifactBundleError("artifact bundle feature schema is incompatible")
    if manifest["target_classes"] != BasePredictor.TARGET_CLASSES:
        raise ArtifactBundleError("artifact bundle target classes are incompatible")
    return materialize_verified_bundle(verified), verified


def _is_finite_predictor_output(predictor: Any, feature_count: int) -> bool:
    output = np.asarray(predictor.predict_proba(np.zeros((1, feature_count), dtype=np.float64)))
    return output.shape == (1, len(BasePredictor.TARGET_CLASSES)) and bool(np.isfinite(output).all())


class RandomForestPredictor(BasePredictor):
    """Predictor wrapping trained Scikit-Learn RandomForest classifier."""

    def __init__(self, model_path: Optional[Path] = None, label_encoder_path: Optional[Path] = None):
        self.model_path = model_path or (_BASE_MODEL_DIR / "model.pkl")
        self.label_encoder_path = label_encoder_path or (_BASE_MODEL_DIR / "label_encoder.pkl")
        self.model = None
        self.label_encoder = None
        self._class_labels = list(self.TARGET_CLASSES)
        self._is_loaded = False
        self.loaded_version_id = None
        self.loaded_bundle_id = None
        self.loaded_bundle_hash = None
        self.loaded_feature_schema_version = None
        self._materialized_bundle_dir: Optional[Path] = None

    def load_artifacts(
        self,
        artifact_path: Optional[Path] = None,
        label_encoder_path: Optional[Path] = None,
        *,
        bundle_dir: Optional[Path] = None,
        expected_bundle_hash: Optional[str] = None,
        version_id: Optional[str] = None,
        require_serving_qualified: bool = True,
    ) -> None:
        """Verify a complete pinned bundle before deserializing any pickle member."""
        if label_encoder_path is not None:
            raise ArtifactBundleError("label encoder paths must come from the verified candidate bundle")
        root = Path(bundle_dir) if bundle_dir is not None else (
            Path(artifact_path) if artifact_path and Path(artifact_path).is_dir()
            else Path(artifact_path).parent if artifact_path else self.model_path.parent
        )
        materialized, verified = _verified_bundle(
            bundle_dir=root,
            expected_bundle_hash=expected_bundle_hash,
            architecture="RandomForest",
            require_serving_qualified=require_serving_qualified,
        )
        try:
            metadata = json.loads((materialized / "metadata.json").read_text(encoding="utf-8"))
            candidate_model = joblib.load(materialized / "model.pkl")
            if getattr(candidate_model, "n_features_in_", None) != len(FEATURE_NAMES):
                raise ArtifactBundleError("RandomForest artifact feature count is incompatible")
            candidate_encoder = joblib.load(materialized / "label_encoder.pkl")
            try:
                class_labels = [str(value) for value in candidate_encoder.inverse_transform(candidate_model.classes_)]
            except Exception as exc:
                raise ArtifactBundleError("RandomForest model and label encoder class mapping mismatch") from exc
            if len(class_labels) != len(self.TARGET_CLASSES) or set(class_labels) != set(self.TARGET_CLASSES):
                raise ArtifactBundleError("RandomForest class allowlist is incompatible")
            if not _is_finite_predictor_output(candidate_model, len(FEATURE_NAMES)):
                raise ArtifactBundleError("RandomForest smoke inference produced invalid output")
        except Exception:
            shutil.rmtree(materialized, ignore_errors=True)
            raise

        previous_bundle = self._materialized_bundle_dir
        self.model = candidate_model
        self.label_encoder = candidate_encoder
        self._class_labels = class_labels
        self.model_path = materialized / "model.pkl"
        self.label_encoder_path = materialized / "label_encoder.pkl"
        self._materialized_bundle_dir = materialized
        self.loaded_version_id = version_id or metadata["model_version"]
        self.loaded_bundle_id = verified["manifest"]["bundle_id"]
        self.loaded_bundle_hash = verified["manifest_sha256"]
        self.loaded_feature_schema_version = verified["manifest"]["feature_schema_version"]
        self._is_loaded = True
        if previous_bundle and previous_bundle != materialized:
            shutil.rmtree(previous_bundle, ignore_errors=True)
        logger.info("RandomForestPredictor loaded a verified immutable bundle %s", self.loaded_bundle_id)

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
        self.loaded_version_id = None
        self.loaded_bundle_id = None
        self.loaded_bundle_hash = None
        self.loaded_feature_schema_version = None
        self._materialized_bundle_dir: Optional[Path] = None

    def load_artifacts(
        self,
        artifact_path: Optional[Path] = None,
        *,
        bundle_dir: Optional[Path] = None,
        expected_bundle_hash: Optional[str] = None,
        version_id: Optional[str] = None,
        require_serving_qualified: bool = True,
    ) -> None:
        """Verify a complete pinned bundle before loading weights or scaler."""
        root = Path(bundle_dir) if bundle_dir is not None else (
            Path(artifact_path) if artifact_path and Path(artifact_path).is_dir()
            else Path(artifact_path).parent if artifact_path else self.paths.model_weights.parent
        )
        materialized, verified = _verified_bundle(
            bundle_dir=root,
            expected_bundle_hash=expected_bundle_hash,
            architecture="PyTorch_MLP",
            require_serving_qualified=require_serving_qualified,
        )
        try:
            metadata = json.loads((materialized / "pytorch_metadata.json").read_text(encoding="utf-8"))
            if metadata.get("target_classes") != self.TARGET_CLASSES:
                raise ArtifactBundleError("MLP target class mapping is incompatible")
            candidate_preprocessor = FeaturePreprocessor()
            candidate_preprocessor.load(materialized / "scaler.pkl")
            if getattr(candidate_preprocessor.scaler, "n_features_in_", None) != len(FEATURE_NAMES):
                raise ArtifactBundleError("MLP scaler feature count is incompatible")
            model_config = metadata.get("model_config", {})
            config = PyTorchModelConfig(**model_config) if model_config else PyTorchModelConfig()
            candidate_model = FinancialMLP(config).to(self.device)
            candidate_model.load_state_dict(
                torch.load(materialized / "mlp_model.pt", map_location=self.device, weights_only=True)
            )
            candidate_model.eval()
            smoke_tensor = candidate_preprocessor.transform_to_tensor(
                np.zeros((1, len(FEATURE_NAMES)), dtype=np.float64), self.device
            )
            with torch.no_grad():
                smoke = candidate_model.predict_proba(smoke_tensor).cpu().numpy()
            if smoke.shape != (1, len(self.TARGET_CLASSES)) or not np.isfinite(smoke).all():
                raise ArtifactBundleError("MLP smoke inference produced invalid output")
        except Exception:
            shutil.rmtree(materialized, ignore_errors=True)
            raise

        previous_bundle = self._materialized_bundle_dir
        self.paths.model_weights = materialized / "mlp_model.pt"
        self.paths.scaler_path = materialized / "scaler.pkl"
        self.paths.metadata_path = materialized / "pytorch_metadata.json"
        self.preprocessor = candidate_preprocessor
        self.model = candidate_model
        self._materialized_bundle_dir = materialized
        self.loaded_version_id = version_id or metadata.get("version") or metadata.get("model_version")
        self.loaded_bundle_id = verified["manifest"]["bundle_id"]
        self.loaded_bundle_hash = verified["manifest_sha256"]
        self.loaded_feature_schema_version = verified["manifest"]["feature_schema_version"]
        self._is_loaded = True
        if previous_bundle and previous_bundle != materialized:
            shutil.rmtree(previous_bundle, ignore_errors=True)
        logger.info("MLPPredictor loaded verified immutable bundle %s on %s", self.loaded_bundle_id, self.device)

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
        self.loaded_version_id = None
        self.loaded_bundle_id = None
        self.loaded_bundle_hash = None
        self.loaded_feature_schema_version = None
        self._materialized_bundle_dir: Optional[Path] = None

    def load_artifacts(
        self,
        artifact_path: Optional[Path] = None,
        *,
        bundle_dir: Optional[Path] = None,
        expected_bundle_hash: Optional[str] = None,
        version_id: Optional[str] = None,
        require_serving_qualified: bool = True,
    ) -> None:
        """Verify a complete pinned bundle before loading weights or scaler."""
        root = Path(bundle_dir) if bundle_dir is not None else (
            Path(artifact_path) if artifact_path and Path(artifact_path).is_dir()
            else Path(artifact_path).parent if artifact_path else self.weights_path.parent
        )
        materialized, verified = _verified_bundle(
            bundle_dir=root,
            expected_bundle_hash=expected_bundle_hash,
            architecture="FT_Transformer",
            require_serving_qualified=require_serving_qualified,
        )
        try:
            metadata = json.loads((materialized / "ft_transformer_metadata.json").read_text(encoding="utf-8"))
            if metadata.get("target_classes") != self.TARGET_CLASSES:
                raise ArtifactBundleError("FT-Transformer target class mapping is incompatible")
            candidate_preprocessor = FeaturePreprocessor()
            candidate_preprocessor.load(materialized / "scaler.pkl")
            if getattr(candidate_preprocessor.scaler, "n_features_in_", None) != len(FEATURE_NAMES):
                raise ArtifactBundleError("FT-Transformer scaler feature count is incompatible")
            model_config = metadata.get("model_config", {})
            config = FTTransformerConfig(**model_config) if model_config else FTTransformerConfig()
            candidate_model = FTTransformer(config).to(self.device)
            candidate_model.load_state_dict(
                torch.load(materialized / "ft_transformer.pt", map_location=self.device, weights_only=True)
            )
            candidate_model.eval()
            smoke_tensor = candidate_preprocessor.transform_to_tensor(
                np.zeros((1, len(FEATURE_NAMES)), dtype=np.float64), self.device
            )
            with torch.no_grad():
                smoke = candidate_model.predict_proba(smoke_tensor).cpu().numpy()
            if smoke.shape != (1, len(self.TARGET_CLASSES)) or not np.isfinite(smoke).all():
                raise ArtifactBundleError("FT-Transformer smoke inference produced invalid output")
        except Exception:
            shutil.rmtree(materialized, ignore_errors=True)
            raise

        previous_bundle = self._materialized_bundle_dir
        self.weights_path = materialized / "ft_transformer.pt"
        self.scaler_path = materialized / "scaler.pkl"
        self.preprocessor = candidate_preprocessor
        self.model = candidate_model
        self._materialized_bundle_dir = materialized
        self.loaded_version_id = version_id or metadata.get("version") or metadata.get("model_version")
        self.loaded_bundle_id = verified["manifest"]["bundle_id"]
        self.loaded_bundle_hash = verified["manifest_sha256"]
        self.loaded_feature_schema_version = verified["manifest"]["feature_schema_version"]
        self._is_loaded = True
        if previous_bundle and previous_bundle != materialized:
            shutil.rmtree(previous_bundle, ignore_errors=True)
        logger.info("FT-Transformer loaded verified immutable bundle %s on %s", self.loaded_bundle_id, self.device)

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
