"""Explicit and repeatable Phase-3 Mongo state migration contract tests."""

import os
import subprocess
import sys
from pathlib import Path

import mongomock
import pytest
from pymongo.errors import DuplicateKeyError

from model.migrations.phase3_state import (
    Phase3MigrationError,
    migrate_phase3_state,
    verify_phase3_state,
)


ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = ML_SERVICE_ROOT.parent
MIGRATION_SCRIPT = ML_SERVICE_ROOT / "scripts" / "migrate_phase3_state.py"


@pytest.mark.parametrize(
    "working_directory",
    [REPOSITORY_ROOT, ML_SERVICE_ROOT],
    ids=["repository-root", "ml-service-root"],
)
def test_phase3_migration_cli_reports_missing_uri_without_import_error(working_directory):
    environment = os.environ.copy()
    environment.pop("MONGODB_URI", None)
    environment.pop("MONGO_URI", None)
    environment.pop("PYTHONPATH", None)

    result = subprocess.run(
        [sys.executable, str(MIGRATION_SCRIPT)],
        cwd=working_directory,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )

    assert result.returncode == 2
    assert "MONGODB_URI is required" in result.stderr
    assert "ModuleNotFoundError" not in result.stderr


def test_migration_installs_required_indexes_and_is_idempotent():
    database = mongomock.MongoClient()["phase3_migration"]

    migrate_phase3_state(database)
    first_indexes = {
        name: dict(info)
        for name, info in database["model_versions"].index_information().items()
    }
    migrate_phase3_state(database)

    verify_phase3_state(database)
    assert database["ml_schema_migrations"].find_one({"_id": "phase3_shared_state"})["version"] == 1
    assert first_indexes == {
        name: dict(info)
        for name, info in database["model_versions"].index_information().items()
    }
    active = database["model_versions"].index_information()["uniq_active_model_per_architecture"]
    assert active["unique"] is True
    assert active["partialFilterExpression"] == {"is_active": True}
    assert database["model_artifacts.files"].index_information()["uniq_immutable_model_bundle_id"]["unique"] is True
    database["model_versions"].insert_one(
        {"version_id": "active-a", "model_architecture": "rf", "is_active": True}
    )
    with pytest.raises(DuplicateKeyError):
        database["model_versions"].insert_one(
            {"version_id": "active-b", "model_architecture": "rf", "is_active": True}
        )


def test_migration_refuses_duplicate_active_architectures_before_writing_marker():
    database = mongomock.MongoClient()["phase3_duplicate_active"]
    database["model_versions"].insert_many([
        {"version_id": "a", "model_architecture": "rf", "is_active": True},
        {"version_id": "b", "model_architecture": "rf", "is_active": True},
    ])

    with pytest.raises(Phase3MigrationError, match="duplicate active architectures: rf"):
        migrate_phase3_state(database)

    assert database["ml_schema_migrations"].find_one({"_id": "phase3_shared_state"}) is None
    assert "uniq_active_model_per_architecture" not in database["model_versions"].index_information()


def test_verifier_rejects_missing_index_even_if_migration_marker_exists():
    database = mongomock.MongoClient()["phase3_missing_index"]
    migrate_phase3_state(database)
    database["model_versions"].drop_index("version_id_1")

    with pytest.raises(Phase3MigrationError, match="version_id_1 is missing or incompatible"):
        verify_phase3_state(database)


def test_migration_only_backfills_missing_lifecycle_values():
    database = mongomock.MongoClient()["phase3_lifecycle_backfill"]
    database["model_versions"].insert_many([
        {"version_id": "active", "model_architecture": "rf", "is_active": True},
        {"version_id": "candidate", "model_architecture": "mlp", "is_active": False},
        {"version_id": "preserved", "model_architecture": "ft", "is_active": False, "lifecycle_state": "SHADOW"},
    ])

    migrate_phase3_state(database)

    assert database["model_versions"].find_one({"version_id": "active"})["lifecycle_state"] == "ACTIVE"
    assert database["model_versions"].find_one({"version_id": "candidate"})["lifecycle_state"] == "CANDIDATE"
    assert database["model_versions"].find_one({"version_id": "preserved"})["lifecycle_state"] == "SHADOW"
