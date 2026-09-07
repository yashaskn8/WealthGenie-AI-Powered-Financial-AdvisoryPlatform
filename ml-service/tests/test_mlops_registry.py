"""
Phase 5 MLOps Test Suite — Model Registry, Drift Detection, and Governance

Tests:
  1. Registry: register 2+ versions, confirm queryable with correct metrics
  2. Rollback tamper check: corrupt artifact, attempt rollback, confirm hash-mismatch blocks it
  3. Rollback success: rollback updates active-version pointer correctly
  4. Drift — no false positive: same-distribution data reports no drift
  5. Drift — true positive with feature-specific identification
  6. Drift — per-feature specificity: only ONE shifted feature flagged by name
  7. End-to-end governance check wiring
"""

import os
import shutil
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Ensure project root is importable
import sys
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from model.registry.registry_store import ModelRegistry, compute_file_hash
from model.registry.drift_detection import (
    compute_reference_distributions,
    run_drift_check,
    compute_psi,
    PSI_THRESHOLD_FAIL,
)
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.data.preprocessing import prepare_synthetic_training_data, compute_dataset_hash_from_arrays

# ---------- Shared fixtures ----------

MODEL_FEATURES = FEATURE_NAMES


def _make_synthetic_data(n: int = 2000, seed: int = 42) -> pd.DataFrame:
    """Generate data through the same ordered v4 contract as training."""
    features, _ = prepare_synthetic_training_data(num_samples=n, seed=seed)
    return pd.DataFrame(features, columns=MODEL_FEATURES)


@pytest.fixture
def temp_dir():
    """Provide a temporary directory that is cleaned up after the test."""
    d = tempfile.mkdtemp(prefix="wg_registry_test_")
    yield Path(d)
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def registry(temp_dir):
    """Create a fresh registry in a temp directory."""
    db_path = temp_dir / "test_registry.db"
    reg = ModelRegistry(db_path=db_path)
    yield reg
    reg.close()


@pytest.fixture
def fake_artifacts(temp_dir):
    """Create two distinct fake model artifact files."""
    art1 = temp_dir / "model_v1.pkl"
    art2 = temp_dir / "model_v2.pkl"
    art1.write_bytes(b"model-artifact-version-1-content-bytes-" + os.urandom(64))
    art2.write_bytes(b"model-artifact-version-2-content-bytes-" + os.urandom(64))
    return art1, art2


@pytest.fixture
def sample_rigor_metrics():
    """Version-specific v4 policy-fidelity evidence."""
    return {
        "v1": {
            "rule_approximation_fidelity": 0.9837,
            "balanced_accuracy": 0.9820,
            "macro_f1": 0.9810,
        },
        "v2": {
            "rule_approximation_fidelity": 0.9705,
            "balanced_accuracy": 0.9690,
            "macro_f1": 0.9680,
        },
    }


# =====================================================================
# PART A — Model Registry Tests
# =====================================================================


