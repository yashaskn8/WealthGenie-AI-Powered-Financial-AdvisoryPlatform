"""Replica-set integration proof for atomic model activation.

Set ML_TEST_MONGODB_URI to a transaction-capable MongoDB URI to run locally or
in CI. This suite intentionally skips rather than simulating transactions.
"""

from __future__ import annotations

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from pymongo import MongoClient
from bson import Binary

from model.migrations.phase3_state import migrate_phase3_state
from model.registry.mongo_registry_store import ModelActivationConflict, MongoModelRegistry


@pytest.mark.skipif(
    not os.environ.get("ML_TEST_MONGODB_URI"),
    reason="requires a transaction-capable MongoDB replica set",
)
def test_concurrent_model_activation_is_atomic_and_expected_version_fenced():
    uri = os.environ["ML_TEST_MONGODB_URI"]
    database_name = f"wealthgenie_phase3_activation_{uuid4().hex}"
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    artifact_file = tempfile.NamedTemporaryFile(delete=False)
    artifact_file.write(b"transactional-fixture-model")
    artifact_file.close()
    architecture = f"transaction-race-{uuid4().hex}"
    registries: list[MongoModelRegistry] = []
    try:
        client.admin.command("ping")
        database = client[database_name]
        migrate_phase3_state(database)

        first = MongoModelRegistry(uri, db_name=database_name)
        registries.append(first)
        initial = first.register_model(
            model_architecture=architecture,
            artifact_path=Path(artifact_file.name),
            training_data_hash="fixture",
            training_timestamp="2026-01-01T00:00:00Z",
            hyperparameters={},
            metrics={},
            set_active=True,
            expected_active_version_id=None,
        )

        barrier = Barrier(2)

        def promote(candidate: str):
            registry = MongoModelRegistry(uri, db_name=database_name)
            registries.append(registry)
            barrier.wait(timeout=10)
            try:
                return registry.register_model(
                    model_architecture=architecture,
                    artifact_path=Path(artifact_file.name),
                    training_data_hash=candidate,
                    training_timestamp="2026-01-02T00:00:00Z",
                    hyperparameters={"candidate": candidate},
                    metrics={},
                    set_active=True,
                    expected_active_version_id=initial,
                )
            except ModelActivationConflict:
                return "CONFLICT"

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(promote, ("candidate-a", "candidate-b")))

        assert sum(result != "CONFLICT" for result in results) == 1
        assert results.count("CONFLICT") == 1
        active = list(database["model_versions"].find({"model_architecture": architecture, "is_active": True}))
        assert len(active) == 1
        assert active[0]["version_id"] in results
        assert database["model_versions"].count_documents({"model_architecture": architecture}) == 2
    finally:
        for registry in registries:
            registry.close()
        client.drop_database(database_name)
        client.close()
        os.unlink(artifact_file.name)


