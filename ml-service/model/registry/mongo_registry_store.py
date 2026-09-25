"""
WealthGenie ML Model Registry - MongoDB-backed Store

Drop-in replacement for the SQLite-backed ModelRegistry that stores all model
version metadata in MongoDB, enabling shared state across multiple replicas.

Preserves the same public interface and SHA-256 tamper-evident artifact hashing.
"""

import hashlib
import uuid
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pymongo import MongoClient, DESCENDING
from pymongo.errors import ConnectionFailure, DuplicateKeyError, OperationFailure
from model.migrations.phase3_state import verify_phase3_state

logger = logging.getLogger("wealthgenie.registry.mongo")

_ALLOWED_LIFECYCLE_TRANSITIONS = {
    "CANDIDATE": {"SHADOW"},
    "SHADOW": {"VALIDATED"},
}
_UNSET = object()


class ModelActivationConflict(RuntimeError):
    """The active model changed or the atomic activation lost a concurrent race."""


def compute_file_hash(filepath: Path) -> str:
    """Compute SHA-256 hash of a file on disk."""
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()


class MongoModelRegistry:
    """
    MongoDB-backed model registry with tamper-evident hashing.

    Same public interface as the SQLite ModelRegistry so callers can swap
    transparently. Stores model versions as documents in the
    'model_versions' collection.
    """

    def __init__(self, mongo_uri: str, db_name: str = "wealthgenie"):
        self._client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        self._db = self._client[db_name]
        self._collection = self._db["model_versions"]
        try:
            verify_phase3_state(self._db)
            logger.info("MongoModelRegistry verified migrated indexes")
        except ConnectionFailure as e:
            self._client.close()
            logger.error(f"Failed to connect to MongoDB for registry: {e}")
            raise
        except Exception:
            self._client.close()
            raise

    def register_model(
        self,
        model_architecture: str,
        artifact_path: Path,
        training_data_hash: str,
        training_timestamp: str,
        hyperparameters: Dict[str, Any],
        metrics: Dict[str, Any],
        reference_distributions: Optional[Dict[str, Any]] = None,
        notes: Optional[str] = None,
        set_active: bool = False,
        expected_active_version_id: Optional[str] | object = _UNSET,
    ) -> str:
        """
        Register a new model version in the registry.
        Returns the generated version_id (UUID).
        """
        artifact_path = Path(artifact_path)
        if not artifact_path.exists():
            raise FileNotFoundError(f"Artifact file not found: {artifact_path}")

        artifact_hash = compute_file_hash(artifact_path)
        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        doc = {
            "version_id": version_id,
            "model_architecture": model_architecture,
            "training_data_hash": training_data_hash,
            "training_timestamp": training_timestamp,
            "hyperparameters": hyperparameters,
            "metrics": metrics,
            "artifact_path": str(artifact_path),
            "artifact_hash": artifact_hash,
            "reference_distributions": reference_distributions,
            "is_active": set_active,
            "lifecycle_state": "ACTIVE" if set_active else "CANDIDATE",
            "registered_at": now,
            "notes": notes,
        }

        if set_active:
            try:
                with self._transaction() as session:
                    current = self._collection.find_one(
                        {"model_architecture": model_architecture, "is_active": True},
                        {"_id": 0, "version_id": 1},
                        session=session,
                    )
                    current_id = current.get("version_id") if current else None
                    if expected_active_version_id is not _UNSET and current_id != expected_active_version_id:
                        raise ModelActivationConflict(
                            "active model changed before activation; refresh the expected active version"
                        )

                    self._collection.update_many(
                        {"model_architecture": model_architecture, "is_active": True},
                        {"$set": {"is_active": False, "lifecycle_state": "ROLLED_BACK"}},
                        session=session,
                    )
                    self._collection.insert_one(doc, session=session)
            except DuplicateKeyError as exc:
                raise ModelActivationConflict(
                    "another activation won the unique active-model race"
                ) from exc
            except OperationFailure as exc:
                if exc.code == 112:
                    raise ModelActivationConflict(
                        "another activation changed the active model concurrently"
                    ) from exc
                raise
        else:
            self._collection.insert_one(doc)
        logger.info(f"Registered model version {version_id} ({model_architecture})")
        return version_id

    @contextmanager
    def _transaction(self):
        """Open a required Mongo transaction; no standalone-server fallback."""
        with self._client.start_session() as session:
            with session.start_transaction():
                yield session

    def update_lifecycle_state(self, version_id: str, lifecycle_state: str, metrics=None) -> Dict[str, Any]:
        current = self.get_version(version_id)
        if current is None:
            raise ValueError(f"Version {version_id} not found in registry.")
        allowed = _ALLOWED_LIFECYCLE_TRANSITIONS.get(current["lifecycle_state"], set())
        if lifecycle_state not in allowed:
            raise ValueError(
                f"Invalid model lifecycle transition: {current['lifecycle_state']} -> {lifecycle_state}."
            )
        update = {"lifecycle_state": lifecycle_state}
        if metrics is not None:
            update["metrics"] = metrics
        result = self._collection.update_one(
            {"version_id": version_id, "lifecycle_state": current["lifecycle_state"]},
            {"$set": update},
        )
        if result.matched_count != 1:
            raise RuntimeError("Concurrent model lifecycle transition detected; retry from current state.")
        return self.get_version(version_id)  # type: ignore

    def list_versions(
        self, architecture: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List all registered model versions, optionally filtered by architecture."""
        query = {}
        if architecture:
            query["model_architecture"] = architecture
        cursor = self._collection.find(
            query, {"_id": 0}
        ).sort("registered_at", DESCENDING)
        return [self._clean_doc(doc) for doc in cursor]

    def get_version(self, version_id: str) -> Optional[Dict[str, Any]]:
        """Get a single registered model version by version_id."""
        doc = self._collection.find_one(
            {"version_id": version_id}, {"_id": 0}
        )
        return self._clean_doc(doc) if doc else None

    def get_active_model(
        self, architecture: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Get the currently active model version."""
        query: Dict[str, Any] = {"is_active": True}
        if architecture:
            query["model_architecture"] = architecture
        doc = self._collection.find_one(
            query, {"_id": 0}, sort=[("registered_at", DESCENDING)]
        )
        return self._clean_doc(doc) if doc else None

    def rollback_to_version(
        self,
        version_id: str,
        expected_active_version_id: Optional[str] | object = _UNSET,
    ) -> Dict[str, Any]:
        """
        Roll back the active model to a specific registered version.
        Verifies artifact SHA-256 hash integrity before activation.
        """
        version = self.get_version(version_id)
        if version is None:
            raise ValueError(f"Version {version_id} not found in registry.")

        artifact_path = Path(version["artifact_path"])
        if not artifact_path.exists():
            raise FileNotFoundError(
                f"Artifact file missing at {artifact_path}. "
                f"Cannot roll back to version {version_id}."
            )

        current_hash = compute_file_hash(artifact_path)
        if current_hash != version["artifact_hash"]:
            raise RuntimeError(
                f"TAMPER DETECTED: Artifact hash mismatch for version {version_id}. "
                f"Registered hash: {version['artifact_hash']}, "
                f"Current hash: {current_hash}. Rollback REFUSED."
            )

        try:
            with self._transaction() as session:
                current = self._collection.find_one(
                    {"model_architecture": version["model_architecture"], "is_active": True},
                    {"_id": 0, "version_id": 1},
                    session=session,
                )
                current_id = current.get("version_id") if current else None
                if expected_active_version_id is not _UNSET and current_id != expected_active_version_id:
                    raise ModelActivationConflict(
                        "active model changed before rollback; refresh the expected active version"
                    )

                self._collection.update_many(
                    {"model_architecture": version["model_architecture"], "is_active": True},
                    {"$set": {"is_active": False, "lifecycle_state": "ROLLED_BACK"}},
                    session=session,
                )
                result = self._collection.update_one(
                    {"version_id": version_id, "model_architecture": version["model_architecture"]},
                    {"$set": {"is_active": True, "lifecycle_state": "ACTIVE"}},
                    session=session,
                )
                if result.matched_count != 1:
                    raise ValueError("Rollback target disappeared before activation.")
        except DuplicateKeyError as exc:
            raise ModelActivationConflict(
                "another activation won the unique active-model race"
            ) from exc
        except OperationFailure as exc:
            if exc.code == 112:
                raise ModelActivationConflict(
                    "another activation changed the active model concurrently"
                ) from exc
            raise

        return self.get_version(version_id)  # type: ignore

    def verify_artifact_integrity(self, version_id: str) -> Dict[str, Any]:
        """Check if a registered artifact's hash still matches what's on disk."""
        version = self.get_version(version_id)
        if version is None:
            raise ValueError(f"Version {version_id} not found.")

        artifact_path = Path(version["artifact_path"])
        if not artifact_path.exists():
            return {
                "version_id": version_id,
                "integrity": "MISSING",
                "message": f"Artifact file not found at {artifact_path}",
            }

        current_hash = compute_file_hash(artifact_path)
        matches = current_hash == version["artifact_hash"]
        return {
            "version_id": version_id,
            "integrity": "VERIFIED" if matches else "TAMPERED",
            "registered_hash": version["artifact_hash"],
            "current_hash": current_hash,
            "match": matches,
        }

    def close(self) -> None:
        """Close the MongoDB connection."""
        if self._client:
            self._client.close()

    @staticmethod
    def _clean_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
        """Remove MongoDB internal fields and ensure consistent types."""
        doc.pop("_id", None)
        doc["is_active"] = bool(doc.get("is_active", False))
        doc["lifecycle_state"] = doc.get("lifecycle_state") or ("ACTIVE" if doc["is_active"] else "CANDIDATE")
        return doc