class TestModelRegistry:
    """Tests for register / list / get / rollback operations."""

    def test_register_and_query_two_versions(
        self, registry, fake_artifacts, sample_rigor_metrics
    ):
        """
        Register 2 model versions with distinct artifacts and metrics.
        Confirm both are queryable and contain the correct, distinct metrics
        supplied as explicit v4 validation evidence.
        """
        art1, art2 = fake_artifacts

        # Register version 1 (RF)
        v1_id = registry.register_model(
            model_architecture="RandomForest",
            artifact_path=art1,
            training_data_hash="sha256-dataset-hash-abc123",
            training_timestamp="2026-07-23T19:28:42+00:00",
            hyperparameters={"n_estimators": 100, "max_depth": 15},
            metrics=sample_rigor_metrics["v1"],
            set_active=True,
        )

        # Register version 2 (FT-Transformer)
        v2_id = registry.register_model(
            model_architecture="FT_Transformer",
            artifact_path=art2,
            training_data_hash="sha256-dataset-hash-def456",
            training_timestamp="2026-07-31T10:13:33+00:00",
            hyperparameters={"d_token": 32, "n_blocks": 3, "n_heads": 4},
            metrics=sample_rigor_metrics["v2"],
            set_active=True,
        )

        # Query both
        v1 = registry.get_version(v1_id)
        v2 = registry.get_version(v2_id)

        assert v1 is not None
        assert v2 is not None

        # Verify distinct policy-fidelity evidence survives the registry round trip.
        assert v1["metrics"]["rule_approximation_fidelity"] == 0.9837
        assert v1["metrics"]["balanced_accuracy"] == 0.9820
        assert v2["metrics"]["rule_approximation_fidelity"] == 0.9705
        assert v2["metrics"]["balanced_accuracy"] == 0.9690

        # Verify architectures are distinct
        assert v1["model_architecture"] == "RandomForest"
        assert v2["model_architecture"] == "FT_Transformer"

        # Verify artifact hashes are real SHA-256 (64 hex chars), not empty/placeholder
        assert len(v1["artifact_hash"]) == 64
        assert len(v2["artifact_hash"]) == 64
        assert v1["artifact_hash"] != v2["artifact_hash"]  # distinct artifacts

        # Verify list returns both
        all_versions = registry.list_versions()
        assert len(all_versions) >= 2
        version_ids = {v["version_id"] for v in all_versions}
        assert v1_id in version_ids
        assert v2_id in version_ids

    def test_rollback_blocks_on_tampered_artifact(
        self, registry, fake_artifacts, sample_rigor_metrics
    ):
        """
        Register a model, then corrupt (mutate) its artifact file on disk.
        Attempt rollback and confirm the hash-mismatch check blocks it.

        This is the same tamper-evidence pattern as Phase 2's governance system:
        an unverified rollback target must be refused.
        """
        art1, art2 = fake_artifacts

        # Register version with known artifact
        v_id = registry.register_model(
            model_architecture="RandomForest",
            artifact_path=art1,
            training_data_hash="hash-abc",
            training_timestamp="2026-07-23T00:00:00+00:00",
            hyperparameters={"n_estimators": 100},
            metrics=sample_rigor_metrics["v1"],
            set_active=True,
        )

        # Record the original hash
        original_hash = registry.get_version(v_id)["artifact_hash"]
        assert len(original_hash) == 64

        # Corrupt the artifact file AFTER registration
        with open(art1, "ab") as f:
            f.write(b"\x00TAMPERED_BYTES\x00")

        # Confirm the file's hash has actually changed
        current_hash = compute_file_hash(art1)
        assert current_hash != original_hash, (
            "Test setup failure: corruption didn't change the hash"
        )

        # Attempt rollback — must be REFUSED with RuntimeError
        with pytest.raises(RuntimeError, match="TAMPER DETECTED"):
            registry.rollback_to_version(v_id)

    def test_rollback_blocks_on_missing_artifact(
        self, registry, fake_artifacts, sample_rigor_metrics
    ):
        """Rollback to a version whose artifact file has been deleted must fail."""
        art1, _ = fake_artifacts

        v_id = registry.register_model(
            model_architecture="RandomForest",
            artifact_path=art1,
            training_data_hash="hash-abc",
            training_timestamp="2026-07-23T00:00:00+00:00",
            hyperparameters={"n_estimators": 100},
            metrics=sample_rigor_metrics["v1"],
            set_active=True,
        )

        # Delete the artifact
        art1.unlink()
        assert not art1.exists()

        with pytest.raises(FileNotFoundError, match="Artifact file missing"):
            registry.rollback_to_version(v_id)

    def test_successful_rollback_updates_active_pointer(
        self, registry, fake_artifacts, sample_rigor_metrics
    ):
        """
        Register 2 versions of the same architecture. Activate v2.
        Roll back to v1. Confirm get_active_model() returns v1.
        """
        art1, art2 = fake_artifacts

        v1_id = registry.register_model(
            model_architecture="RandomForest",
            artifact_path=art1,
            training_data_hash="hash-abc",
            training_timestamp="2026-07-23T00:00:00+00:00",
            hyperparameters={"n_estimators": 100},
            metrics=sample_rigor_metrics["v1"],
            set_active=True,
        )

        v2_id = registry.register_model(
            model_architecture="RandomForest",
            artifact_path=art2,
            training_data_hash="hash-def",
            training_timestamp="2026-07-31T00:00:00+00:00",
            hyperparameters={"n_estimators": 200},
            metrics=sample_rigor_metrics["v2"],
            set_active=True,  # v2 is now active
        )

        # Confirm v2 is active
        active = registry.get_active_model(architecture="RandomForest")
        assert active["version_id"] == v2_id

        # Roll back to v1
        rolled_back = registry.rollback_to_version(v1_id)
        assert rolled_back["is_active"] is True
        assert rolled_back["version_id"] == v1_id

        # Confirm active pointer now returns v1
        active_after = registry.get_active_model(architecture="RandomForest")
        assert active_after["version_id"] == v1_id

        # Confirm v2 is no longer active
        v2_record = registry.get_version(v2_id)
        assert v2_record["is_active"] is False


