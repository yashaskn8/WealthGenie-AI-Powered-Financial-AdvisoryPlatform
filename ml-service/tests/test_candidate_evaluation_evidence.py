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


def test_sqlite_registry_rejects_metrics_from_substituted_report_path(tmp_path):
    source = Path(__file__).resolve().parents[1] / "model" / "bundles" / "random_forest"
    manifest = json.loads((source / "bundle.manifest.json").read_text(encoding="utf-8"))
    verified = verify_bundle(source, manifest["bundle_manifest_sha256"])
    verified["bundle_dir"] = source
    substituted = tmp_path / "evaluation_report.json"
    substituted.write_text(json.dumps({
        "evaluation_run_id": manifest["evaluation_report_id"],
        "architecture": "RandomForest",
        "training_data_hash": manifest["training_data_hash"],
        "metrics": {"balanced_accuracy": 0.999, "macro_f1": 0.999},
    }), encoding="utf-8")
    verified["members"]["evaluation_report"] = substituted
    store = ModelRegistry(tmp_path / "registry.sqlite")

    with pytest.raises(ValueError, match="evaluation report bytes do not match"):
        store.register_verified_bundle(verified, LocalArtifactStore(tmp_path / "artifacts"))

    assert store.list_versions("RandomForest") == []


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


def _register_shadow_with_evidence(tmp_path, store, artifact_store, metrics, run_id):
    source = Path(__file__).resolve().parents[1] / "model" / "bundles" / "random_forest"
    manifest = json.loads((source / "bundle.manifest.json").read_text(encoding="utf-8"))
    verified = verify_bundle(source, manifest["bundle_manifest_sha256"])
    verified["bundle_dir"] = source
    candidate = store.register_verified_bundle(verified, artifact_store)
    store.update_lifecycle_state(candidate["version_id"], "SHADOW")
    report = {
        "evaluation_run_id": run_id,
        "candidate_version_id": candidate["version_id"],
        "candidate_bundle_id": candidate["bundle_id"],
        "candidate_bundle_hash": candidate["bundle_manifest_sha256"],
        "evaluation_dataset_hash": "3" * 64,
        "evaluator_version": "candidate-heldout-evaluator-v1",
        "evaluator_git_sha": "b" * 40,
        "metrics": metrics,
    }
    report_bytes = json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    evidence = {
        **report,
        "timestamp": "2026-09-25T00:00:00+00:00",
        "report_sha256": hashlib.sha256(report_bytes).hexdigest(),
        "report": report,
    }
    store.record_evaluation_evidence(evidence)
    return candidate, evidence


def _register_active_legacy_baseline(tmp_path, store, metrics, suffix):
    artifact = tmp_path / f"{suffix}.pkl"
    artifact.write_bytes(f"{suffix}-baseline".encode())
    return store.register_model(
        model_architecture="RandomForest",
        artifact_path=artifact,
        training_data_hash="4" * 64,
        training_timestamp="2026-09-24T12:00:00+00:00",
        hyperparameters={},
        metrics=metrics,
        set_active=True,
    )


def test_sqlite_candidate_validation_rejects_regression_against_active_baseline(tmp_path):
    from model.registry.promotion_policy import PROMOTION_TRACKED_METRICS

    active_metrics = {name: 0.9 for name in PROMOTION_TRACKED_METRICS}
    candidate_metrics = {name: 0.0 for name in PROMOTION_TRACKED_METRICS}
    store = ModelRegistry(tmp_path / "registry.sqlite")
    artifact_store = LocalArtifactStore(tmp_path / "artifacts")
    _register_active_legacy_baseline(tmp_path, store, active_metrics, "active")
    candidate, evidence = _register_shadow_with_evidence(
        tmp_path, store, artifact_store, candidate_metrics, "eval-regressing-candidate",
    )

    with pytest.raises(ValueError, match="regress against active baseline"):
        store.validate_version_with_evidence(candidate["version_id"], evidence["evaluation_run_id"])

    assert store.get_version(candidate["version_id"])["lifecycle_state"] == "SHADOW"
    assert store.get_active_model("RandomForest")["metrics"] == active_metrics


def test_sqlite_promotion_binds_validation_to_baseline_and_rechecks_before_activation(tmp_path):
    from model.registry.promotion_policy import PROMOTION_TRACKED_METRICS

    active_metrics = {name: 0.9 for name in PROMOTION_TRACKED_METRICS}
    passing_metrics = {name: 0.89 for name in PROMOTION_TRACKED_METRICS}
    store = ModelRegistry(tmp_path / "registry.sqlite")
    artifact_store = LocalArtifactStore(tmp_path / "artifacts")
    baseline_id = _register_active_legacy_baseline(tmp_path, store, active_metrics, "active")
    baseline = store.get_version(baseline_id)
    candidate, evidence = _register_shadow_with_evidence(
        tmp_path, store, artifact_store, passing_metrics, "eval-passing-candidate",
    )

    validated = store.validate_version_with_evidence(candidate["version_id"], evidence["evaluation_run_id"])
    assert validated["lifecycle_state"] == "VALIDATED"
    assert validated["validation_baseline_version_id"] == baseline_id
    assert validated["validation_baseline_generation"] == baseline["activation_generation"]
    active = store.activate_version(
        candidate["version_id"],
        expected_active_version_id=baseline_id,
        expected_activation_generation=baseline["activation_generation"],
    )
    assert active["lifecycle_state"] == "ACTIVE"
    stored_evidence = store.get_evaluation_evidence(evidence["evaluation_run_id"])
    assert active["validation_evidence_sha256"] == stored_evidence["evidence_sha256"]


def test_sqlite_promotion_rejects_candidate_validated_against_stale_baseline(tmp_path):
    from model.registry.promotion_policy import PROMOTION_TRACKED_METRICS

    metrics = {name: 0.9 for name in PROMOTION_TRACKED_METRICS}
    store = ModelRegistry(tmp_path / "registry.sqlite")
    artifact_store = LocalArtifactStore(tmp_path / "artifacts")
    first_baseline_id = _register_active_legacy_baseline(tmp_path, store, metrics, "first-active")
    first_baseline = store.get_version(first_baseline_id)
    candidate, evidence = _register_shadow_with_evidence(
        tmp_path, store, artifact_store, metrics, "eval-stale-baseline-candidate",
    )
    store.validate_version_with_evidence(candidate["version_id"], evidence["evaluation_run_id"])

    replacement_baseline_id = _register_active_legacy_baseline(tmp_path, store, metrics, "replacement-active")
    replacement_baseline = store.get_version(replacement_baseline_id)
    with pytest.raises(RuntimeError, match="baseline changed before activation"):
        store.activate_version(
            candidate["version_id"],
            expected_active_version_id=replacement_baseline_id,
            expected_activation_generation=replacement_baseline["activation_generation"],
        )

    assert store.get_version(candidate["version_id"])["lifecycle_state"] == "VALIDATED"
    assert store.get_active_model("RandomForest")["version_id"] == replacement_baseline_id
    assert first_baseline["version_id"] != replacement_baseline_id
