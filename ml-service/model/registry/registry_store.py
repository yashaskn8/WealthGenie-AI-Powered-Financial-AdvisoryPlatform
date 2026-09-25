"""
Phase 5 MLOps -- Model Version Registry Store

SQLite-backed persistent model registry tracking:
  - Model architecture & checkpoint path
  - SHA-256 artifact hash (tamper-evident verification)
  - Training data hash (lineage)
  - Hyperparameters & Phase 4 rigor metrics (JSON)
  - Reference feature distributions for drift detection
  - Active version pointer & rollback history
"""

import hashlib
import json
import math
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from model.artifacts.bundle import canonical_json_bytes, read_verified_evaluation_report

_DEFAULT_DB_PATH = Path(__file__).resolve().parent / "model_registry.db"
_SCHEMA_VERSION = 2
_ALLOWED_LIFECYCLE_TRANSITIONS = {
    "CANDIDATE": {"SHADOW"},
}


def compute_file_hash(filepath: Path) -> str:
    """Compute SHA-256 hash of a file on disk."""
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()


def compute_data_hash(filepath: Path) -> str:
    """Compute SHA-256 hash of training data file."""
    return compute_file_hash(filepath)


class ModelRegistry:
    """
    Persistent model version registry backed by SQLite.

    Thread-safe within a single process. For multi-worker deployments,
    WAL mode is enabled so concurrent readers are not blocked by writers.
    """

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = Path(db_path) if db_path else _DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
        return self._conn

    def _init_db(self) -> None:
        conn = self._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS model_versions (
                version_id       TEXT PRIMARY KEY,
                model_architecture TEXT NOT NULL,
                training_data_hash TEXT NOT NULL,
                training_timestamp TEXT NOT NULL,
                hyperparameters  TEXT NOT NULL,  -- JSON
                metrics          TEXT NOT NULL,  -- JSON (Phase 4 rigor metrics)
                artifact_path    TEXT NOT NULL,
                artifact_hash    TEXT NOT NULL,  -- SHA-256 of serialized model file
                reference_distributions TEXT,    -- JSON (per-feature stats for drift)
                is_active        INTEGER NOT NULL DEFAULT 0,
                lifecycle_state  TEXT NOT NULL DEFAULT 'CANDIDATE',
                registered_at    TEXT NOT NULL,
                notes            TEXT
            );

            CREATE TABLE IF NOT EXISTS registry_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_active_model_per_architecture "
            "ON model_versions(model_architecture) WHERE is_active = 1"
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(model_versions)").fetchall()}
        if "lifecycle_state" not in columns:
            conn.execute("ALTER TABLE model_versions ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'CANDIDATE'")
            conn.execute("UPDATE model_versions SET lifecycle_state = CASE WHEN is_active = 1 THEN 'ACTIVE' ELSE 'CANDIDATE' END")
        optional_columns = {
            "bundle_id": "TEXT",
            "bundle_manifest_sha256": "TEXT",
            "bundle_path": "TEXT",
            "artifact_store_id": "TEXT",
            "artifact_store_backend": "TEXT",
            "activation_generation": "INTEGER NOT NULL DEFAULT 0",
            "model_version": "TEXT",
            "feature_schema_version": "TEXT",
            "feature_names": "TEXT",
            "target_classes": "TEXT",
            "training_code_git_sha": "TEXT",
            "evaluation_report_id": "TEXT",
            "evaluation_report_sha256": "TEXT",
            "trusted_baseline": "INTEGER NOT NULL DEFAULT 0",
            "validation_evidence_id": "TEXT",
        }
        for name, declaration in optional_columns.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE model_versions ADD COLUMN {name} {declaration}")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_model_bundle_identity "
            "ON model_versions(model_architecture, bundle_id) WHERE bundle_id IS NOT NULL"
        )
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS model_evaluation_evidence (
                evaluation_run_id TEXT PRIMARY KEY,
                candidate_version_id TEXT NOT NULL,
                candidate_bundle_id TEXT NOT NULL,
                candidate_bundle_hash TEXT NOT NULL,
                evaluation_dataset_hash TEXT NOT NULL,
                evaluator_version TEXT NOT NULL,
                evaluator_git_sha TEXT NOT NULL,
                metrics TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                report_sha256 TEXT NOT NULL,
                report_json TEXT,
                evidence_sha256 TEXT NOT NULL,
                recorded_at TEXT NOT NULL
            );
        """)
        evidence_columns = {row[1] for row in conn.execute("PRAGMA table_info(model_evaluation_evidence)").fetchall()}
        if "report_json" not in evidence_columns:
            conn.execute("ALTER TABLE model_evaluation_evidence ADD COLUMN report_json TEXT")
        # Store schema version
        conn.execute(
            "INSERT INTO registry_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("schema_version", str(_SCHEMA_VERSION)),
        )
        conn.commit()

    def bootstrap_verified_bundles(self, verified_bundles, artifact_store):
        """Atomically seed the local registry from the complete trusted bundles."""
        expected = {"RandomForest", "PyTorch_MLP", "FT_Transformer"}
        if set(verified_bundles) != expected:
            raise ValueError("trusted baseline bootstrap must cover all serving architectures exactly")
        prepared = []
        for architecture in sorted(expected):
            verified = verified_bundles[architecture]
            manifest = verified["manifest"]
            manifest_hash = verified["manifest_sha256"]
            if manifest.get("architecture") != architecture or manifest.get("bundle_manifest_sha256") != manifest_hash:
                raise ValueError(f"trusted {architecture} bundle identity is inconsistent")
            stored = artifact_store.put_bundle(Path(verified["bundle_dir"]), manifest_hash)
            if stored.get("bundle_id") != manifest["bundle_id"]:
                raise ValueError("artifact store returned a different bundle ID")
            materialized = artifact_store.get_bundle(manifest["bundle_id"], manifest_hash)
            role = {"RandomForest": "model", "PyTorch_MLP": "weights", "FT_Transformer": "weights"}[architecture]
            member = next(item for item in manifest["artifact_files"] if item["role"] == role)
            report = read_verified_evaluation_report(verified)
            if report.get("evaluation_run_id") != manifest["evaluation_report_id"]:
                raise ValueError("evaluation report does not match trusted manifest")
            prepared.append((architecture, manifest, manifest_hash, materialized / member["filename"], member["sha256"], report))

        conn = self._get_conn()
        now = datetime.now(timezone.utc).isoformat()
        records = {}
        try:
            conn.execute("BEGIN IMMEDIATE")
            for architecture, manifest, manifest_hash, artifact_path, artifact_hash, report in prepared:
                active_row = conn.execute(
                    "SELECT * FROM model_versions WHERE model_architecture = ? AND is_active = 1",
                    (architecture,),
                ).fetchone()
                if active_row:
                    active = self._row_to_dict(active_row)
                    if active.get("bundle_id") != manifest["bundle_id"] or active.get("bundle_manifest_sha256") != manifest_hash:
                        raise RuntimeError(f"refusing to replace existing active {architecture} model")
                    records[architecture] = active
                    continue
                existing = conn.execute(
                    "SELECT * FROM model_versions WHERE model_architecture = ? AND bundle_id = ?",
                    (architecture, manifest["bundle_id"]),
                ).fetchone()
                if existing:
                    record = self._row_to_dict(existing)
                    if record.get("bundle_manifest_sha256") != manifest_hash:
                        raise RuntimeError("bundle ID is already registered with a different hash")
                    conn.execute(
                        "UPDATE model_versions SET is_active=1,lifecycle_state='ACTIVE',activation_generation=1,trusted_baseline=1 WHERE version_id=? AND is_active=0",
                        (record["version_id"],),
                    )
                    records[architecture] = self.get_version(record["version_id"])
                    continue
                version_id = str(uuid.uuid4())
                conn.execute(
                    """INSERT INTO model_versions (
                        version_id, model_architecture, training_data_hash, training_timestamp,
                        hyperparameters, metrics, artifact_path, artifact_hash,
                        reference_distributions, is_active, lifecycle_state, registered_at, notes,
                        bundle_id, bundle_manifest_sha256, bundle_path, artifact_store_id,
                        artifact_store_backend, activation_generation, model_version,
                        feature_schema_version, feature_names, target_classes,
                        training_code_git_sha, evaluation_report_id, evaluation_report_sha256,
                        trusted_baseline
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1)""",
                    (
                        version_id, architecture, manifest["training_data_hash"], manifest["training_timestamp"],
                        json.dumps({"feature_schema_version": manifest["feature_schema_version"], "feature_names": manifest["feature_names"], "target_classes": manifest["target_classes"]}),
                        json.dumps(report.get("metrics", {})), str(artifact_path), artifact_hash,
                        None, now, "Explicit trusted serving bundle bootstrap", manifest["bundle_id"],
                        manifest_hash, str(materialized), f"local/{manifest['bundle_id']}",
                        "local_filesystem", manifest["model_version"], manifest["feature_schema_version"],
                        json.dumps(manifest["feature_names"]), json.dumps(manifest["target_classes"]),
                        manifest["training_code_git_sha"], manifest["evaluation_report_id"], manifest["evaluation_report_sha256"],
                    ),
                )
                records[architecture] = self.get_version(version_id)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return {architecture: self.get_active_model(architecture) for architecture in sorted(expected)}

    def register_verified_bundle(self, verified_bundle, artifact_store, *, reference_distributions=None, activate_if_empty=False):
        """Register a candidate only after canonical complete-bundle verification."""
        manifest = verified_bundle.get("manifest")
        manifest_hash = verified_bundle.get("manifest_sha256")
        if not isinstance(manifest, dict) or manifest.get("bundle_manifest_sha256") != manifest_hash:
            raise ValueError("verified bundle identity is incomplete or inconsistent")
        if manifest.get("architecture") not in {"RandomForest", "PyTorch_MLP", "FT_Transformer"}:
            raise ValueError("unsupported serving architecture")
        stored = artifact_store.put_bundle(Path(verified_bundle["bundle_dir"]), manifest_hash)
        if stored.get("bundle_id") != manifest.get("bundle_id") or stored.get("bundle_manifest_sha256") != manifest_hash:
            raise ValueError("artifact store returned a conflicting bundle identity")
        existing = next(
            (item for item in self.list_versions(manifest["architecture"]) if item.get("bundle_id") == manifest["bundle_id"]),
            None,
        )
        if existing:
            if existing.get("bundle_manifest_sha256") != manifest_hash:
                raise RuntimeError("bundle ID is already registered with another manifest hash")
            return existing
        if activate_if_empty:
            raise ValueError("candidate registration cannot activate a model; use explicit preload and activation")

        stored_path = artifact_store.get_bundle(manifest["bundle_id"], manifest_hash)
        role = {"RandomForest": "model", "PyTorch_MLP": "weights", "FT_Transformer": "weights"}[manifest["architecture"]]
        member = next(item for item in manifest["artifact_files"] if item["role"] == role)
        report = read_verified_evaluation_report(verified_bundle)
        if report.get("evaluation_run_id") != manifest["evaluation_report_id"]:
            raise ValueError("evaluation report ID does not match the bundle manifest")
        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """INSERT INTO model_versions (
                    version_id,model_architecture,training_data_hash,training_timestamp,
                    hyperparameters,metrics,artifact_path,artifact_hash,reference_distributions,
                    is_active,lifecycle_state,registered_at,notes,bundle_id,bundle_manifest_sha256,
                    bundle_path,artifact_store_id,artifact_store_backend,activation_generation,
                    model_version,feature_schema_version,feature_names,target_classes,
                    training_code_git_sha,evaluation_report_id,evaluation_report_sha256,trusted_baseline
                ) VALUES (?,?,?,?,?,?,?,?,?,0,'CANDIDATE',?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,0)""",
                (
                    version_id, manifest["architecture"], manifest["training_data_hash"], manifest["training_timestamp"],
                    json.dumps({"feature_schema_version": manifest["feature_schema_version"], "feature_names": manifest["feature_names"], "target_classes": manifest["target_classes"]}),
                    json.dumps(report.get("metrics", {}), sort_keys=True), str(stored_path / member["filename"]), member["sha256"],
                    json.dumps(reference_distributions) if reference_distributions is not None else None,
                    now, "Registered from complete immutable bundle", manifest["bundle_id"], manifest_hash,
                    str(stored_path), f"local/{manifest['bundle_id']}", "local_filesystem", manifest["model_version"],
                    manifest["feature_schema_version"], json.dumps(manifest["feature_names"]),
                    json.dumps(manifest["target_classes"]), manifest["training_code_git_sha"],
                    manifest["evaluation_report_id"], manifest["evaluation_report_sha256"],
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return self.get_version(version_id)

    def record_evaluation_evidence(self, evidence: Dict[str, Any]) -> Dict[str, Any]:
        required = {
            "evaluation_run_id", "candidate_version_id", "candidate_bundle_id",
            "candidate_bundle_hash", "evaluation_dataset_hash", "evaluator_version",
            "evaluator_git_sha", "metrics", "timestamp", "report_sha256", "report",
        }
        if not isinstance(evidence, dict) or required - evidence.keys():
            raise ValueError("evaluation evidence is incomplete")
        for field in ("candidate_bundle_hash", "evaluation_dataset_hash", "report_sha256"):
            if not isinstance(evidence[field], str) or not re.fullmatch(r"[0-9a-f]{64}", evidence[field]):
                raise ValueError(f"{field} must be a lowercase SHA-256 digest")
        metrics = evidence["metrics"]
        if not isinstance(metrics, dict) or any(
            not isinstance(value, (int, float)) or isinstance(value, bool)
            or not math.isfinite(value) or not 0 <= value <= 1 for value in metrics.values()
        ):
            raise ValueError("evaluation metrics must be finite values in [0, 1]")
        report = evidence["report"]
        if not isinstance(report, dict) or hashlib.sha256(canonical_json_bytes(report)).hexdigest() != evidence["report_sha256"]:
            raise ValueError("evaluation report content does not match its immutable hash")
        for key in ("evaluation_run_id", "candidate_version_id", "candidate_bundle_id", "candidate_bundle_hash", "evaluation_dataset_hash", "evaluator_version", "evaluator_git_sha", "metrics"):
            if report.get(key) != evidence[key]:
                raise ValueError(f"evaluation report binding mismatch: {key}")
        digest = hashlib.sha256(canonical_json_bytes(evidence)).hexdigest()
        stored = {**evidence, "metrics": json.dumps(metrics, sort_keys=True), "report_json": json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False), "evidence_sha256": digest, "recorded_at": datetime.now(timezone.utc).isoformat()}
        conn = self._get_conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            candidate_row = conn.execute(
                "SELECT lifecycle_state,bundle_id,bundle_manifest_sha256 FROM model_versions WHERE version_id=?",
                (evidence["candidate_version_id"],),
            ).fetchone()
            if (
                not candidate_row
                or candidate_row["lifecycle_state"] != "SHADOW"
                or candidate_row["bundle_id"] != evidence["candidate_bundle_id"]
                or candidate_row["bundle_manifest_sha256"] != evidence["candidate_bundle_hash"]
            ):
                raise ValueError("evaluation evidence does not match a registered SHADOW candidate")
            conn.execute(
                "INSERT INTO model_evaluation_evidence (evaluation_run_id,candidate_version_id,candidate_bundle_id,candidate_bundle_hash,evaluation_dataset_hash,evaluator_version,evaluator_git_sha,metrics,timestamp,report_sha256,report_json,evidence_sha256,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (stored["evaluation_run_id"], stored["candidate_version_id"], stored["candidate_bundle_id"], stored["candidate_bundle_hash"], stored["evaluation_dataset_hash"], stored["evaluator_version"], stored["evaluator_git_sha"], stored["metrics"], stored["timestamp"], stored["report_sha256"], stored["report_json"], digest, stored["recorded_at"]),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            current = self.get_evaluation_evidence(evidence["evaluation_run_id"])
            if not current or current.get("evidence_sha256") != digest:
                raise RuntimeError("evaluation_run_id is already bound to different immutable evidence")
        except Exception:
            conn.rollback()
            raise
        return self.get_evaluation_evidence(evidence["evaluation_run_id"])

    def get_evaluation_evidence(self, evaluation_run_id: str):
        row = self._get_conn().execute("SELECT * FROM model_evaluation_evidence WHERE evaluation_run_id=?", (evaluation_run_id,)).fetchone()
        if not row:
            return None
        record = dict(row)
        record["metrics"] = json.loads(record["metrics"])
        if not record.get("report_json"):
            raise RuntimeError("immutable evaluation report is missing")
        record["report"] = json.loads(record.pop("report_json"))
        payload = {key: record[key] for key in (
            "evaluation_run_id", "candidate_version_id", "candidate_bundle_id", "candidate_bundle_hash",
            "evaluation_dataset_hash", "evaluator_version", "evaluator_git_sha", "metrics", "timestamp", "report_sha256", "report",
        )}
        digest = hashlib.sha256(canonical_json_bytes(payload)).hexdigest()
        if digest != record.get("evidence_sha256"):
            raise RuntimeError("immutable evaluation evidence hash mismatch")
        if hashlib.sha256(canonical_json_bytes(record["report"])).hexdigest() != record.get("report_sha256"):
            raise RuntimeError("immutable evaluation report hash mismatch")
        return record

    def validate_version_with_evidence(self, version_id: str, evaluation_run_id: str) -> Dict[str, Any]:
        evidence = self.get_evaluation_evidence(evaluation_run_id)
        conn = self._get_conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            candidate = conn.execute(
                "SELECT lifecycle_state,bundle_id,bundle_manifest_sha256 FROM model_versions WHERE version_id=?",
                (version_id,),
            ).fetchone()
            if (
                not evidence
                or not candidate
                or evidence["candidate_version_id"] != version_id
                or evidence["candidate_bundle_id"] != candidate["bundle_id"]
                or evidence["candidate_bundle_hash"] != candidate["bundle_manifest_sha256"]
                or candidate["lifecycle_state"] != "SHADOW"
            ):
                raise ValueError("evaluation evidence does not match the current SHADOW candidate")
            result = conn.execute(
                "UPDATE model_versions SET lifecycle_state='VALIDATED',metrics=?,validation_evidence_id=? WHERE version_id=? AND lifecycle_state='SHADOW'",
                (json.dumps(evidence["metrics"], sort_keys=True), evaluation_run_id, version_id),
            )
            if result.rowcount != 1:
                raise RuntimeError("candidate lifecycle changed before validation")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return self.get_version(version_id)

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

        conn = self._get_conn()

        if set_active:
            # Deactivate all other versions of this architecture
            conn.execute(
                "UPDATE model_versions SET is_active = 0, lifecycle_state = 'ROLLED_BACK' "
                "WHERE model_architecture = ? AND is_active = 1",
                (model_architecture,),
            )

        conn.execute(
            """INSERT INTO model_versions
               (version_id, model_architecture, training_data_hash, training_timestamp,
                hyperparameters, metrics, artifact_path, artifact_hash,
                reference_distributions, is_active, lifecycle_state, registered_at, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                version_id,
                model_architecture,
                training_data_hash,
                training_timestamp,
                json.dumps(hyperparameters),
                json.dumps(metrics),
                str(artifact_path),
                artifact_hash,
                json.dumps(reference_distributions) if reference_distributions else None,
                1 if set_active else 0,
                "ACTIVE" if set_active else "CANDIDATE",
                now,
                notes,
            ),
        )
        conn.commit()
        return version_id

    def update_lifecycle_state(self, version_id: str, lifecycle_state: str, metrics=None) -> Dict[str, Any]:
        conn = self._get_conn()
        current = self.get_version(version_id)
        if current is None:
            raise ValueError(f"Version {version_id} not found in registry.")
        allowed = _ALLOWED_LIFECYCLE_TRANSITIONS.get(current["lifecycle_state"], set())
        if lifecycle_state not in allowed:
            raise ValueError(
                f"Invalid model lifecycle transition: {current['lifecycle_state']} -> {lifecycle_state}."
            )
        if metrics is None:
            result = conn.execute(
                "UPDATE model_versions SET lifecycle_state = ? WHERE version_id = ?",
                (lifecycle_state, version_id),
            )
        else:
            result = conn.execute(
                "UPDATE model_versions SET lifecycle_state = ?, metrics = ? WHERE version_id = ?",
                (lifecycle_state, json.dumps(metrics), version_id),
            )
        if result.rowcount != 1:
            raise RuntimeError("Model lifecycle update did not modify exactly one version.")
        conn.commit()
        return self.get_version(version_id)  # type: ignore

    def list_versions(
        self, architecture: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List all registered model versions, optionally filtered by architecture."""
        conn = self._get_conn()
        if architecture:
            cursor = conn.execute(
                "SELECT * FROM model_versions WHERE model_architecture = ? ORDER BY registered_at DESC",
                (architecture,),
            )
        else:
            cursor = conn.execute(
                "SELECT * FROM model_versions ORDER BY registered_at DESC"
            )
        return [self._row_to_dict(row) for row in cursor.fetchall()]

    def get_version(self, version_id: str) -> Optional[Dict[str, Any]]:
        """Get a single registered model version by version_id."""
        conn = self._get_conn()
        cursor = conn.execute(
            "SELECT * FROM model_versions WHERE version_id = ?", (version_id,)
        )
        row = cursor.fetchone()
        return self._row_to_dict(row) if row else None

    def get_active_model(
        self, architecture: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Get the currently active model version (optionally for a specific architecture)."""
        conn = self._get_conn()
        if architecture:
            cursor = conn.execute(
                "SELECT * FROM model_versions WHERE is_active = 1 AND model_architecture = ?",
                (architecture,),
            )
        else:
            # Return the most recently activated model across architectures
            cursor = conn.execute(
                "SELECT * FROM model_versions WHERE is_active = 1 ORDER BY registered_at DESC LIMIT 1"
            )
        row = cursor.fetchone()
        return self._row_to_dict(row) if row else None

    def activate_version(
        self,
        version_id: str,
        *,
        expected_active_version_id: Optional[str],
        expected_activation_generation: Optional[int] = None,
        allow_trusted_baseline: bool = False,
    ) -> Dict[str, Any]:
        """CAS activate a preloaded immutable bundle in one SQLite transaction."""
        conn = self._get_conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            target_row = conn.execute("SELECT * FROM model_versions WHERE version_id=?", (version_id,)).fetchone()
            if not target_row:
                raise ValueError("model version not found")
            target = self._row_to_dict(target_row)
            eligible = target.get("lifecycle_state") == "VALIDATED" or (
                allow_trusted_baseline and target.get("trusted_baseline")
            ) or target.get("lifecycle_state") == "ROLLED_BACK"
            if not eligible or not target.get("bundle_id") or not target.get("bundle_manifest_sha256"):
                raise ValueError("only complete verified validated bundles may be activated")
            active_row = conn.execute(
                "SELECT * FROM model_versions WHERE model_architecture=? AND is_active=1",
                (target["model_architecture"],),
            ).fetchone()
            active = self._row_to_dict(active_row) if active_row else None
            active_id = active.get("version_id") if active else None
            generation = int(active.get("activation_generation", 0)) if active else 0
            if active_id != expected_active_version_id:
                raise RuntimeError("active model changed before activation")
            if expected_activation_generation is not None and generation != expected_activation_generation:
                raise RuntimeError("active model generation changed before activation")
            if active_id != version_id:
                conn.execute(
                    "UPDATE model_versions SET is_active=0,lifecycle_state='ROLLED_BACK' WHERE model_architecture=? AND is_active=1",
                    (target["model_architecture"],),
                )
                result = conn.execute(
                    "UPDATE model_versions SET is_active=1,lifecycle_state='ACTIVE',activation_generation=?,trusted_baseline=CASE WHEN trusted_baseline=1 THEN 1 ELSE trusted_baseline END WHERE version_id=? AND is_active=0",
                    (generation + 1, version_id),
                )
                if result.rowcount != 1:
                    raise RuntimeError("activation target changed before commit")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return self.get_version(version_id)

    def rollback_to_version(self, version_id: str) -> Dict[str, Any]:
        """Preload a complete verified bundle, then atomically CAS-activate it."""
        version = self.get_version(version_id)
        if version is None:
            raise ValueError(f"Version {version_id} not found in registry.")
        if not version.get("bundle_id") or not version.get("bundle_manifest_sha256"):
            raise ValueError("rollback requires a complete verified immutable model bundle")
        from model.serving.control_plane import preload_registered_bundle

        active = self.get_active_model(version["model_architecture"])
        active_id = active.get("version_id") if active else None
        generation = int(active.get("activation_generation", 0)) if active else 0
        preloaded = preload_registered_bundle(version, self)
        try:
            return self.activate_version(
                version_id,
                expected_active_version_id=active_id,
                expected_activation_generation=generation,
            )
        finally:
            materialized = getattr(preloaded, "_materialized_bundle_dir", None)
            if materialized:
                import shutil
                shutil.rmtree(materialized, ignore_errors=True)

    def verify_artifact_integrity(self, version_id: str) -> Dict[str, Any]:
        """Verify a registered complete bundle or legacy single-file artifact."""
        version = self.get_version(version_id)
        if version is None:
            raise ValueError(f"Version {version_id} not found.")

        if version.get("bundle_id") and version.get("bundle_manifest_sha256"):
            if self.artifact_store is None:
                return {"version_id": version_id, "integrity": "UNAVAILABLE", "match": False}
            try:
                bundle_path = self.artifact_store.get_bundle(version["bundle_id"], version["bundle_manifest_sha256"])
                verified = self.artifact_store.verify_bundle(bundle_path, version["bundle_manifest_sha256"])
                matches = verified["manifest"].get("bundle_id") == version["bundle_id"]
                return {
                    "version_id": version_id,
                    "integrity": "VERIFIED" if matches else "TAMPERED",
                    "registered_hash": version["bundle_manifest_sha256"],
                    "current_hash": verified.get("manifest_sha256"),
                    "match": matches,
                }
            except Exception:
                return {"version_id": version_id, "integrity": "MISSING_OR_TAMPERED", "match": False}

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
        if self._conn:
            self._conn.close()
            self._conn = None

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        # Deserialize JSON fields
        for json_field in ("hyperparameters", "metrics", "reference_distributions", "feature_names", "target_classes"):
            if d.get(json_field):
                d[json_field] = json.loads(d[json_field])
        d["is_active"] = bool(d.get("is_active", 0))
        d["trusted_baseline"] = bool(d.get("trusted_baseline", 0))
        return d
