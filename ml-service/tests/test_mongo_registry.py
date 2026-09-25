"""
Integration tests for MongoModelRegistry.

Verifies the MongoDB-backed model registry implements the same interface as
the SQLite ModelRegistry and supports cross-replica shared state.
Uses mongomock for deterministic in-process testing.
"""

import os
import tempfile
from contextlib import contextmanager
import pytest
from pathlib import Path
from unittest.mock import patch

import mongomock

TEST_MONGO_URI = "mongodb://localhost:27017"
TEST_DB_NAME = "wealthgenie_test_registry"


def _create_temp_artifact(content: str = "model-weights-binary-data") -> Path:
    """Create a temporary file to act as a model artifact."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pkl")
    tmp.write(content.encode("utf-8"))
    tmp.close()
    return Path(tmp.name)


@pytest.fixture
def mock_mongo_client():
    """Provides a shared in-memory MongoClient mock across registry instances."""
    client = mongomock.MongoClient(TEST_MONGO_URI)
    yield client
    client.close()


@pytest.fixture
def registry(mock_mongo_client):
    """Create a MongoModelRegistry backed by the shared mongomock client."""
    from model.migrations.phase3_state import migrate_phase3_state
    from model.registry.mongo_registry_store import MongoModelRegistry
    migrate_phase3_state(mock_mongo_client[TEST_DB_NAME])
    with patch("model.registry.mongo_registry_store.MongoClient", return_value=mock_mongo_client):
        reg = MongoModelRegistry(mongo_uri=TEST_MONGO_URI, db_name=TEST_DB_NAME)
        # mongomock has no transaction implementation. The replica-set
        # integration test exercises the real transaction boundary in CI.
        @contextmanager
        def mongomock_transaction():
            yield None

        reg._transaction = mongomock_transaction
        yield reg
        reg.close()


class TestMongoModelRegistry:
    """Tests for MongoModelRegistry CRUD operations."""

    def test_register_verified_bundle_persists_pinned_bundle_identity(self, registry, tmp_path):
        artifact = tmp_path / "model.bin"
        artifact.write_bytes(b"verified-model-artifact")
        bundle_dir = tmp_path / "bundle"
        bundle_dir.mkdir()
        manifest_hash = "a" * 64

        version_id = registry.register_model(
            model_architecture="bundle_fixture",
            artifact_path=artifact,
            training_data_hash="b" * 64,
            training_timestamp="2026-09-25T12:00:00+00:00",
            hyperparameters={"feature_schema_version": "fixture-v1"},
            metrics={},
            set_active=True,
            expected_active_version_id=None,
            bundle_id="fixture-bundle-v1",
            bundle_path=bundle_dir,
            bundle_manifest_sha256=manifest_hash,
        )

        active = registry.get_active_model("bundle_fixture")
        assert active["version_id"] == version_id
        assert active["bundle_id"] == "fixture-bundle-v1"
        assert active["bundle_path"] == str(bundle_dir.resolve())
        assert active["bundle_manifest_sha256"] == manifest_hash

    def test_bundle_identity_fields_must_be_complete(self, registry, tmp_path):
        artifact = tmp_path / "model.bin"
        artifact.write_bytes(b"verified-model-artifact")
        bundle_dir = tmp_path / "bundle"
        bundle_dir.mkdir()

        with pytest.raises(ValueError, match="must be provided together"):
            registry.register_model(
                model_architecture="incomplete_bundle_fixture",
                artifact_path=artifact,
                training_data_hash="b" * 64,
                training_timestamp="2026-09-25T12:00:00+00:00",
                hyperparameters={},
                metrics={},
                bundle_id="fixture-bundle-v1",
            )

        assert registry.list_versions("incomplete_bundle_fixture") == []

    def test_register_and_get_version(self, registry):
        artifact = _create_temp_artifact()
        version_id = registry.register_model(
            model_architecture="random_forest",
            artifact_path=artifact,
            training_data_hash="abc123",
            training_timestamp="2025-01-01T00:00:00Z",
            hyperparameters={"n_estimators": 100, "max_depth": 10},
            metrics={"accuracy": 0.92, "f1": 0.89},
            notes="test registration",
        )
        assert version_id is not None

        version = registry.get_version(version_id)
        assert version is not None
        assert version["model_architecture"] == "random_forest"
        assert version["hyperparameters"]["n_estimators"] == 100
        assert version["metrics"]["accuracy"] == 0.92
        assert version["is_active"] is False
        os.unlink(artifact)

    def test_register_with_set_active(self, registry):
        artifact = _create_temp_artifact()
        v1 = registry.register_model(
            model_architecture="mlp",
            artifact_path=artifact,
            training_data_hash="hash1",
            training_timestamp="2025-01-01T00:00:00Z",
            hyperparameters={},
            metrics={"accuracy": 0.85},
            set_active=True,
        )

        active = registry.get_active_model("mlp")
        assert active is not None
        assert active["version_id"] == v1
        assert active["is_active"] is True

        # Register a new active version — should deactivate the first
        v2 = registry.register_model(
            model_architecture="mlp",
            artifact_path=artifact,
            training_data_hash="hash2",
            training_timestamp="2025-02-01T00:00:00Z",
            hyperparameters={},
            metrics={"accuracy": 0.90},
            set_active=True,
        )

        old = registry.get_version(v1)
        new_active = registry.get_active_model("mlp")
        assert old["is_active"] is False
        assert new_active["version_id"] == v2
        os.unlink(artifact)

    def test_activation_rejects_stale_expected_active_without_mutating_state(self, registry):
        artifact = _create_temp_artifact("activation-cas")
        current = registry.register_model(
            model_architecture="activation_cas",
            artifact_path=artifact,
            training_data_hash="hash1",
            training_timestamp="2025-01-01T00:00:00Z",
            hyperparameters={},
            metrics={},
            set_active=True,
            expected_active_version_id=None,
        )

        from model.registry.mongo_registry_store import ModelActivationConflict
        with pytest.raises(ModelActivationConflict, match="active model changed"):
            registry.register_model(
                model_architecture="activation_cas",
                artifact_path=artifact,
                training_data_hash="hash2",
                training_timestamp="2025-02-01T00:00:00Z",
                hyperparameters={},
                metrics={},
                set_active=True,
                expected_active_version_id="stale-version",
            )

        assert registry.get_active_model("activation_cas")["version_id"] == current
        assert len(registry.list_versions("activation_cas")) == 1
        os.unlink(artifact)

    def test_list_versions(self, registry):
        artifact = _create_temp_artifact()
        for i in range(3):
            registry.register_model(
                model_architecture="rf",
                artifact_path=artifact,
                training_data_hash=f"hash{i}",
                training_timestamp=f"2025-0{i+1}-01T00:00:00Z",
                hyperparameters={"version": i},
                metrics={"acc": 0.80 + i * 0.05},
            )

        versions = registry.list_versions("rf")
        assert len(versions) == 3

        all_versions = registry.list_versions()
        assert len(all_versions) == 3
        os.unlink(artifact)

    def test_rollback_to_version(self, registry):
        artifact = _create_temp_artifact("artifact-data-v1")
        v1 = registry.register_model(
            model_architecture="rf",
            artifact_path=artifact,
            training_data_hash="h1",
            training_timestamp="2025-01-01T00:00:00Z",
            hyperparameters={},
            metrics={"acc": 0.8},
            set_active=True,
        )
        v2 = registry.register_model(
            model_architecture="rf",
            artifact_path=artifact,
            training_data_hash="h2",
            training_timestamp="2025-02-01T00:00:00Z",
            hyperparameters={},
            metrics={"acc": 0.9},
            set_active=True,
        )

        # v1 should now be inactive
        assert registry.get_version(v1)["is_active"] is False

        # Legacy single-file rows cannot be activated as trusted model bundles.
        with pytest.raises(ValueError, match="complete verified immutable model bundle"):
            registry.rollback_to_version(v1)

        # A rejected rollback leaves the active pointer unchanged.
        assert registry.get_active_model("rf")["version_id"] == v2
        assert registry.get_version(v2)["is_active"] is True
        os.unlink(artifact)

    def test_verify_artifact_integrity(self, registry):
        artifact = _create_temp_artifact("integrity-test-content")
        vid = registry.register_model(
            model_architecture="rf",
            artifact_path=artifact,
            training_data_hash="h1",
            training_timestamp="2025-01-01T00:00:00Z",
            hyperparameters={},
            metrics={},
        )

        result = registry.verify_artifact_integrity(vid)
        assert result["integrity"] == "VERIFIED"
        assert result["match"] is True

        # Tamper with the artifact
        with open(artifact, "w") as f:
            f.write("TAMPERED CONTENT")

        tampered = registry.verify_artifact_integrity(vid)
        assert tampered["integrity"] == "TAMPERED"
        assert tampered["match"] is False
        os.unlink(artifact)

    def test_cross_replica_read(self, registry, mock_mongo_client):
        """
        CROSS-REPLICA PROOF: Write with one instance, create a second
        MongoModelRegistry instance sharing the same MongoDB connection,
        and verify it reads the same data.
        """
        artifact = _create_temp_artifact("cross-replica-test")
        vid = registry.register_model(
            model_architecture="cross_test",
            artifact_path=artifact,
            training_data_hash="cross_hash",
            training_timestamp="2025-06-01T00:00:00Z",
            hyperparameters={"replica": 1},
            metrics={"accuracy": 0.95},
            set_active=True,
        )

        # Create a SECOND registry instance (sharing the same database)
        from model.registry.mongo_registry_store import MongoModelRegistry
        with patch("model.registry.mongo_registry_store.MongoClient", return_value=mock_mongo_client):
            replica2 = MongoModelRegistry(mongo_uri=TEST_MONGO_URI, db_name=TEST_DB_NAME)

        version = replica2.get_version(vid)
        assert version is not None
        assert version["model_architecture"] == "cross_test"
        assert version["hyperparameters"]["replica"] == 1
        assert version["is_active"] is True

        active = replica2.get_active_model("cross_test")
        assert active is not None
        assert active["version_id"] == vid

        replica2.close()
        os.unlink(artifact)

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
