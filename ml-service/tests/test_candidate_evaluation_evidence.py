"""Measured model-evaluation evidence must be reproducible and tamper-evident."""

import hashlib
import json
from pathlib import Path

import pytest

from model.artifacts.bundle import verify_bundle
from model.artifacts.store import LocalArtifactStore
from model.evaluation.candidate_evidence import evaluate_candidate_bundle
from model.registry.registry_store import ModelRegistry


class _CandidateStore:
    def __init__(self, candidate, artifact_store):
        self.candidate = candidate
        self.artifact_store = artifact_store
        self.evidence = None

    def get_version(self, version_id):
        return self.candidate if version_id == self.candidate["version_id"] else None

    def record_evaluation_evidence(self, evidence):
        self.evidence = evidence
        return evidence


def test_sqlite_bundle_registration_uses_complete_verified_bundle(tmp_path):
    source = Path(__file__).resolve().parents[1] / "model" / "bundles" / "random_forest"
    manifest = json.loads((source / "bundle.manifest.json").read_text(encoding="utf-8"))
    verified = verify_bundle(source, manifest["bundle_manifest_sha256"])
    verified["bundle_dir"] = source
    artifact_store = LocalArtifactStore(tmp_path / "immutable-artifacts")
    store = ModelRegistry(tmp_path / "registry.sqlite")

    candidate = store.register_verified_bundle(verified, artifact_store)

    assert candidate["lifecycle_state"] == "CANDIDATE"
    assert candidate["bundle_id"] == manifest["bundle_id"]
    assert candidate["bundle_manifest_sha256"] == manifest["bundle_manifest_sha256"]
    assert store.get_active_model("RandomForest") is None


def test_random_forest_evaluator_measures_reproduced_holdout_and_binds_report(tmp_path):
    source = Path(__file__).resolve().parents[1] / "model" / "bundles" / "random_forest"
    manifest = json.loads((source / "bundle.manifest.json").read_text(encoding="utf-8"))
    artifact_store = LocalArtifactStore(tmp_path / "immutable-artifacts")
    artifact_store.put_bundle(source, manifest["bundle_manifest_sha256"])
    candidate = {
        "version_id": "shadow-rf-verified",
        "model_architecture": "RandomForest",
        "lifecycle_state": "SHADOW",
        "bundle_id": manifest["bundle_id"],
        "bundle_manifest_sha256": manifest["bundle_manifest_sha256"],
        "training_data_hash": manifest["training_data_hash"],
    }
    store = _CandidateStore(candidate, artifact_store)

    result = evaluate_candidate_bundle(
        version_store=store,
        version_id=candidate["version_id"],
        evaluator_git_sha="a" * 40,
    )

    report = result["report"]
    assert report["test_samples"] == 300
    assert report["training_data_hash"] == manifest["training_data_hash"]
    assert report["metric_interpretation"].startswith("synthetic suitability-policy")
    assert set(result["metrics"]) == {"rule_approximation_fidelity", "balanced_accuracy", "macro_f1"}
    assert all(0 <= value <= 1 for value in result["metrics"].values())
    assert store.evidence["report"] == {key: value for key, value in report.items() if key != "report_sha256"}
    assert hashlib.sha256(
        json.dumps(store.evidence["report"], sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest() == store.evidence["report_sha256"]


def test_evaluator_rejects_registry_dataset_hash_drift_before_inference(tmp_path):
    source = Path(__file__).resolve().parents[1] / "model" / "bundles" / "random_forest"
    manifest = json.loads((source / "bundle.manifest.json").read_text(encoding="utf-8"))
    artifact_store = LocalArtifactStore(tmp_path / "immutable-artifacts")
    artifact_store.put_bundle(source, manifest["bundle_manifest_sha256"])
    candidate = {
        "version_id": "shadow-rf-bad-lineage",
        "model_architecture": "RandomForest",
        "lifecycle_state": "SHADOW",
        "bundle_id": manifest["bundle_id"],
        "bundle_manifest_sha256": manifest["bundle_manifest_sha256"],
        "training_data_hash": "0" * 64,
    }

    with pytest.raises(ValueError, match="registry data hash"):
        evaluate_candidate_bundle(
            version_store=_CandidateStore(candidate, artifact_store),
            version_id=candidate["version_id"],
            evaluator_git_sha="a" * 40,
        )


def test_sqlite_evaluation_report_and_evidence_are_immutable(tmp_path):
    store = ModelRegistry(tmp_path / "registry.sqlite")
    source = Path(__file__).resolve().parents[1] / "model" / "bundles" / "random_forest"
    manifest = json.loads((source / "bundle.manifest.json").read_text(encoding="utf-8"))
    verified = verify_bundle(source, manifest["bundle_manifest_sha256"])
    verified["bundle_dir"] = source
    artifact_store = LocalArtifactStore(tmp_path / "immutable-artifacts")
    candidate = store.register_verified_bundle(verified, artifact_store)
    store.update_lifecycle_state(candidate["version_id"], "SHADOW")
    report = {
        "evaluation_run_id": "eval-immutable-1",
        "candidate_version_id": candidate["version_id"],
        "candidate_bundle_id": manifest["bundle_id"],
        "candidate_bundle_hash": manifest["bundle_manifest_sha256"],
        "evaluation_dataset_hash": "2" * 64,
        "evaluator_version": "candidate-heldout-evaluator-v1",
        "evaluator_git_sha": "a" * 40,
        "metrics": {"balanced_accuracy": 0.8, "macro_f1": 0.75, "rule_approximation_fidelity": 0.82},
    }
    canonical = json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    evidence = {
        **report,
        "timestamp": "2026-09-25T00:00:00+00:00",
        "report_sha256": hashlib.sha256(canonical).hexdigest(),
        "report": report,
    }
    stored = store.record_evaluation_evidence(evidence)
    assert stored["report"] == report
    assert store.get_evaluation_evidence("eval-immutable-1")["report_sha256"] == evidence["report_sha256"]
    store._get_conn().execute(
        "UPDATE model_evaluation_evidence SET report_json=? WHERE evaluation_run_id=?",
        ("{}", "eval-immutable-1"),
    )
    store._get_conn().commit()
    with pytest.raises(RuntimeError, match="report hash mismatch|evidence hash mismatch"):
        store.get_evaluation_evidence("eval-immutable-1")
