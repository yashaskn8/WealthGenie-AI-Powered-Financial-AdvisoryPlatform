"""Manifest integrity tests for immutable serving artifact bundles."""

import hashlib
import json
from pathlib import Path

import pytest

from model.artifacts.bundle import (
    ArtifactBundleError,
    MANIFEST_FILENAME,
    build_bundle_manifest,
    verify_bundle,
)
from model.artifacts.store import ArtifactStoreError, LocalArtifactStore, get_artifact_store
from model.architecture.base import BasePredictor
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION


GIT_SHA = "a" * 40
DATA_HASH = hashlib.sha256(b"dataset").hexdigest()
TRAINED_AT = "2026-09-24T12:00:00+00:00"
LINEAGE = {
    "generator": "deterministic-test-generator",
    "generation_parameters": {"seed": 17, "rows": 60},
    "split_identity": {
        "train_indices_sha256": hashlib.sha256(b"train").hexdigest(),
        "validation_indices_sha256": hashlib.sha256(b"validation").hexdigest(),
        "test_indices_sha256": hashlib.sha256(b"test").hexdigest(),
    },
}


def _write_valid_rf_bundle(root: Path, *, serving_qualified: bool = True) -> str:
    root.mkdir(parents=True, exist_ok=True)
    (root / "model.pkl").write_bytes(b"model-fixture-bytes")
    (root / "label_encoder.pkl").write_bytes(b"encoder-fixture-bytes")
    evaluation_report = json.dumps(
        {"evaluation_run_id": "eval-run-17", "metrics": {"macro_f1": 0.91}},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    (root / "evaluation_report.json").write_bytes(evaluation_report)
    metadata = {
        "model_name": "RandomForest",
        "model_version": "rf-test-v1",
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": FEATURE_NAMES,
        "target_classes": BasePredictor.TARGET_CLASSES,
        "training_data_hash": DATA_HASH,
        "training_code_git_sha": GIT_SHA,
        "training_timestamp": TRAINED_AT,
        "dataset_lineage": LINEAGE,
    }
    (root / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    manifest = build_bundle_manifest(
        root,
        bundle_id="bundle-rf-test-v1",
        architecture="RandomForest",
        model_version="rf-test-v1",
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        feature_names=FEATURE_NAMES,
        target_classes=BasePredictor.TARGET_CLASSES,
        training_data_hash=DATA_HASH,
        training_code_git_sha=GIT_SHA,
        training_timestamp=TRAINED_AT,
        dataset_lineage=LINEAGE,
        python_version="3.12.3",
        framework_versions={"scikit-learn": "1.7.2", "joblib": "1.5.2"},
        evaluation_report_id="eval-run-17",
        evaluation_report_sha256=hashlib.sha256(evaluation_report).hexdigest(),
        serving_qualified=serving_qualified,
    )
    path = root / MANIFEST_FILENAME
    path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    return manifest["bundle_manifest_sha256"]


def test_bundle_manifest_is_deterministic_and_verifies_all_rf_members(tmp_path):
    expected = _write_valid_rf_bundle(tmp_path)
    verified = verify_bundle(tmp_path, expected)

    assert verified["manifest_sha256"] == expected
    assert set(verified["members"]) == {"model", "label_encoder", "metadata", "evaluation_report"}
    assert all(path.is_file() for path in verified["members"].values())


@pytest.mark.parametrize("member", ["model.pkl", "label_encoder.pkl", "metadata.json", "evaluation_report.json"])
def test_one_byte_mutation_of_any_member_is_rejected(tmp_path, member):
    expected = _write_valid_rf_bundle(tmp_path)
    path = tmp_path / member
    path.write_bytes(path.read_bytes() + b"x")

    with pytest.raises(ArtifactBundleError, match="(size|hash) mismatch"):
        verify_bundle(tmp_path, expected)


def test_bundle_requires_trusted_external_manifest_hash(tmp_path):
    _write_valid_rf_bundle(tmp_path)
    with pytest.raises(ArtifactBundleError, match="expected_manifest_sha256"):
        verify_bundle(tmp_path, "")
    with pytest.raises(ArtifactBundleError, match="trusted expected hash"):
        verify_bundle(tmp_path, "b" * 64)


def test_integrity_verification_does_not_qualify_unqualified_artifacts_for_serving(tmp_path):
    expected = _write_valid_rf_bundle(tmp_path, serving_qualified=False)

    verified = verify_bundle(tmp_path, expected, require_serving_qualified=False)
    assert verified["manifest"]["serving_qualified"] is False
    with pytest.raises(ArtifactBundleError, match="not serving-qualified"):
        verify_bundle(tmp_path, expected)


def test_missing_encoder_is_rejected_without_filename_guessing(tmp_path):
    expected = _write_valid_rf_bundle(tmp_path)
    (tmp_path / "label_encoder.pkl").unlink()

    with pytest.raises(ArtifactBundleError, match="missing or unsafe"):
        verify_bundle(tmp_path, expected)


def test_metadata_with_placeholder_training_sha_cannot_build_bundle(tmp_path):
    _write_valid_rf_bundle(tmp_path)
    with pytest.raises(ArtifactBundleError, match="40-character Git SHA"):
        build_bundle_manifest(
            tmp_path,
            bundle_id="bundle-placeholder",
            architecture="RandomForest",
            model_version="rf-test-v1",
            feature_schema_version=FEATURE_SCHEMA_VERSION,
            feature_names=FEATURE_NAMES,
            target_classes=BasePredictor.TARGET_CLASSES,
            training_data_hash=DATA_HASH,
            training_code_git_sha="auto-trained-baseline",
            training_timestamp=TRAINED_AT,
            dataset_lineage=LINEAGE,
            python_version="3.12.3",
            framework_versions={"scikit-learn": "1.7.2"},
            evaluation_report_id="eval-run-17",
            evaluation_report_sha256=hashlib.sha256((tmp_path / "evaluation_report.json").read_bytes()).hexdigest(),
        )


def test_wrong_metadata_identity_is_rejected_after_file_hash_checks(tmp_path):
    expected = _write_valid_rf_bundle(tmp_path)
    metadata_path = tmp_path / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["target_classes"] = list(reversed(metadata["target_classes"]))
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    # A manifest cannot be re-signed from mismatched metadata without also
    # changing the pinned expected digest at the trust boundary.
    with pytest.raises(ArtifactBundleError):
        verify_bundle(tmp_path, expected)


def test_manifest_rejects_traversal_and_missing_bundle_members(tmp_path):
    expected = _write_valid_rf_bundle(tmp_path)
    manifest_path = tmp_path / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifact_files"][0]["filename"] = "../label_encoder.pkl"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ArtifactBundleError):
        verify_bundle(tmp_path, expected)

    (tmp_path / "label_encoder.pkl").unlink(missing_ok=True)
    with pytest.raises(ArtifactBundleError):
        build_bundle_manifest(
            tmp_path,
            bundle_id="bundle-missing",
            architecture="RandomForest",
            model_version="rf-test-v1",
            feature_schema_version=FEATURE_SCHEMA_VERSION,
            feature_names=FEATURE_NAMES,
            target_classes=BasePredictor.TARGET_CLASSES,
            training_data_hash=DATA_HASH,
            training_code_git_sha=GIT_SHA,
            training_timestamp=TRAINED_AT,
            dataset_lineage=LINEAGE,
            python_version="3.12.3",
            framework_versions={"scikit-learn": "1.7.2"},
            evaluation_report_id="eval-run-17",
            evaluation_report_sha256=hashlib.sha256((tmp_path / "evaluation_report.json").read_bytes()).hexdigest(),
        )


def test_verified_copy_rejects_mutation_after_initial_verification(tmp_path):
    from model.artifacts.bundle import materialize_verified_bundle

    expected = _write_valid_rf_bundle(tmp_path)
    verified = verify_bundle(tmp_path, expected)
    (tmp_path / "model.pkl").write_bytes(b"mutated-after-verify")

    with pytest.raises(ArtifactBundleError, match="changed during verified copy"):
        materialize_verified_bundle(verified)


def test_bundle_rejects_unmanifested_files(tmp_path):
    expected = _write_valid_rf_bundle(tmp_path)
    (tmp_path / "candidate-encoder.pkl").write_bytes(b"unbound")

    with pytest.raises(ArtifactBundleError, match="unmanifested"):
        verify_bundle(tmp_path, expected)


def test_local_artifact_store_is_immutable_and_reverifies_every_read(tmp_path):
    source = tmp_path / "source"
    expected = _write_valid_rf_bundle(source)
    store = LocalArtifactStore(tmp_path / "shared")

    result = store.put_bundle(source, expected)
    stored = store.get_bundle(result["bundle_id"], expected)
    assert verify_bundle(stored, expected)["manifest_sha256"] == expected
    assert store.exists(result["bundle_id"], expected)

    (stored / "model.pkl").chmod(0o600)
    (stored / "model.pkl").write_bytes(b"tampered")
    assert not store.exists(result["bundle_id"], expected)
    with pytest.raises(ArtifactBundleError):
        store.get_bundle(result["bundle_id"], expected)


def test_production_artifact_store_cannot_fall_back_to_local_disk(tmp_path):
    with pytest.raises(ArtifactStoreError, match="shared Mongo/GridFS"):
        get_artifact_store("production", database=None, local_root=tmp_path)

    assert isinstance(get_artifact_store("test", local_root=tmp_path), LocalArtifactStore)