# =====================================================================
# PART B — Drift Detection Tests
# =====================================================================


class TestDriftDetection:
    """Tests for PSI-based drift monitoring."""

    def test_no_false_positive_same_distribution(self):
        """
        Test 1 (no false positive): draw reference and new data from the SAME
        distribution (different random seed, same parameters). Assert no
        significant drift is reported.

        A drift monitor that fires on its own training distribution is useless.
        """
        # Training data
        df_train = _make_synthetic_data(n=5000, seed=42)
        ref_dists = compute_reference_distributions(df_train, MODEL_FEATURES)

        # New batch from SAME distribution (different seed = different samples,
        # but same generative process)
        df_new = _make_synthetic_data(n=2000, seed=99)

        report = run_drift_check(ref_dists, df_new, MODEL_FEATURES)

        assert report["overall_verdict"] in ("PASS", "WARN"), (
            f"False positive: drift reported on same-distribution data. "
            f"Drifted features: {report['drifted_features']}"
        )
        # Specifically: no features should be SIGNIFICANTLY drifted
        assert len(report["drifted_features"]) == 0, (
            f"False positive: {report['drifted_features']} flagged as significantly "
            f"drifted despite coming from the same distribution"
        )

    def test_true_positive_shifted_distribution(self):
        """
        Test 2 (true positive): construct a synthetic batch with
        monthly_take_home shifted UP by 3 standard deviations.
        Assert the drift check correctly flags that feature and
        produces a FAIL verdict.
        """
        df_train = _make_synthetic_data(n=5000, seed=42)
        ref_dists = compute_reference_distributions(df_train, MODEL_FEATURES)

        # Create shifted batch: shift monthly take-home by 3 stds
        df_shifted = _make_synthetic_data(n=2000, seed=99)
        income_std = df_train["monthly_take_home"].std()
        df_shifted["monthly_take_home"] = df_shifted["monthly_take_home"] + (3 * income_std)

        report = run_drift_check(ref_dists, df_shifted, MODEL_FEATURES)

        # Must detect drift
        assert report["overall_verdict"] == "FAIL", (
            f"Missed 3-std shift in monthly_take_home. Verdict: {report['overall_verdict']}"
        )
        assert "monthly_take_home" in report["drifted_features"], (
            f"monthly_take_home not in drifted features: {report['drifted_features']}"
        )

        # Verify the PSI value is above the FAIL threshold
        income_psi = report["per_feature"]["monthly_take_home"]["psi"]
        assert income_psi >= PSI_THRESHOLD_FAIL, (
            f"monthly_take_home PSI ({income_psi}) below FAIL threshold ({PSI_THRESHOLD_FAIL})"
        )

    def test_per_feature_specificity_single_shift(self):
        """
        Test 3 (per-feature specificity): shift ONLY risk_capacity_score and leave
        everything else untouched. Assert the drift report identifies
        risk_capacity_score by name as drifted, and does NOT flag the untouched features.

        This proves the monitor can say WHICH feature drifted, not just
        "something drifted" generically.
        """
        df_train = _make_synthetic_data(n=5000, seed=42)
        ref_dists = compute_reference_distributions(df_train, MODEL_FEATURES)

        # Create new batch identical to a same-distribution draw
        df_new = _make_synthetic_data(n=2000, seed=99)

        # Shift only risk capacity to an extreme high-capacity population.
        df_new["risk_capacity_score"] = np.random.RandomState(123).uniform(98, 100, len(df_new))

        report = run_drift_check(ref_dists, df_new, MODEL_FEATURES)

        # risk_capacity_score must be flagged
        assert "risk_capacity_score" in report["drifted_features"], (
            f"risk_capacity_score not detected as drifted. "
            f"Drifted: {report['drifted_features']}, "
            f"risk_capacity_score PSI: {report['per_feature'].get('risk_capacity_score', {}).get('psi')}"
        )

        # No OTHER features should be significantly drifted
        other_drifted = [f for f in report["drifted_features"] if f != "risk_capacity_score"]
        assert len(other_drifted) == 0, (
            f"False positives on unshifted features: {other_drifted}"
        )

        # Verify the report contains per-feature detail for all features
        assert report["total_features_checked"] == len(MODEL_FEATURES)

    def test_psi_computation_sanity(self):
        """Verify PSI computation is mathematically correct on a known case."""
        # Identical distributions → PSI ≈ 0
        uniform = np.array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])
        psi_same = compute_psi(uniform, uniform)
        assert psi_same < 0.001, f"PSI of identical distributions should be ~0, got {psi_same}"

        # Completely different distributions → PSI >> 0.2
        all_left = np.array([0.9, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        all_right = np.array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.9])
        psi_different = compute_psi(all_left, all_right)
        assert psi_different > PSI_THRESHOLD_FAIL, (
            f"PSI of maximally different distributions should be >> 0.2, got {psi_different}"
        )


