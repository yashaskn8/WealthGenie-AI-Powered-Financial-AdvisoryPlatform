"""
WealthGenie ML Model Registry - MongoDB-backed Store

Drop-in replacement for the SQLite-backed ModelRegistry that stores all model
version metadata in MongoDB, enabling shared state across multiple replicas.

Preserves the same public interface and SHA-256 tamper-evident artifact hashing.
"""

import hashlib
import json
import math
import re
import uuid
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pymongo import MongoClient, DESCENDING
from pymongo.errors import ConnectionFailure, DuplicateKeyError, OperationFailure
from model.migrations.phase3_state import verify_phase3_state
from model.artifacts.bundle import canonical_json_bytes

logger = logging.getLogger("wealthgenie.registry.mongo")

_ALLOWED_LIFECYCLE_TRANSITIONS = {
    "CANDIDATE": {"SHADOW"},
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
        self.database = self._db
        self.artifact_store = None
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

    def register_verified_bundle(
        self,
        verified_bundle: Dict[str, Any],
        artifact_store: Any,
        *,
        reference_distributions: Optional[Dict[str, Any]] = None,
        activate_if_empty: bool = False,
    ) -> Dict[str, Any]:
        """Persist a verified complete bundle and bind an immutable registry version.

        ``verified_bundle`` must come from the canonical bundle verifier with an
        independently supplied manifest hash. The shared artifact is written
        before the registry transaction; an orphan immutable GridFS object is
        harmless and a retry is idempotent.
        """
        manifest = verified_bundle.get("manifest")
        bundle_dir = Path(verified_bundle.get("bundle_dir", ""))
        manifest_hash = verified_bundle.get("manifest_sha256")
        if not isinstance(manifest, dict) or not isinstance(manifest_hash, str):
            raise ValueError("verified bundle identity is incomplete")
        if manifest.get("bundle_manifest_sha256") != manifest_hash:
            raise ValueError("verified bundle manifest hash is inconsistent")
        if manifest.get("architecture") not in {"RandomForest", "PyTorch_MLP", "FT_Transformer"}:
            raise ValueError("unsupported serving architecture")

        stored = artifact_store.put_bundle(bundle_dir, manifest_hash)
        if stored.get("bundle_id") != manifest.get("bundle_id") or stored.get("bundle_manifest_sha256") != manifest_hash:
            raise ValueError("artifact store returned a different immutable bundle identity")

        existing = self._collection.find_one({
            "model_architecture": manifest["architecture"],
            "bundle_id": manifest["bundle_id"],
        }, {"_id": 0})
        if existing:
            if existing.get("bundle_manifest_sha256") != manifest_hash:
                raise ModelActivationConflict("bundle ID is already registered with a different manifest hash")
            active = self.get_active_model(manifest["architecture"])
            if activate_if_empty and active is None:
                return self.activate_version(
                    existing["version_id"],
                    expected_active_version_id=None,
                    allow_trusted_baseline=True,
                )
            return self._clean_doc(existing)

        active = self.get_active_model(manifest["architecture"])
        if activate_if_empty and active is not None:
            raise ModelActivationConflict("refusing to replace an existing active model during baseline bootstrap")

        role = {
            "RandomForest": "model",
            "PyTorch_MLP": "weights",
            "FT_Transformer": "weights",
        }[manifest["architecture"]]
        member = next(item for item in manifest["artifact_files"] if item["role"] == role)
        report_path = Path(verified_bundle["members"]["evaluation_report"])
        report_bytes = report_path.read_bytes()
        report = json.loads(report_bytes.decode("utf-8"))
        if report.get("evaluation_run_id") != manifest["evaluation_report_id"]:
            raise ValueError("evaluation report ID does not match the trusted bundle manifest")
        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        document = {
            "version_id": version_id,
            "model_architecture": manifest["architecture"],
            "model_version": manifest["model_version"],
            "bundle_id": manifest["bundle_id"],
            "bundle_manifest_sha256": manifest_hash,
            "artifact_store_id": f"{getattr(artifact_store, 'bucket_name', 'local')}/{manifest['bundle_id']}",
            "artifact_store_backend": "mongodb_gridfs" if hasattr(artifact_store, "database") else "local_filesystem",
            "artifact_path": None,
            "artifact_hash": member["sha256"],
            "training_data_hash": manifest["training_data_hash"],
            "training_code_git_sha": manifest["training_code_git_sha"],
            "training_timestamp": manifest["training_timestamp"],
            "evaluation_report_id": manifest["evaluation_report_id"],
            "evaluation_report_sha256": manifest["evaluation_report_sha256"],
            "feature_schema_version": manifest["feature_schema_version"],
            "feature_names": manifest["feature_names"],
            "target_classes": manifest["target_classes"],
            "hyperparameters": {
                "feature_schema_version": manifest["feature_schema_version"],
                "feature_names": manifest["feature_names"],
                "target_classes": manifest["target_classes"],
            },
            "metrics": report.get("metrics", {}),
            "reference_distributions": reference_distributions,
            "is_active": False,
            "lifecycle_state": "CANDIDATE",
            "activation_generation": 0,
            "registered_at": now,
            "notes": "Registered from a complete verified immutable bundle",
        }

        try:
            if activate_if_empty:
                with self._transaction() as session:
                    current = self._collection.find_one(
                        {"model_architecture": manifest["architecture"], "is_active": True},
                        {"_id": 0, "version_id": 1},
                        session=session,
                    )
                    if current:
                        raise ModelActivationConflict("active model appeared during baseline bootstrap")
                    document.update({
                        "is_active": True,
                        "lifecycle_state": "ACTIVE",
                        "activation_generation": 1,
                        "activated_at": now,
                        "trusted_baseline": True,
                    })
                    self._collection.insert_one(document, session=session)
            else:
                self._collection.insert_one(document)
        except DuplicateKeyError as exc:
            same = self._collection.find_one({
                "model_architecture": manifest["architecture"],
                "bundle_id": manifest["bundle_id"],
            }, {"_id": 0})
            if same and same.get("bundle_manifest_sha256") == manifest_hash:
                return self._clean_doc(same)
            raise ModelActivationConflict("concurrent model bundle registration conflict") from exc
        except OperationFailure as exc:
            if exc.code == 112:
                current = self.get_active_model(manifest["architecture"])
                if current and current.get("bundle_id") == manifest["bundle_id"] and current.get("bundle_manifest_sha256") == manifest_hash:
                    return current
                raise ModelActivationConflict("model state changed during trusted bundle registration") from exc
            raise

        return self.get_version(version_id)  # type: ignore[return-value]

    def bootstrap_verified_bundles(
        self,
        verified_bundles: Dict[str, Dict[str, Any]],
        artifact_store: Any,
    ) -> Dict[str, Dict[str, Any]]:
        """Atomically establish the complete trusted baseline set if absent.

        GridFS writes are immutable and may safely precede the registry
        transaction. All three registry records/pointers then commit together,
        so startup can never observe a partially bootstrapped model set.
        """
        expected_architectures = {"RandomForest", "PyTorch_MLP", "FT_Transformer"}
        if set(verified_bundles) != expected_architectures:
            raise ValueError("trusted baseline bootstrap must cover all serving architectures exactly")

        prepared: list[tuple[Dict[str, Any], Dict[str, Any]]] = []
        for architecture in sorted(expected_architectures):
            verified = verified_bundles[architecture]
            manifest = verified.get("manifest")
            manifest_hash = verified.get("manifest_sha256")
            if not isinstance(manifest, dict) or manifest.get("architecture") != architecture:
                raise ValueError(f"trusted {architecture} bundle is malformed")
            if manifest.get("bundle_manifest_sha256") != manifest_hash:
                raise ValueError(f"trusted {architecture} manifest hash is inconsistent")
            stored = artifact_store.put_bundle(Path(verified["bundle_dir"]), manifest_hash)
            if stored != {"bundle_id": manifest["bundle_id"], "bundle_manifest_sha256": manifest_hash}:
                raise ValueError("shared artifact store returned a conflicting bundle identity")

            role = {"RandomForest": "model", "PyTorch_MLP": "weights", "FT_Transformer": "weights"}[architecture]
            member = next(item for item in manifest["artifact_files"] if item["role"] == role)
            report = json.loads(Path(verified["members"]["evaluation_report"]).read_text(encoding="utf-8"))
            if report.get("evaluation_run_id") != manifest["evaluation_report_id"]:
                raise ValueError(f"{architecture} evaluation report does not match its manifest")
            document = {
                "version_id": str(uuid.uuid4()),
                "model_architecture": architecture,
                "model_version": manifest["model_version"],
                "bundle_id": manifest["bundle_id"],
                "bundle_manifest_sha256": manifest_hash,
                "artifact_store_id": f"{getattr(artifact_store, 'bucket_name', 'local')}/{manifest['bundle_id']}",
                "artifact_store_backend": "mongodb_gridfs" if hasattr(artifact_store, "database") else "local_filesystem",
                "artifact_path": None,
                "artifact_hash": member["sha256"],
                "training_data_hash": manifest["training_data_hash"],
                "training_code_git_sha": manifest["training_code_git_sha"],
                "training_timestamp": manifest["training_timestamp"],
                "evaluation_report_id": manifest["evaluation_report_id"],
                "evaluation_report_sha256": manifest["evaluation_report_sha256"],
                "feature_schema_version": manifest["feature_schema_version"],
                "feature_names": manifest["feature_names"],
                "target_classes": manifest["target_classes"],
                "hyperparameters": {
                    "feature_schema_version": manifest["feature_schema_version"],
                    "feature_names": manifest["feature_names"],
                    "target_classes": manifest["target_classes"],
                },
                "metrics": report.get("metrics", {}),
                "reference_distributions": None,
                "is_active": True,
                "lifecycle_state": "ACTIVE",
                "activation_generation": 1,
                "registered_at": datetime.now(timezone.utc).isoformat(),
                "activated_at": datetime.now(timezone.utc).isoformat(),
                "trusted_baseline": True,
                "notes": "Explicit trusted baseline bootstrap from a verified complete bundle",
            }
            prepared.append((verified, document))

        try:
            with self._transaction() as session:
                for verified, document in prepared:
                    architecture = document["model_architecture"]
                    active = self._collection.find_one(
                        {"model_architecture": architecture, "is_active": True},
                        session=session,
                    )
                    if active:
                        if active.get("bundle_id") == document["bundle_id"] and active.get("bundle_manifest_sha256") == document["bundle_manifest_sha256"]:
                            document["version_id"] = active["version_id"]
                            continue
                        raise ModelActivationConflict(
                            f"refusing to replace existing active {architecture} model during baseline bootstrap"
                        )
                    existing = self._collection.find_one(
                        {"model_architecture": architecture, "bundle_id": document["bundle_id"]},
                        session=session,
                    )
                    if existing:
                        if existing.get("bundle_manifest_sha256") != document["bundle_manifest_sha256"]:
                            raise ModelActivationConflict("bundle ID is registered with a different manifest hash")
                        result = self._collection.update_one(
                            {"version_id": existing["version_id"], "is_active": False},
                            {"$set": {
                                "is_active": True,
                                "lifecycle_state": "ACTIVE",
                                "activation_generation": 1,
                                "activated_at": document["activated_at"],
                                "trusted_baseline": True,
                            }},
                            session=session,
                        )
                        if result.matched_count != 1:
                            raise ModelActivationConflict("trusted baseline changed during bootstrap")
                        document["version_id"] = existing["version_id"]
                    else:
                        self._collection.insert_one(document, session=session)
        except DuplicateKeyError as exc:
            raise ModelActivationConflict("concurrent trusted baseline bootstrap conflict") from exc
        except OperationFailure as exc:
            if exc.code == 112:
                raise ModelActivationConflict("model state changed during trusted baseline bootstrap") from exc
            raise

        active_records = {architecture: self.get_active_model(architecture) for architecture in sorted(expected_architectures)}
        for architecture, record in active_records.items():
            expected = next(doc for _, doc in prepared if doc["model_architecture"] == architecture)
            if not record or record.get("bundle_id") != expected["bundle_id"] or record.get("bundle_manifest_sha256") != expected["bundle_manifest_sha256"]:
                raise ModelActivationConflict("baseline bootstrap committed but canonical state did not reconcile")
        return active_records

    def activate_version(
        self,
        version_id: str,
        *,
        expected_active_version_id: Optional[str],
        expected_activation_generation: Optional[int] = None,
        allow_trusted_baseline: bool = False,
    ) -> Dict[str, Any]:
        """Atomically activate a preloaded immutable bundle using version/generation CAS."""
        try:
            with self._transaction() as session:
                target = self._collection.find_one({"version_id": version_id}, session=session)
                if not target:
                    raise ValueError("model version not found")
                eligible = target.get("lifecycle_state") == "VALIDATED" or (
                    allow_trusted_baseline and target.get("trusted_baseline") is True
                ) or target.get("lifecycle_state") == "ROLLED_BACK"
                if not eligible or not target.get("bundle_id") or not target.get("bundle_manifest_sha256"):
                    raise ValueError("only complete verified validated bundles may be activated")

                current = self._collection.find_one(
                    {"model_architecture": target["model_architecture"], "is_active": True},
                    session=session,
                )
                current_id = current.get("version_id") if current else None
                current_generation = int(current.get("activation_generation", 0)) if current else 0
                if current_id != expected_active_version_id:
                    raise ModelActivationConflict("active model changed before activation; refresh the expected version")
                if expected_activation_generation is not None and current_generation != expected_activation_generation:
                    raise ModelActivationConflict("active model generation changed before activation")
                if current_id == version_id:
                    return self._clean_doc(current)

                next_generation = current_generation + 1
                if current:
                    result = self._collection.update_one(
                        {"version_id": current_id, "is_active": True, "activation_generation": current_generation},
                        {"$set": {"is_active": False, "lifecycle_state": "ROLLED_BACK"}},
                        session=session,
                    )
                    if result.matched_count != 1:
                        raise ModelActivationConflict("active model changed during activation")
                result = self._collection.update_one(
                    {"version_id": version_id, "is_active": False},
                    {"$set": {
                        "is_active": True,
                        "lifecycle_state": "ACTIVE",
                        "activation_generation": next_generation,
                        "activated_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    session=session,
                )
                if result.matched_count != 1:
                    raise ModelActivationConflict("activation target changed before commit")
        except DuplicateKeyError as exc:
            raise ModelActivationConflict("another activation won the unique active-model race") from exc
        except OperationFailure as exc:
            if exc.code == 112:
                raise ModelActivationConflict("another activation changed the active model concurrently") from exc
            raise
        return self.get_version(version_id)  # type: ignore[return-value]

    def record_evaluation_evidence(self, evidence: Dict[str, Any]) -> Dict[str, Any]:
        """Insert evaluator-produced evidence once; same ID cannot be rewritten."""
        required = {
            "evaluation_run_id", "candidate_version_id", "candidate_bundle_id",
            "candidate_bundle_hash", "evaluation_dataset_hash", "evaluator_version",
            "evaluator_git_sha", "metrics", "timestamp", "report_sha256", "report",
        }
        if not isinstance(evidence, dict) or required - evidence.keys():
            raise ValueError("evaluation evidence is incomplete")
        for key in ("candidate_bundle_hash", "evaluation_dataset_hash", "report_sha256"):
            if not isinstance(evidence[key], str) or not re.fullmatch(r"[0-9a-f]{64}", evidence[key]):
                raise ValueError(f"{key} must be a lowercase SHA-256 digest")
        metrics = evidence["metrics"]
        if not isinstance(metrics, dict) or any(
            not isinstance(value, (int, float)) or isinstance(value, bool)
            or not math.isfinite(value) or not 0 <= value <= 1
            for value in metrics.values()
        ):
            raise ValueError("evaluation metrics must be finite values in [0, 1]")
        report = evidence["report"]
        if not isinstance(report, dict) or hashlib.sha256(canonical_json_bytes(report)).hexdigest() != evidence["report_sha256"]:
            raise ValueError("evaluation report content does not match its immutable hash")
        for key in ("evaluation_run_id", "candidate_version_id", "candidate_bundle_id", "candidate_bundle_hash", "evaluation_dataset_hash", "evaluator_version", "evaluator_git_sha", "metrics"):
            expected = evidence["candidate_version_id"] if key == "candidate_version_id" else evidence[key]
            if report.get(key) != expected:
                raise ValueError(f"evaluation report binding mismatch: {key}")
        candidate = self.get_version(evidence["candidate_version_id"])
        if (
            not candidate
            or candidate.get("lifecycle_state") != "SHADOW"
            or candidate.get("bundle_id") != evidence["candidate_bundle_id"]
            or candidate.get("bundle_manifest_sha256") != evidence["candidate_bundle_hash"]
        ):
            raise ValueError("evaluation evidence does not match a registered SHADOW candidate bundle")
        payload = {key: value for key, value in evidence.items() if key != "evidence_sha256"}
        digest = hashlib.sha256(canonical_json_bytes(payload)).hexdigest()
        record = {**payload, "evidence_sha256": digest, "recorded_at": datetime.now(timezone.utc).isoformat()}
        existing = self._db["model_evaluation_evidence"].find_one({"evaluation_run_id": evidence["evaluation_run_id"]}, {"_id": 0})
        if existing:
            if existing.get("evidence_sha256") != digest:
                raise ModelActivationConflict("evaluation_run_id is already bound to different immutable evidence")
            return existing
        try:
            self._db["model_evaluation_evidence"].insert_one(record)
        except DuplicateKeyError as exc:
            existing = self._db["model_evaluation_evidence"].find_one({"evaluation_run_id": evidence["evaluation_run_id"]}, {"_id": 0})
            if not existing or existing.get("evidence_sha256") != digest:
                raise ModelActivationConflict("concurrent evaluation evidence identity conflict") from exc
        return self.get_evaluation_evidence(evidence["evaluation_run_id"])

    def get_evaluation_evidence(self, evaluation_run_id: str) -> Optional[Dict[str, Any]]:
        record = self._db["model_evaluation_evidence"].find_one({"evaluation_run_id": evaluation_run_id}, {"_id": 0})
        if not record:
            return None
        payload = {key: value for key, value in record.items() if key not in {"evidence_sha256", "recorded_at"}}
        digest = hashlib.sha256(canonical_json_bytes(payload)).hexdigest()
        if digest != record.get("evidence_sha256"):
            raise RuntimeError("immutable evaluation evidence hash mismatch")
        if hashlib.sha256(canonical_json_bytes(record.get("report"))).hexdigest() != record.get("report_sha256"):
            raise RuntimeError("immutable evaluation report hash mismatch")
        return record

    def validate_version_with_evidence(self, version_id: str, evaluation_run_id: str) -> Dict[str, Any]:
        """Bind evaluator evidence and advance SHADOW -> VALIDATED atomically."""
        evidence = self.get_evaluation_evidence(evaluation_run_id)
        if not evidence:
            raise ValueError("evaluation evidence does not exist")
        try:
            with self._transaction() as session:
                candidate = self._collection.find_one({"version_id": version_id}, session=session)
                if not candidate:
                    raise ValueError("candidate model version does not exist")
                if (
                    candidate.get("lifecycle_state") != "SHADOW"
                    or evidence.get("candidate_version_id") != version_id
                    or evidence.get("candidate_bundle_id") != candidate.get("bundle_id")
                    or evidence.get("candidate_bundle_hash") != candidate.get("bundle_manifest_sha256")
                ):
                    raise ModelActivationConflict("evaluation evidence is stale or belongs to another candidate")
                result = self._collection.update_one(
                    {
                        "version_id": version_id,
                        "lifecycle_state": "SHADOW",
                        "bundle_id": evidence["candidate_bundle_id"],
                        "bundle_manifest_sha256": evidence["candidate_bundle_hash"],
                    },
                    {"$set": {
                        "lifecycle_state": "VALIDATED",
                        "metrics": evidence["metrics"],
                        "validation_evidence_id": evaluation_run_id,
                        "validation_evidence_sha256": evidence["evidence_sha256"],
                    }},
                    session=session,
                )
                if result.matched_count != 1:
                    raise ModelActivationConflict("candidate lifecycle changed before evidence-bound validation")
        except OperationFailure as exc:
            if exc.code == 112:
                raise ModelActivationConflict("candidate changed during evidence-bound validation") from exc
            raise
        return self.get_version(version_id)  # type: ignore[return-value]

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
        bundle_id: Optional[str] = None,
        bundle_path: Optional[str | Path] = None,
        bundle_manifest_sha256: Optional[str] = None,
    ) -> str:
        """
        Register a new model version in the registry.
        Returns the generated version_id (UUID).
        """
        artifact_path = Path(artifact_path)
        if not artifact_path.exists():
            raise FileNotFoundError(f"Artifact file not found: {artifact_path}")

        bundle_fields = (bundle_id, bundle_path, bundle_manifest_sha256)
        if any(value is not None for value in bundle_fields):
            if not all(value is not None for value in bundle_fields):
                raise ValueError("bundle_id, bundle_path, and bundle_manifest_sha256 must be provided together")
            resolved_bundle_path = Path(bundle_path).resolve(strict=True)
            if not resolved_bundle_path.is_dir():
                raise ValueError("bundle_path must identify an existing bundle directory")
            if not isinstance(bundle_id, str) or not bundle_id.strip():
                raise ValueError("bundle_id must be a non-empty string")
            if not isinstance(bundle_manifest_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", bundle_manifest_sha256):
                raise ValueError("bundle_manifest_sha256 must be a lowercase SHA-256 digest")

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
        if bundle_id is not None:
            doc.update({
                "bundle_id": bundle_id,
                "bundle_path": str(resolved_bundle_path),
                "bundle_manifest_sha256": bundle_manifest_sha256,
            })

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
        """Preload a complete verified bundle, then atomically CAS-activate it."""
        version = self.get_version(version_id)
        if version is None:
            raise ValueError(f"Version {version_id} not found in registry.")
        if not version.get("bundle_id") or not version.get("bundle_manifest_sha256"):
            raise ValueError("rollback requires a complete verified immutable model bundle")
        from model.serving.control_plane import preload_registered_bundle

        current = self.get_active_model(version["model_architecture"])
        current_id = current.get("version_id") if current else None
        generation = int(current.get("activation_generation", 0)) if current else 0
        if expected_active_version_id is not _UNSET and current_id != expected_active_version_id:
            raise ModelActivationConflict("active model changed before rollback; refresh the expected active version")
        preloaded = preload_registered_bundle(version, self)
        try:
            return self.activate_version(
                version_id,
                expected_active_version_id=current_id,
                expected_activation_generation=generation,
            )
        finally:
            materialized = getattr(preloaded, "_materialized_bundle_dir", None)
            if materialized:
                import shutil
                shutil.rmtree(materialized, ignore_errors=True)

    def verify_artifact_integrity(self, version_id: str) -> Dict[str, Any]:
        """Verify the complete registered bundle against its shared trust anchor."""
        version = self.get_version(version_id)
        if version is None:
            raise ValueError(f"Version {version_id} not found.")

        if version.get("bundle_id") and version.get("bundle_manifest_sha256"):
            if self.artifact_store is None:
                return {"version_id": version_id, "integrity": "UNAVAILABLE", "match": False}
            bundle_dir = None
            try:
                bundle_dir = self.artifact_store.get_bundle(
                    version["bundle_id"], version["bundle_manifest_sha256"]
                )
                verified = self.artifact_store.verify_bundle(
                    bundle_dir, version["bundle_manifest_sha256"]
                )
                matches = (
                    verified["manifest"].get("bundle_id") == version["bundle_id"]
                    and verified.get("manifest_sha256") == version["bundle_manifest_sha256"]
                )
                return {
                    "version_id": version_id,
                    "integrity": "VERIFIED" if matches else "TAMPERED",
                    "registered_hash": version["bundle_manifest_sha256"],
                    "current_hash": verified.get("manifest_sha256"),
                    "match": matches,
                }
            except Exception:
                return {
                    "version_id": version_id,
                    "integrity": "MISSING_OR_TAMPERED",
                    "registered_hash": version["bundle_manifest_sha256"],
                    "match": False,
                }
            finally:
                if bundle_dir is not None and hasattr(self.artifact_store, "database"):
                    import shutil
                    shutil.rmtree(bundle_dir.parent, ignore_errors=True)

        if not version.get("artifact_path"):
            return {"version_id": version_id, "integrity": "MISSING", "match": False}
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
