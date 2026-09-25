"""Deployment verification must share runtime bundle checks and never unpickle."""

import hashlib
import json
from pathlib import Path

import joblib
import pytest

from model.artifacts.bundle import ARCHITECTURE_FILES, MANIFEST_FILENAME, build_bundle_manifest
from model.architecture.base import BasePredictor
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from scripts.verify_serving_artifacts import ANCHOR_FILENAME, ArtifactVerificationError, verify_serving_artifacts


PROJECT_ROOT = Path(__file__).resolve().parents[1]
GIT_SHA = "a" * 40
LINEAGE = {
    "generator": "deployment-verifier-test-fixture",
    "generation_parameters": {"seed": 1},
    "split_identity": {
        name: hashlib.sha256(name.encode("ascii")).hexdigest()
        for name in ("train_indices_sha256", "validation_indices_sha256", "test_indices_sha256")
    },
}


def _write_bundle(root: Path, architecture: str) -> str:
    folder = {
        "RandomForest": "random_forest",
        "PyTorch_MLP": "pytorch_mlp",
        "FT_Transformer": "ft_transformer",
    }[architecture]
    bundle_dir = root / "model" / "bundles" / folder
    bundle_dir.mkdir(parents=True)
    filenames = ARCHITECTURE_FILES[architecture]
    model_version = f"{folder}-v1"
    training_hash = hashlib.sha256(folder.encode("ascii")).hexdigest()
    trained_at = "2026-09-24T12:00:00+00:00"

    for role, filename in filenames.items():
        if role not in {"metadata", "evaluation_report"}:
            (bundle_dir / filename).write_bytes(f"test-only:{architecture}:{role}".encode())
    metadata = {
        "model_version": model_version,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": FEATURE_NAMES,
        "target_classes": BasePredictor.TARGET_CLASSES,
        "training_data_hash": training_hash,
        "training_code_git_sha": GIT_SHA,
        "training_timestamp": trained_at,
        "dataset_lineage": LINEAGE,
    }
    (bundle_dir / filenames["metadata"]).write_text(json.dumps(metadata), encoding="utf-8")
    report = json.dumps({"evaluation_run_id": f"{folder}-eval", "metrics": {}}, sort_keys=True).encode()
    (bundle_dir / filenames["evaluation_report"]).write_bytes(report)
    manifest = build_bundle_manifest(
        bundle_dir,
        bundle_id=f"{folder}-bundle-v1",
        architecture=architecture,
        model_version=model_version,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        feature_names=FEATURE_NAMES,
        target_classes=BasePredictor.TARGET_CLASSES,
        training_data_hash=training_hash,
        training_code_git_sha=GIT_SHA,
        training_timestamp=trained_at,
        dataset_lineage=LINEAGE,
        python_version="3.12-test",
        framework_versions={"test-fixture": "1"},
        evaluation_report_id=f"{folder}-eval",
        evaluation_report_sha256=hashlib.sha256(report).hexdigest(),
    )
    (bundle_dir / MANIFEST_FILENAME).write_text(json.dumps(manifest), encoding="utf-8")
    return manifest["bundle_manifest_sha256"]


def _all_bundle_hashes(root: Path) -> dict[str, str]:
    return {
        architecture: _write_bundle(root, architecture)
        for architecture in ARCHITECTURE_FILES
    }


def _write_trusted_anchor(root: Path, hashes: dict[str, str]) -> None:
    bundles = {}
    for architecture, folder in {
        "RandomForest": "random_forest",
        "PyTorch_MLP": "pytorch_mlp",
        "FT_Transformer": "ft_transformer",
    }.items():
        manifest = json.loads(
            (root / "model" / "bundles" / folder / MANIFEST_FILENAME).read_text(encoding="utf-8")
        )
        bundles[architecture] = {
            "bundle_id": manifest["bundle_id"],
            "bundle_manifest_sha256": hashes[architecture],
        }
    payload = {"anchor_schema_version": 1, "bundles": bundles}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    payload["anchor_sha256"] = hashlib.sha256(canonical).hexdigest()
    (root / "model" / "bundles" / ANCHOR_FILENAME).write_text(
        json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )


def test_all_serving_bundles_use_canonical_verifier_without_deserialization(tmp_path, monkeypatch):
    hashes = _all_bundle_hashes(tmp_path)

    def forbidden_deserialization(*args, **kwargs):
        raise AssertionError("deployment verification must not deserialize executable model artifacts")

    monkeypatch.setattr(joblib, "load", forbidden_deserialization)
    verified = verify_serving_artifacts(tmp_path, expected_bundle_hashes=hashes)

    assert len(verified) == len(ARCHITECTURE_FILES)
    assert all("/bundles/" in entry for entry in verified)


def test_missing_external_hash_fails_before_any_deserialization(tmp_path, monkeypatch):
    monkeypatch.setattr(joblib, "load", lambda *args, **kwargs: pytest.fail("must not deserialize"))

    with pytest.raises(ArtifactVerificationError, match="explicit trusted bundle hashes must cover"):
        verify_serving_artifacts(tmp_path, expected_bundle_hashes={})


def test_default_verifier_uses_independent_complete_anchor_file(tmp_path):
    hashes = _all_bundle_hashes(tmp_path)
    _write_trusted_anchor(tmp_path, hashes)

    verified = verify_serving_artifacts(tmp_path)

    assert len(verified) == len(ARCHITECTURE_FILES)
    assert (tmp_path / "model" / "bundles" / ANCHOR_FILENAME).is_file()


def test_default_verifier_rejects_tampered_anchor_before_bundle_acceptance(tmp_path):
    hashes = _all_bundle_hashes(tmp_path)
    _write_trusted_anchor(tmp_path, hashes)
    anchor_path = tmp_path / "model" / "bundles" / ANCHOR_FILENAME
    anchor = json.loads(anchor_path.read_text(encoding="utf-8"))
    anchor["bundles"]["RandomForest"]["bundle_manifest_sha256"] = "0" * 64
    anchor_path.write_text(json.dumps(anchor), encoding="utf-8")

    with pytest.raises(ArtifactVerificationError, match="anchor self-check failed"):
        verify_serving_artifacts(tmp_path)


def test_tampered_bundle_member_fails_through_canonical_verifier(tmp_path):
    hashes = _all_bundle_hashes(tmp_path)
    model_path = tmp_path / "model/bundles/random_forest/model.pkl"
    model_path.write_bytes(model_path.read_bytes() + b"tamper")

    with pytest.raises(ArtifactVerificationError, match="RandomForest serving bundle verification failed"):
        verify_serving_artifacts(tmp_path, expected_bundle_hashes=hashes)


def test_missing_bundle_member_fails_closed(tmp_path):
    hashes = _all_bundle_hashes(tmp_path)
    (tmp_path / "model/bundles/pytorch_mlp/scaler.pkl").unlink()

    with pytest.raises(ArtifactVerificationError, match="PyTorch_MLP serving bundle verification failed"):
        verify_serving_artifacts(tmp_path, expected_bundle_hashes=hashes)


def test_production_docker_and_runtime_paths_never_train_on_startup():
    dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
    main = (PROJECT_ROOT / "main.py").read_text(encoding="utf-8")
    verifier = (PROJECT_ROOT / "scripts/verify_serving_artifacts.py").read_text(encoding="utf-8")

    assert "verify_serving_artifacts.py" in dockerfile
    assert "model.training.train" not in dockerfile
    assert "model.training.train_pytorch" not in dockerfile
    assert "train_random_forest_model" not in main
    assert "train_pytorch_model" not in main
    assert "train_ft_transformer_model" not in main
    assert "joblib.load" not in verifier
    assert "verify_bundle" in verifier
