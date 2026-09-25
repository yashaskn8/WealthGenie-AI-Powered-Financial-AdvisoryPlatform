"""Drift experiments register complete integrity-verified bundles, never raw pickles."""

import json
import re

import pytest

from model.artifacts.bundle import ArtifactBundleError
from model.artifacts.store import LocalArtifactStore
from model.registry.drift_monitor import trigger_candidate_retrain
from model.registry.registry_store import ModelRegistry


def test_drift_candidate_uses_complete_unqualified_bundle_and_measured_splits(monkeypatch, tmp_path):
    from model.data.preprocessing import prepare_synthetic_training_data

    monkeypatch.setattr(
        "model.registry.drift_monitor.prepare_synthetic_training_data",
        lambda num_samples, seed: prepare_synthetic_training_data(num_samples=900, seed=seed),
    )
    monkeypatch.setattr("model.training.lineage.current_training_git_sha", lambda: "a" * 40)
    registry = ModelRegistry(db_path=tmp_path / "registry.sqlite")
    registry.artifact_store = LocalArtifactStore(tmp_path / "artifacts")
    try:
        result = trigger_candidate_retrain(store=registry, registered_by="offline-test")
        version = registry.get_version(result["version_id"])
        assert version is not None
        assert version["lifecycle_state"] == "CANDIDATE"
        assert version["is_active"] is False
        assert version["bundle_id"] == result["bundle_id"]
        assert version["bundle_manifest_sha256"] == result["bundle_manifest_sha256"]
        assert version["artifact_store_backend"] == "local_filesystem"

        bundle = registry.artifact_store.get_bundle(result["bundle_id"], result["bundle_manifest_sha256"])
        manifest = json.loads((bundle / "bundle.manifest.json").read_text(encoding="utf-8"))
        metadata = json.loads((bundle / "metadata.json").read_text(encoding="utf-8"))
        report = json.loads((bundle / "evaluation_report.json").read_text(encoding="utf-8"))
        assert {item["role"] for item in manifest["artifact_files"]} == {
            "model", "label_encoder", "metadata", "evaluation_report",
        }
        assert manifest["serving_qualified"] is False
        assert re.fullmatch(r"[0-9a-f]{40}", manifest["training_code_git_sha"])
        assert metadata["serving_qualified"] is False
        assert metadata["training_data_hash"] == manifest["training_data_hash"]
        assert metadata["dataset_lineage"] == manifest["dataset_lineage"]
        assert report["training_metrics"] == result["training_metrics"]
        assert report["validation_metrics"] == result["validation_metrics"]
        assert report["test_metrics"] == result["test_metrics"]
        with pytest.raises(ArtifactBundleError, match="not serving-qualified"):
            registry.artifact_store.verify_bundle(bundle, result["bundle_manifest_sha256"])
        assert result["metrics"] == {
            key: result["validation_metrics"][key]
            for key in ("accuracy", "balanced_accuracy", "macro_f1")
        }
        assert "artifact_path" not in result
    finally:
        registry.close()


def test_drift_candidate_refuses_missing_training_git_sha(monkeypatch, tmp_path):
    from model.data.preprocessing import prepare_synthetic_training_data

    monkeypatch.setattr(
        "model.registry.drift_monitor.prepare_synthetic_training_data",
        lambda num_samples, seed: prepare_synthetic_training_data(num_samples=900, seed=seed),
    )
    monkeypatch.setattr("model.training.lineage.current_training_git_sha", lambda: None)
    registry = ModelRegistry(db_path=tmp_path / "registry.sqlite")
    registry.artifact_store = LocalArtifactStore(tmp_path / "artifacts")
    try:
        with pytest.raises(RuntimeError, match="clean, versioned training-source Git SHA"):
            trigger_candidate_retrain(store=registry, registered_by="offline-test")
        assert registry.list_versions("RandomForest") == []
    finally:
        registry.close()