# =====================================================================
# PART C — End-to-End Governance Wiring Test
# =====================================================================


class TestGovernanceWiring:
    """Test that registry + drift detection wire together correctly."""

    def test_governance_end_to_end(self, temp_dir):
        """
        Full end-to-end test:
        1. Create a registry and register a model with reference distributions
        2. Run drift check against same-distribution data → PASS
        3. Run drift check against shifted data → FAIL with specific feature
        4. Verify the active model's integrity check passes
        """
        db_path = temp_dir / "e2e_registry.db"
        registry = ModelRegistry(db_path=db_path)

        # Create fake artifact
        artifact = temp_dir / "model_e2e.pkl"
        artifact.write_bytes(b"e2e-model-artifact-" + os.urandom(32))

        # Generate training data and reference distributions
        df_train = _make_synthetic_data(n=3000, seed=42)
        ref_dists = compute_reference_distributions(df_train, MODEL_FEATURES)

        # Register with reference distributions
        v_id = registry.register_model(
            model_architecture="RandomForest",
            artifact_path=artifact,
            training_data_hash="e2e-data-hash",
            training_timestamp="2026-08-01T00:00:00+00:00",
            hyperparameters={"n_estimators": 100},
            metrics={
                "rule_approximation_fidelity": 0.9837,
                "balanced_accuracy": 0.9820,
            },
            reference_distributions=ref_dists,
            set_active=True,
        )

        # Verify active model
        active = registry.get_active_model(architecture="RandomForest")
        assert active is not None
        assert active["version_id"] == v_id
        assert active["reference_distributions"] is not None

        # Integrity check passes (artifact untouched)
        integrity = registry.verify_artifact_integrity(v_id)
        assert integrity["integrity"] == "VERIFIED"

        # Drift check — same distribution → PASS
        df_same = _make_synthetic_data(n=1000, seed=77)
        report_pass = run_drift_check(active["reference_distributions"], df_same, MODEL_FEATURES)
        assert report_pass["overall_verdict"] in ("PASS", "WARN")
        assert len(report_pass["drifted_features"]) == 0

        # Drift check — shifted distribution → FAIL
        df_shifted = _make_synthetic_data(n=1000, seed=77)
        df_shifted["monthly_take_home"] = df_shifted["monthly_take_home"] + (4 * df_train["monthly_take_home"].std())
        report_fail = run_drift_check(active["reference_distributions"], df_shifted, MODEL_FEATURES)
        assert report_fail["overall_verdict"] == "FAIL"
        assert "monthly_take_home" in report_fail["drifted_features"]

        registry.close()


