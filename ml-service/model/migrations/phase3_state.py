"""Explicit Phase-3 Mongo schema migration and read-only startup checks.

The application must never create or repair these indexes during startup. Run
``scripts/migrate_phase3_state.py`` as a controlled deployment step first.
"""

from __future__ import annotations

from collections import Counter
from typing import Any


MIGRATION_ID = "phase3_shared_state"
MIGRATION_VERSION = 2
DEFAULT_VECTOR_COLLECTION = "vector_chunks"
DEFAULT_GRIDFS_BUCKET = "model_artifacts"


class Phase3MigrationError(RuntimeError):
    """Raised when Phase-3 schema migration or readiness verification fails."""


def _required_indexes(vector_collection: str, gridfs_bucket: str) -> dict[str, list[dict[str, Any]]]:
    return {
        "model_versions": [
            {"name": "version_id_1", "key": [("version_id", 1)], "unique": True},
            {"name": "model_architecture_1", "key": [("model_architecture", 1)]},
            {
                "name": "uniq_active_model_per_architecture",
                "key": [("model_architecture", 1)],
                "unique": True,
                "partialFilterExpression": {"is_active": True},
            },
            {"name": "registered_at_-1", "key": [("registered_at", -1)]},
            {
                "name": "uniq_architecture_bundle_identity",
                "key": [("model_architecture", 1), ("bundle_id", 1)],
                "unique": True,
                "partialFilterExpression": {"bundle_id": {"$type": "string"}},
            },
        ],
        "model_evaluation_evidence": [
            {"name": "uniq_evaluation_run_id", "key": [("evaluation_run_id", 1)], "unique": True},
            {"name": "candidate_bundle_hash_1", "key": [("candidate_bundle_hash", 1)]},
        ],
        "rag_document_revisions": [
            {"name": "uniq_document_revision_id", "key": [("document_revision_id", 1)], "unique": True},
            {
                "name": "uniq_document_scope_version",
                "key": [("document_id", 1), ("scope", 1), ("version_number", 1)],
                "unique": True,
            },
            {"name": "document_scope_revision_1", "key": [("document_id", 1), ("scope", 1), ("created_at_utc", -1)]},
            {
                "name": "uniq_active_document_revision",
                "key": [("document_id", 1), ("scope", 1)],
                "unique": True,
                "partialFilterExpression": {"lifecycle_state": "ACTIVE"},
            },
        ],
        "rag_corpus_generations": [
            {"name": "uniq_corpus_generation_id", "key": [("generation_id", 1)], "unique": True},
            {
                "name": "uniq_active_corpus_generation",
                "key": [("active_key", 1)],
                "unique": True,
                "partialFilterExpression": {"is_active": True},
            },
        ],
        vector_collection: [
            {"name": "chunk_id_1", "key": [("chunk_id", 1)], "unique": True},
            {"name": "document_id_1", "key": [("document_id", 1)]},
            {"name": "tenant_id_1", "key": [("tenant_id", 1)]},
            {"name": "scope_1", "key": [("scope", 1)]},
            {"name": "document_revision_id_1", "key": [("document_revision_id", 1)]},
            {"name": "corpus_generation_id_1", "key": [("corpus_generation_id", 1)]},
            {"name": "embedding_identity.model_revision_1", "key": [("embedding_identity.model_revision", 1)]},
        ],
        f"{gridfs_bucket}.files": [
            {
                "name": "uniq_immutable_model_bundle_id",
                "key": [("metadata.bundle_id", 1)],
                "unique": True,
            },
            {"name": "idx_gridfs_filename_upload_date", "key": [("filename", 1), ("uploadDate", 1)]},
        ],
        f"{gridfs_bucket}.chunks": [
            {
                "name": "files_id_1_n_1",
                "key": [("files_id", 1), ("n", 1)],
                "unique": True,
            },
        ],
    }


