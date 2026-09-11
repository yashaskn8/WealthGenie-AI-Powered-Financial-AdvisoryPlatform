"""Read-only verification for supplied WealthGenie serving artifacts.

This verifier is intentionally separate from the training modules. It loads
the exact files used by the FastAPI serving paths, checks their metadata and
feature contracts, and structurally loads the serialized models on CPU. It
never trains, downloads, rewrites, or registers an artifact.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import torch


ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from model.architecture.base import BasePredictor  # noqa: E402
from model.architecture.ft_transformer import FTTransformer, FTTransformerConfig  # noqa: E402
from model.architecture.model import FinancialMLP  # noqa: E402
from model.config import PyTorchModelConfig  # noqa: E402
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION  # noqa: E402


class ArtifactVerificationError(RuntimeError):
    """Raised when a serving artifact is absent or incompatible."""


def _require_file(path: Path, label: str) -> None:
    if not path.is_file():
        raise ArtifactVerificationError(f"{label} is missing: {path}")
    if path.stat().st_size <= 0:
        raise ArtifactVerificationError(f"{label} is empty: {path}")


def _load_json(path: Path, label: str) -> dict[str, Any]:
    _require_file(path, label)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactVerificationError(f"{label} is not valid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise ArtifactVerificationError(f"{label} must contain a JSON object: {path}")
    return value


def _require_non_empty_string(metadata: dict[str, Any], field: str, label: str) -> str:
    value = metadata.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ArtifactVerificationError(f"{label} metadata field {field!r} is missing or empty")
    return value


def _validate_feature_contract(metadata: dict[str, Any], label: str) -> None:
    if metadata.get("feature_schema_version") != FEATURE_SCHEMA_VERSION:
        raise ArtifactVerificationError(
            f"{label} feature schema is incompatible: "
            f"{metadata.get('feature_schema_version')!r} != {FEATURE_SCHEMA_VERSION!r}"
        )
    if metadata.get("feature_names") != FEATURE_NAMES:
        raise ArtifactVerificationError(f"{label} feature names/order do not match the serving schema")


def _validate_class_allowlist(values: Any, label: str) -> None:
    if values != BasePredictor.TARGET_CLASSES:
        raise ArtifactVerificationError(f"{label} class mapping does not match the serving allowlist")


def _validate_class_set(values: list[str], label: str) -> None:
    if len(values) != len(set(values)) or set(values) != set(BasePredictor.TARGET_CLASSES):
        raise ArtifactVerificationError(f"{label} class mapping does not match the serving allowlist")


def _load_rf_artifacts(model_path: Path, encoder_path: Path, metadata_path: Path) -> None:
    metadata = _load_json(metadata_path, "RandomForest metadata")
    for field in ("model_name", "model_version", "dataset_version", "git_commit_hash", "training_data_hash"):
        _require_non_empty_string(metadata, field, "RandomForest")
    _validate_feature_contract(metadata, "RandomForest")
    if metadata.get("n_features") != len(FEATURE_NAMES):
        raise ArtifactVerificationError("RandomForest metadata feature count is incompatible")
    lineage = metadata.get("dataset_lineage")
    if not isinstance(lineage, dict) or lineage.get("target_classes") != BasePredictor.TARGET_CLASSES:
        raise ArtifactVerificationError("RandomForest dataset lineage class mapping is incompatible")

    _require_file(model_path, "RandomForest model")
    _require_file(encoder_path, "RandomForest label encoder")
    try:
        model = joblib.load(model_path)
        encoder = joblib.load(encoder_path)
    except Exception as exc:  # pragma: no cover - exact joblib exception varies by version
        raise ArtifactVerificationError("RandomForest pickle artifacts could not be loaded") from exc

    if not callable(getattr(model, "predict_proba", None)):
        raise ArtifactVerificationError("RandomForest artifact does not expose predict_proba")
    if getattr(model, "n_features_in_", None) != len(FEATURE_NAMES):
        raise ArtifactVerificationError("RandomForest model feature count is incompatible")
    model_classes = getattr(model, "classes_", None)
    if model_classes is None or len(model_classes) != len(BasePredictor.TARGET_CLASSES):
        raise ArtifactVerificationError("RandomForest model class count is incompatible")
    try:
        class_labels = [str(value) for value in encoder.inverse_transform(model_classes)]
    except Exception as exc:  # pragma: no cover - exact joblib exception varies by version
        raise ArtifactVerificationError("RandomForest label encoder cannot decode model classes") from exc
    _validate_class_set(class_labels, "RandomForest")


def _load_scaler(path: Path) -> None:
    _require_file(path, "PyTorch serving scaler")
    try:
        scaler = joblib.load(path)
    except Exception as exc:  # pragma: no cover - exact joblib exception varies by version
        raise ArtifactVerificationError("PyTorch serving scaler could not be loaded") from exc
    if getattr(scaler, "n_features_in_", None) != len(FEATURE_NAMES):
        raise ArtifactVerificationError("PyTorch serving scaler feature count is incompatible")
    for field in ("mean_", "scale_"):
        values = getattr(scaler, field, None)
        if values is None or len(values) != len(FEATURE_NAMES) or not np.all(np.isfinite(values)):
            raise ArtifactVerificationError(f"PyTorch serving scaler field {field!r} is incompatible")


def _load_torch_state(path: Path, model: torch.nn.Module, label: str) -> None:
    _require_file(path, label)
    try:
        state = torch.load(path, map_location="cpu", weights_only=True)
        if not isinstance(state, dict):
            raise ArtifactVerificationError(f"{label} does not contain a state dict")
        model.load_state_dict(state, strict=True)
    except ArtifactVerificationError:
        raise
    except Exception as exc:  # pragma: no cover - exact torch exception varies by version
        raise ArtifactVerificationError(f"{label} cannot be structurally loaded on CPU") from exc


def _validate_torch_metadata(metadata: dict[str, Any], label: str) -> dict[str, Any]:
    _require_non_empty_string(metadata, "version", label)
    _validate_feature_contract(metadata, label)
    model_config = metadata.get("model_config")
    if not isinstance(model_config, dict):
        raise ArtifactVerificationError(f"{label} model_config is missing")
    if model_config.get("input_dim") != len(FEATURE_NAMES):
        raise ArtifactVerificationError(f"{label} model input dimension is incompatible")
    if model_config.get("output_dim") != len(BasePredictor.TARGET_CLASSES):
        raise ArtifactVerificationError(f"{label} model output dimension is incompatible")
    return model_config


def verify_serving_artifacts(root: Path = ML_SERVICE_ROOT) -> list[str]:
    """Verify all artifacts loaded by the production serving paths."""
    model_dir = root / "model"
    saved_models_dir = model_dir / "saved_models"

    _load_rf_artifacts(
        model_dir / "model.pkl",
        model_dir / "label_encoder.pkl",
        model_dir / "metadata.json",
    )

    scaler_path = saved_models_dir / "scaler.pkl"
    _load_scaler(scaler_path)

    mlp_metadata = _load_json(saved_models_dir / "pytorch_metadata.json", "PyTorch MLP metadata")
    mlp_config = _validate_torch_metadata(mlp_metadata, "PyTorch MLP")
    _validate_class_allowlist(mlp_metadata.get("target_classes"), "PyTorch MLP")
    _load_torch_state(
        saved_models_dir / "mlp_model.pt",
        FinancialMLP(PyTorchModelConfig(**mlp_config)),
        "PyTorch MLP weights",
    )

    ft_metadata = _load_json(
        saved_models_dir / "ft_transformer_metadata.json",
        "FT-Transformer metadata",
    )
    ft_config = _validate_torch_metadata(ft_metadata, "FT-Transformer")
    _load_torch_state(
        saved_models_dir / "ft_transformer.pt",
        FTTransformer(FTTransformerConfig(**ft_config)),
        "FT-Transformer weights",
    )

    return [
        "model/model.pkl",
        "model/label_encoder.pkl",
        "model/metadata.json",
        "model/saved_models/mlp_model.pt",
        "model/saved_models/scaler.pkl",
        "model/saved_models/pytorch_metadata.json",
        "model/saved_models/ft_transformer.pt",
        "model/saved_models/ft_transformer_metadata.json",
    ]


def main() -> int:
    try:
        verified = verify_serving_artifacts()
    except ArtifactVerificationError as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1
    print(f"[PASS] Verified {len(verified)} pre-generated serving artifacts")
    for relative_path in verified:
        print(f"[PASS] {relative_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
