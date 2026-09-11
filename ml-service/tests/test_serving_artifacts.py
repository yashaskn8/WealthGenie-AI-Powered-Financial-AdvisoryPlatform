"""Tests for the read-only production serving-artifact verifier."""

import hashlib
import shutil
from pathlib import Path

import pytest

from scripts.verify_serving_artifacts import ArtifactVerificationError, verify_serving_artifacts


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REQUIRED_ARTIFACTS = (
    Path("model/model.pkl"),
    Path("model/label_encoder.pkl"),
    Path("model/metadata.json"),
    Path("model/saved_models/mlp_model.pt"),
    Path("model/saved_models/scaler.pkl"),
    Path("model/saved_models/pytorch_metadata.json"),
    Path("model/saved_models/ft_transformer.pt"),
    Path("model/saved_models/ft_transformer_metadata.json"),
)


def _copy_required_artifacts(destination: Path) -> None:
    for relative_path in REQUIRED_ARTIFACTS:
        source = PROJECT_ROOT / relative_path
        target = destination / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def test_supplied_serving_artifacts_are_loadable_and_read_only():
    before = {
        relative_path: hashlib.sha256((PROJECT_ROOT / relative_path).read_bytes()).digest()
        for relative_path in REQUIRED_ARTIFACTS
    }

    verified = verify_serving_artifacts(PROJECT_ROOT)

    assert tuple(Path(path) for path in verified) == REQUIRED_ARTIFACTS
    after = {
        relative_path: hashlib.sha256((PROJECT_ROOT / relative_path).read_bytes()).digest()
        for relative_path in REQUIRED_ARTIFACTS
    }
    assert after == before


def test_missing_required_artifact_fails_without_training(tmp_path):
    _copy_required_artifacts(tmp_path)
    (tmp_path / "model/saved_models/ft_transformer.pt").unlink()

    with pytest.raises(ArtifactVerificationError, match="FT-Transformer weights is missing"):
        verify_serving_artifacts(tmp_path)


def test_incompatible_metadata_fails_closed(tmp_path):
    _copy_required_artifacts(tmp_path)
    metadata_path = tmp_path / "model/metadata.json"
    metadata = metadata_path.read_text(encoding="utf-8").replace(
        '"feature_schema_version": "recommendation-features-4.0.0"',
        '"feature_schema_version": "recommendation-features-invalid"',
    )
    metadata_path.write_text(metadata, encoding="utf-8")

    with pytest.raises(ArtifactVerificationError, match="RandomForest feature schema is incompatible"):
        verify_serving_artifacts(tmp_path)


def test_production_docker_and_runtime_paths_never_train_on_startup():
    dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
    main = (PROJECT_ROOT / "main.py").read_text(encoding="utf-8")

    assert "verify_serving_artifacts.py" in dockerfile
    assert "model.training.train" not in dockerfile
    assert "model.training.train_pytorch" not in dockerfile
    assert "train_random_forest_model" not in main
    assert "train_pytorch_model" not in main
    assert "train_ft_transformer_model" not in main
