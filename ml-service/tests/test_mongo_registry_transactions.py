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