def _index_matches(actual: dict[str, Any] | None, expected: dict[str, Any]) -> bool:
    if actual is None or actual.get("key") != expected["key"]:
        return False
    if "unique" in expected and bool(actual.get("unique", False)) != expected["unique"]:
        return False
    if "partialFilterExpression" in expected and actual.get("partialFilterExpression") != expected[
        "partialFilterExpression"
    ]:
        return False
    return True


def _migration_record(database: Any) -> dict[str, Any] | None:
    return database["ml_schema_migrations"].find_one({"_id": MIGRATION_ID})


def verify_phase3_state(
    database: Any,
    *,
    vector_collection: str = DEFAULT_VECTOR_COLLECTION,
    gridfs_bucket: str = DEFAULT_GRIDFS_BUCKET,
) -> None:
    """Verify migration marker and required index definitions without writes."""
    record = _migration_record(database)
    if not record or record.get("version") != MIGRATION_VERSION:
        raise Phase3MigrationError(
            "required Phase-3 shared-state migration is missing or outdated; "
            "run scripts/migrate_phase3_state.py before starting the ML service"
        )

    for collection_name, expected_indexes in _required_indexes(vector_collection, gridfs_bucket).items():
        actual_indexes = database[collection_name].index_information()
        for expected in expected_indexes:
            actual = actual_indexes.get(expected["name"])
            if not _index_matches(actual, expected):
                raise Phase3MigrationError(
                    f"required Phase-3 index {collection_name}.{expected['name']} is missing or incompatible"
                )


def _reject_duplicate_active_versions(database: Any) -> None:
    counts: Counter[str] = Counter()
    for record in database["model_versions"].find(
        {"is_active": True}, {"_id": 0, "model_architecture": 1}
    ):
        architecture = record.get("model_architecture")
        if not isinstance(architecture, str) or not architecture.strip():
            raise Phase3MigrationError("active model record has no valid architecture")
        counts[architecture] += 1
    duplicates = sorted(architecture for architecture, count in counts.items() if count > 1)
    if duplicates:
        raise Phase3MigrationError(
            "cannot install unique active-model invariant; duplicate active architectures: "
            + ", ".join(duplicates)
        )


def migrate_phase3_state(
    database: Any,
    *,
    vector_collection: str = DEFAULT_VECTOR_COLLECTION,
    gridfs_bucket: str = DEFAULT_GRIDFS_BUCKET,
) -> None:
    """Apply the idempotent Phase-3 shared-state schema migration.

    Existing lifecycle labels are backfilled only when absent. The unique
    partial index is installed after a duplicate-active preflight; the marker
    is written last so an interrupted migration is safe to rerun.
    """
    record = _migration_record(database)
    if record and record.get("version", 0) > MIGRATION_VERSION:
        raise Phase3MigrationError("database Phase-3 schema is newer than this migration runner")

    _reject_duplicate_active_versions(database)

    versions = database["model_versions"]
    versions.update_many(
        {"lifecycle_state": {"$exists": False}, "is_active": True},
        {"$set": {"lifecycle_state": "ACTIVE"}},
    )
    versions.update_many(
        {"is_active": True, "activation_generation": {"$exists": False}},
        {"$set": {"activation_generation": 1}},
    )
    versions.update_many(
        {"is_active": {"$ne": True}, "activation_generation": {"$exists": False}},
        {"$set": {"activation_generation": 0}},
    )
    versions.update_many(
        {"lifecycle_state": {"$exists": False}, "is_active": {"$ne": True}},
        {"$set": {"lifecycle_state": "CANDIDATE"}},
    )

    for collection_name, expected_indexes in _required_indexes(vector_collection, gridfs_bucket).items():
        collection = database[collection_name]
        for expected in expected_indexes:
            options = {key: value for key, value in expected.items() if key not in {"name", "key"}}
            collection.create_index(expected["key"], name=expected["name"], **options)

    database["ml_schema_migrations"].update_one(
        {"_id": MIGRATION_ID},
        {"$set": {"version": MIGRATION_VERSION}},
        upsert=True,
    )
    verify_phase3_state(database, vector_collection=vector_collection, gridfs_bucket=gridfs_bucket)
