"""Replica-set integration proof for atomic model activation.

Set ML_TEST_MONGODB_URI to a transaction-capable MongoDB URI to run locally or
in CI. This suite intentionally skips rather than simulating transactions.
"""

from __future__ import annotations

import os
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
def test_concurrent_model_activation_is_atomic_and_expected_version_fenced(tmp_path):
    from model.artifacts.store import MongoGridFSArtifactStore
    from test_mongo_registry import _verified_rf_bundle

    uri = os.environ["ML_TEST_MONGODB_URI"]
    database_name = f"wealthgenie_phase3_activation_{uuid4().hex}"
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    registries: list[MongoModelRegistry] = []
    try:
        client.admin.command("ping")
        database = client[database_name]
        migrate_phase3_state(database)

        first = MongoModelRegistry(uri, db_name=database_name)
        registries.append(first)
        first.artifact_store = MongoGridFSArtifactStore(database)
        initial_bundle = _verified_rf_bundle(tmp_path / "active", f"rf-active-{uuid4().hex}")
        initial = first.register_verified_bundle(
            initial_bundle, first.artifact_store, activate_if_empty=True
        )
        candidates = []
        for suffix in ("a", "b"):
            bundle = _verified_rf_bundle(tmp_path / f"candidate-{suffix}", f"rf-candidate-{suffix}-{uuid4().hex}")
            candidates.append(first.register_verified_bundle(bundle, first.artifact_store))
            database["model_versions"].update_one(
                {"version_id": candidates[-1]["version_id"], "lifecycle_state": "CANDIDATE"},
                {"$set": {"lifecycle_state": "VALIDATED"}},
            )

        barrier = Barrier(2)

        def promote(candidate: dict):
            registry = MongoModelRegistry(uri, db_name=database_name)
            registries.append(registry)
            barrier.wait(timeout=10)
            try:
                return registry.activate_version(
                    candidate["version_id"],
                    expected_active_version_id=initial["version_id"],
                    expected_activation_generation=initial["activation_generation"],
                )
            except ModelActivationConflict:
                return "CONFLICT"

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(promote, candidates))

        assert sum(result != "CONFLICT" for result in results) == 1
        assert results.count("CONFLICT") == 1
        active = list(database["model_versions"].find({"model_architecture": "RandomForest", "is_active": True}))
        assert len(active) == 1
        assert active[0]["version_id"] in {candidate["version_id"] for candidate in candidates}
        assert database["model_versions"].count_documents({"model_architecture": "RandomForest"}) == 3
    finally:
        for registry in registries:
            registry.close()
        client.drop_database(database_name)
        client.close()


@pytest.mark.skipif(
    not os.environ.get("ML_TEST_MONGODB_URI"),
    reason="requires a transaction-capable MongoDB replica set",
)
def test_unqualified_drift_candidate_bundle_survives_registry_restart_but_cannot_serve(tmp_path, monkeypatch):
    """A durable drift candidate is shared across replicas but remains non-serving."""
    import model.serving.inference
    from model.artifacts.store import MongoGridFSArtifactStore
    from model.registry.mongo_registry_store import MongoModelRegistry
    from model.serving.control_plane import ModelReconciliationError, preload_registered_bundle
    from test_mongo_registry import _verified_rf_bundle

    uri = os.environ["ML_TEST_MONGODB_URI"]
    database_name = f"wealthgenie_phase3_drift_candidate_{uuid4().hex}"
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    registries = []
    try:
        client.admin.command("ping")
        database = client[database_name]
        migrate_phase3_state(database)
        bundle = _verified_rf_bundle(
            tmp_path / "offline-drift-candidate",
            f"rf-drift-candidate-{uuid4().hex}",
            serving_qualified=False,
        )

        trainer_registry = MongoModelRegistry(uri, db_name=database_name)
        registries.append(trainer_registry)
        trainer_registry.artifact_store = MongoGridFSArtifactStore(database)
        candidate = trainer_registry.register_verified_bundle(bundle, trainer_registry.artifact_store)
        assert candidate["artifact_path"] is None
        assert candidate["lifecycle_state"] == "CANDIDATE"

        serving_registry = MongoModelRegistry(uri, db_name=database_name)
        registries.append(serving_registry)
        serving_registry.artifact_store = MongoGridFSArtifactStore(database)
        recovered = serving_registry.get_version(candidate["version_id"])
        stored = serving_registry.artifact_store.get_bundle(
            recovered["bundle_id"], recovered["bundle_manifest_sha256"]
        )
        try:
            from model.artifacts.bundle import ArtifactBundleError

            with pytest.raises(ArtifactBundleError, match="not serving-qualified"):
                serving_registry.artifact_store.verify_bundle(
                    stored, recovered["bundle_manifest_sha256"]
                )
        finally:
            import shutil

            shutil.rmtree(stored.parent, ignore_errors=True)

        monkeypatch.setattr(
            model.serving.inference.joblib,
            "load",
            lambda *_args, **_kwargs: pytest.fail("unqualified candidate must never be deserialized"),
        )
        with pytest.raises(ModelReconciliationError):
            preload_registered_bundle(recovered, serving_registry)
        assert serving_registry.get_version(candidate["version_id"])["lifecycle_state"] == "CANDIDATE"
        assert serving_registry.get_active_model("RandomForest") is None
    finally:
        for registry in registries:
            registry.close()
        client.drop_database(database_name)
        client.close()


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