@pytest.mark.skipif(
    not os.environ.get("ML_TEST_MONGODB_URI"),
    reason="requires a transaction-capable MongoDB replica set",
)
def test_trusted_gridfs_bootstrap_is_idempotent_and_survives_replica_restart(monkeypatch):
    """Cold start, restart, and corruption checks use shared Mongo/GridFS state."""
    from model.artifacts.store import MongoGridFSArtifactStore
    from model.migrations.phase3_state import migrate_phase3_state
    from model.serving.control_plane import ModelReconciliationError, ensure_active_model_loaded
    from model.serving import registry as serving_registry
    from scripts.verify_serving_artifacts import verify_trusted_serving_bundles

    uri = os.environ["ML_TEST_MONGODB_URI"]
    database_name = f"wealthgenie_phase3_bootstrap_{uuid4().hex}"
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    registries: list[MongoModelRegistry] = []
    original_predictors = dict(serving_registry.registry._registry)
    try:
        client.admin.command("ping")
        database = client[database_name]
        migrate_phase3_state(database)
        trusted_bundles = verify_trusted_serving_bundles(Path(__file__).resolve().parents[1])

        first_replica = MongoModelRegistry(uri, db_name=database_name)
        registries.append(first_replica)
        first_replica.artifact_store = MongoGridFSArtifactStore(first_replica.database)
        initial = first_replica.bootstrap_verified_bundles(trusted_bundles, first_replica.artifact_store)

        assert set(initial) == {"RandomForest", "PyTorch_MLP", "FT_Transformer"}
        for architecture, record in initial.items():
            assert record["artifact_path"] is None
            assert record["artifact_store_backend"] == "mongodb_gridfs"
            assert record["activation_generation"] == 1
            assert database["model_versions"].count_documents({"model_architecture": architecture}) == 1

        repeated = first_replica.bootstrap_verified_bundles(trusted_bundles, first_replica.artifact_store)
        assert {
            name: (row["version_id"], row["bundle_id"], row["bundle_manifest_sha256"], row["activation_generation"])
            for name, row in repeated.items()
        } == {
            name: (row["version_id"], row["bundle_id"], row["bundle_manifest_sha256"], row["activation_generation"])
            for name, row in initial.items()
        }
        assert database["model_versions"].count_documents({}) == 3
        assert database["model_artifacts.files"].count_documents({}) == 3

        monkeypatch.setattr(serving_registry.registry, "_registry", {})
        monkeypatch.setattr(serving_registry.registry, "_version_registry", first_replica)
        first_loaded = ensure_active_model_loaded("RandomForest")
        rf_record = initial["RandomForest"]
        assert first_loaded.loaded_version_id == rf_record["version_id"]
        assert first_loaded.loaded_bundle_id == rf_record["bundle_id"]
        assert first_loaded.loaded_bundle_hash == rf_record["bundle_manifest_sha256"]
        assert first_loaded.is_loaded

        # Simulate a fresh process: no in-memory predictor, a separate registry
        # client, and the same shared database/GridFS objects.
        serving_registry.registry._registry.clear()
        second_replica = MongoModelRegistry(uri, db_name=database_name)
        registries.append(second_replica)
        second_replica.artifact_store = MongoGridFSArtifactStore(second_replica.database)
        monkeypatch.setattr(serving_registry.registry, "_version_registry", second_replica)
        restarted = ensure_active_model_loaded("RandomForest")
        assert restarted.loaded_version_id == first_loaded.loaded_version_id
        assert restarted.loaded_bundle_id == first_loaded.loaded_bundle_id
        assert restarted.loaded_bundle_hash == first_loaded.loaded_bundle_hash
        assert restarted.loaded_activation_generation == first_loaded.loaded_activation_generation

        # Corrupt the shared archive after clearing process-local model state.
        # Bundle verification must fail before executable pickle deserialization.
        serving_registry.registry._registry.clear()
        rf_bundle_id = rf_record["bundle_id"]
        file_record = database["model_artifacts.files"].find_one({"metadata.bundle_id": rf_bundle_id})
        assert file_record is not None
        chunk = database["model_artifacts.chunks"].find_one({"files_id": file_record["_id"]})
        assert chunk is not None
        corrupted = bytes(chunk["data"])
        database["model_artifacts.chunks"].update_one(
            {"_id": chunk["_id"]},
            {"$set": {"data": Binary(bytes([corrupted[0] ^ 1]) + corrupted[1:])}},
        )
        import model.serving.inference
        monkeypatch.setattr(
            model.serving.inference.joblib,
            "load",
            lambda *_args, **_kwargs: pytest.fail("corrupt GridFS bundle must not be deserialized"),
        )
        with pytest.raises(ModelReconciliationError):
            ensure_active_model_loaded("RandomForest")
        assert serving_registry.registry.get("random_forest") is None
    finally:
        serving_registry.registry._registry.clear()
        serving_registry.registry._registry.update(original_predictors)
        for registry in registries:
            registry.close()
        client.drop_database(database_name)
        client.close()
