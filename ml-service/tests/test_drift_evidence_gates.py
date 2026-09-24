import pytest

from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.registry.drift_detection import compute_reference_distributions
from model.registry.drift_monitor import (
    check_drift_and_trigger_retrain,
    generate_synthetic_feature_batch,
)


class _Registry:
    def __init__(self, reference_distributions):
        self.active = {
            "version_id": "active-rf-test",
            "hyperparameters": {"feature_schema_version": FEATURE_SCHEMA_VERSION},
            "reference_distributions": reference_distributions,
        }

    def get_active_model(self, architecture):
        assert architecture == "RandomForest"
        return self.active


def test_ten_observations_are_skipped_without_training_or_candidate(monkeypatch):
    reference = generate_synthetic_feature_batch(n_samples=250, seed=42)
    store = _Registry(compute_reference_distributions(reference, FEATURE_NAMES))
    observations = generate_synthetic_feature_batch(n_samples=10, seed=43)
    monkeypatch.setattr(
        "model.registry.drift_monitor.trigger_candidate_retrain",
        lambda **kwargs: pytest.fail("insufficient drift evidence must not train a candidate"),
    )

    result = check_drift_and_trigger_retrain(
        architecture="RandomForest",
        input_df=observations,
        store=store,
        force_retrain_on_drift=True,
    )

    assert result["status"] == "SKIPPED"
    assert result["minimum_sample_count"] == 100
    assert result["retrain_triggered"] is False


def test_minimum_sample_count_tracks_active_reference_bin_count(monkeypatch):
    reference_data = generate_synthetic_feature_batch(n_samples=400, seed=51)
    reference = compute_reference_distributions(reference_data, FEATURE_NAMES, n_bins=12)
    store = _Registry(reference)
    observations = generate_synthetic_feature_batch(n_samples=110, seed=52)
    monkeypatch.setattr(
        "model.registry.drift_monitor.trigger_candidate_retrain",
        lambda **kwargs: pytest.fail("insufficient configured-bin evidence must not train"),
    )

    result = check_drift_and_trigger_retrain(
        architecture="RandomForest",
        input_df=observations,
        store=store,
        force_retrain_on_drift=True,
    )

    assert result["status"] == "SKIPPED"
    assert result["minimum_sample_count"] == 120
    assert result["retrain_triggered"] is False


def test_missing_active_reference_distribution_is_unavailable_not_synthesized(monkeypatch):
    store = _Registry(None)
    monkeypatch.setattr(
        "model.registry.drift_monitor.generate_synthetic_feature_batch",
        lambda **kwargs: pytest.fail("missing active lineage must not be synthesized"),
    )
    monkeypatch.setattr(
        "model.registry.drift_monitor.trigger_candidate_retrain",
        lambda **kwargs: pytest.fail("unavailable drift evidence must not train a candidate"),
    )

    result = check_drift_and_trigger_retrain(
        architecture="RandomForest",
        input_df=generate_synthetic_feature_batch(n_samples=150, seed=44),
        store=store,
        force_retrain_on_drift=True,
    )

    assert result["status"] == "UNAVAILABLE"
    assert result["reason"] == "DRIFT_REFERENCE_UNAVAILABLE"
    assert result["drift_detected"] is None
    assert result["retrain_triggered"] is False
    assert result["candidate_version"] is None


def test_malformed_reference_histogram_is_unavailable(monkeypatch):
    reference = compute_reference_distributions(
        generate_synthetic_feature_batch(n_samples=250, seed=61), FEATURE_NAMES
    )
    reference[FEATURE_NAMES[0]]["bin_edges"] = [1.0]
    store = _Registry(reference)
    monkeypatch.setattr(
        "model.registry.drift_monitor.trigger_candidate_retrain",
        lambda **kwargs: pytest.fail("invalid reference metadata must not train"),
    )

    result = check_drift_and_trigger_retrain(
        architecture="RandomForest",
        input_df=generate_synthetic_feature_batch(n_samples=150, seed=62),
        store=store,
        force_retrain_on_drift=True,
    )

    assert result["status"] == "UNAVAILABLE"
    assert result["reason"] == "DRIFT_REFERENCE_UNAVAILABLE"
    assert result["drift_detected"] is None
    assert result["retrain_triggered"] is False