# =====================================================================
# Integration: register real v4 artifacts (only if artifacts exist)
# =====================================================================


class TestRealModelRegistration:
    """Registry integration against the current frozen-contract artifacts."""

    REAL_MODEL_DIR = PROJECT_ROOT / "model"
    RIGOR_REPORT = REAL_MODEL_DIR / "rigor_evaluation_report.json"

    @pytest.mark.skipif(
        not (PROJECT_ROOT / "model" / "model.pkl").exists(),
        reason="Real model artifacts not available"
    )
    def test_register_available_v4_models(self, temp_dir):
        """
        Register all available artifacts through the same v4 metadata and rigor
        extraction code as the CLI. No v3 dataset or benchmark may participate.
        """
        from scripts.register_model import (
            extract_architecture_metrics,
            extract_hyperparameters,
            load_rigor_report,
        )

        db_path = temp_dir / "real_registry.db"
        registry = ModelRegistry(db_path=db_path)

        rigor_report = load_rigor_report(self.RIGOR_REPORT)

        artifacts = {
            "RandomForest": self.REAL_MODEL_DIR / "model.pkl",
            "PyTorch_MLP": self.REAL_MODEL_DIR / "saved_models" / "mlp_model.pt",
            "FT_Transformer": self.REAL_MODEL_DIR / "saved_models" / "ft_transformer.pt",
        }

        registered_ids = {}
        reference_x, reference_y = prepare_synthetic_training_data(num_samples=500, seed=42)
        training_hash = compute_dataset_hash_from_arrays(reference_x, reference_y)
        ref_dists = compute_reference_distributions(
            pd.DataFrame(reference_x, columns=MODEL_FEATURES), MODEL_FEATURES
        )

        for arch, art_path in artifacts.items():
            if not art_path.exists():
                continue

            metrics = extract_architecture_metrics(rigor_report, arch)
            hyperparameters = extract_hyperparameters(arch)
            hyperparameters.update({
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "feature_names": FEATURE_NAMES,
            })

            v_id = registry.register_model(
                model_architecture=arch,
                artifact_path=art_path,
                training_data_hash=training_hash,
                training_timestamp="2026-09-07T00:00:00+00:00",
                hyperparameters=hyperparameters,
                metrics=metrics,
                reference_distributions=ref_dists,
                set_active=True,
            )
            registered_ids[arch] = v_id

        # Verify all registered
        all_versions = registry.list_versions()
        assert len(all_versions) >= len(registered_ids)

        for arch, v_id in registered_ids.items():
            v = registry.get_version(v_id)
            assert v["hyperparameters"]["feature_schema_version"] == FEATURE_SCHEMA_VERSION
            assert v["hyperparameters"]["feature_names"] == FEATURE_NAMES
            assert set(v["reference_distributions"]) == set(FEATURE_NAMES)
            assert "independent_cfp_benchmark_accuracy" not in v["metrics"]
            assert v["metrics"]["feature_contract_audit"]["finding"] == "PASS"
            if arch == "RandomForest":
                assert v["metrics"]["rule_approximation_fidelity"] == rigor_report["metric_reframe"][
                    "policy_approximation_fidelity_random_forest"
                ]
            assert len(v["artifact_hash"]) == 64

        registry.close()
