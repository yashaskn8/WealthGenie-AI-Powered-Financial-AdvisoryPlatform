"""Mongo registry tests for bundle-only writes and fail-closed startup."""

import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import mongomock
import pytest

TEST_MONGO_URI = "mongodb://localhost:27017"
TEST_DB_NAME = "wealthgenie_test_registry"


def _verified_rf_bundle(bundle_dir: Path, bundle_id: str, *, serving_qualified: bool = True):
    from model.architecture.base import BasePredictor
    from model.artifacts.bundle import build_bundle_manifest, verify_bundle, write_json_lf
    from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION

    bundle_dir.mkdir(parents=True)
    (bundle_dir / "model.pkl").write_bytes(b"fixture-model-bytes")
    (bundle_dir / "label_encoder.pkl").write_bytes(b"fixture-encoder-bytes")
    training_hash = hashlib.sha256(b"mongo-registry-training-data").hexdigest()
    git_sha = "a" * 40
    timestamp = "2026-09-25T12:00:00+00:00"
    lineage = {
        "generator": "mongo-registry-test-fixture",
        "generation_parameters": {"seed": 17, "rows": 60},
        "split_identity": {
            name: hashlib.sha256(name.encode()).hexdigest()
            for name in ("train_indices_sha256", "validation_indices_sha256", "test_indices_sha256")
        },
    }
    report = {"evaluation_run_id": f"eval-{bundle_id}", "metrics": {"macro_f1": 0.8}}
    write_json_lf(bundle_dir / "evaluation_report.json", report)
    report_hash = hashlib.sha256((bundle_dir / "evaluation_report.json").read_bytes()).hexdigest()
    write_json_lf(bundle_dir / "metadata.json", {
        "model_name": "RandomForest",
        "model_version": bundle_id,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": FEATURE_NAMES,
        "target_classes": BasePredictor.TARGET_CLASSES,
        "training_data_hash": training_hash,
        "training_code_git_sha": git_sha,
        "training_timestamp": timestamp,
        "dataset_lineage": lineage,
    })
    manifest = build_bundle_manifest(
        bundle_dir,
        bundle_id=bundle_id,
        architecture="RandomForest",
        model_version=bundle_id,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        feature_names=FEATURE_NAMES,
        target_classes=BasePredictor.TARGET_CLASSES,
        training_data_hash=training_hash,
        training_code_git_sha=git_sha,
        training_timestamp=timestamp,
        dataset_lineage=lineage,
        python_version="3.12.3",
        framework_versions={"scikit-learn": "test", "joblib": "test"},
        evaluation_report_id=report["evaluation_run_id"],
        evaluation_report_sha256=report_hash,
        serving_qualified=serving_qualified,
    )
    write_json_lf(bundle_dir / "bundle.manifest.json", manifest)
    verified = verify_bundle(bundle_dir, manifest["bundle_manifest_sha256"])
    verified["bundle_dir"] = str(bundle_dir)
    return verified


@pytest.fixture
def mock_mongo_client():
    client = mongomock.MongoClient(TEST_MONGO_URI)
    yield client
    client.close()


@pytest.fixture
def registry(mock_mongo_client):
    from model.migrations.phase3_state import migrate_phase3_state
    from model.registry.mongo_registry_store import MongoModelRegistry

    migrate_phase3_state(mock_mongo_client[TEST_DB_NAME])
    with patch("model.registry.mongo_registry_store.MongoClient", return_value=mock_mongo_client):
        reg = MongoModelRegistry(mongo_uri=TEST_MONGO_URI, db_name=TEST_DB_NAME)

        @contextmanager
        def mongomock_transaction():
            yield None

        reg._transaction = mongomock_transaction
        yield reg
        reg.close()


class TestMongoModelRegistry:
    def test_unbundled_candidate_registration_is_rejected_in_shared_mongo(self, registry, tmp_path):
        artifact = tmp_path / "raw-model.pkl"
        artifact.write_bytes(b"raw model payload")
        attempts = [
            {},
            {"set_active": True, "expected_active_version_id": None},
            {
                "bundle_id": "spoofed-bundle",
                "bundle_path": tmp_path,
                "bundle_manifest_sha256": "a" * 64,
            },
        ]
        for options in attempts:
            with pytest.raises(ValueError, match="raw model registration is disabled"):
                registry.register_model(
                    model_architecture="RandomForest",
                    artifact_path=artifact,
                    training_data_hash="b" * 64,
                    training_timestamp="2026-09-25T12:00:00Z",
                    hyperparameters={},
                    metrics={"accuracy": 0.99},
                    **options,
                )
        assert registry.list_versions() == []
        assert registry.get_active_model() is None

    def test_complete_verified_bundle_registers_candidate_and_replays_across_registry(self, registry, mock_mongo_client, tmp_path):
        from model.artifacts.store import LocalArtifactStore
        from model.registry.mongo_registry_store import MongoModelRegistry

        verified = _verified_rf_bundle(tmp_path / "candidate", f"rf-candidate-{uuid4().hex}")
        artifact_store = LocalArtifactStore(tmp_path / "artifact-store")
        registry.artifact_store = artifact_store
        candidate = registry.register_verified_bundle(verified, artifact_store)
        assert candidate["bundle_id"] == verified["manifest"]["bundle_id"]
        assert candidate["bundle_manifest_sha256"] == verified["manifest_sha256"]
        assert candidate["artifact_path"] is None
        assert candidate["artifact_store_backend"] == "local_filesystem"
        assert candidate["lifecycle_state"] == "CANDIDATE"
        assert candidate["is_active"] is False

        with patch("model.registry.mongo_registry_store.MongoClient", return_value=mock_mongo_client):
            replica = MongoModelRegistry(mongo_uri=TEST_MONGO_URI, db_name=TEST_DB_NAME)
        try:
            recovered = replica.get_version(candidate["version_id"])
            assert recovered["bundle_id"] == candidate["bundle_id"]
            assert recovered["bundle_manifest_sha256"] == candidate["bundle_manifest_sha256"]
            assert recovered["lifecycle_state"] == "CANDIDATE"
        finally:
            replica.close()

    def test_mongo_registry_rejects_metrics_from_substituted_report_path(self, registry, tmp_path):
        from model.artifacts.store import LocalArtifactStore

        verified = _verified_rf_bundle(tmp_path / "candidate", f"rf-report-tamper-{uuid4().hex}")
        substituted = tmp_path / "evaluation_report.json"
        substituted.write_text(
            json.dumps({
                "evaluation_run_id": verified["manifest"]["evaluation_report_id"],
                "architecture": "RandomForest",
                "training_data_hash": verified["manifest"]["training_data_hash"],
                "metrics": {"macro_f1": 0.999},
            }),
            encoding="utf-8",
        )
        verified["members"]["evaluation_report"] = substituted
        artifact_store = LocalArtifactStore(tmp_path / "report-tamper-artifacts")

        with pytest.raises(ValueError, match="evaluation report bytes do not match"):
            registry.register_verified_bundle(verified, artifact_store)

        assert registry.list_versions("RandomForest") == []

    def test_bundle_registry_lists_versions_and_detects_stored_member_tampering(self, registry, tmp_path):
        from model.artifacts.store import LocalArtifactStore

        artifact_store = LocalArtifactStore(tmp_path / "artifact-store")
        registry.artifact_store = artifact_store
        candidates = []
        for index in range(3):
            bundle = _verified_rf_bundle(
                tmp_path / f"candidate-{index}", f"rf-list-{index}-{uuid4().hex}"
            )
            candidates.append(registry.register_verified_bundle(bundle, artifact_store))

        listed = registry.list_versions("RandomForest")
        assert {row["version_id"] for row in listed} == {row["version_id"] for row in candidates}
        target = candidates[0]
        bundle_dir = artifact_store.get_bundle(target["bundle_id"], target["bundle_manifest_sha256"])
        assert registry.verify_artifact_integrity(target["version_id"])["match"] is True
        model_path = bundle_dir / "model.pkl"
        model_path.write_bytes(model_path.read_bytes() + b"tamper")
        result = registry.verify_artifact_integrity(target["version_id"])
        assert result["integrity"] == "MISSING_OR_TAMPERED"
        assert result["match"] is False

    def test_startup_fails_closed_when_explicit_migration_was_not_run(self):
        from model.migrations.phase3_state import Phase3MigrationError
        from model.registry.mongo_registry_store import MongoModelRegistry

        client = mongomock.MongoClient(TEST_MONGO_URI)
        try:
            with patch("model.registry.mongo_registry_store.MongoClient", return_value=client):
                with pytest.raises(Phase3MigrationError, match="migration is missing"):
                    MongoModelRegistry(mongo_uri=TEST_MONGO_URI, db_name=TEST_DB_NAME + "_unmigrated")
            assert "version_id_1" not in client[TEST_DB_NAME + "_unmigrated"]["model_versions"].index_information()
        finally:
            client.close()
