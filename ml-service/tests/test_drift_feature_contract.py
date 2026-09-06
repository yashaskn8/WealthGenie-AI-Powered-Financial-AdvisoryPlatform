import numpy as np

from model.registry.drift_monitor import generate_synthetic_feature_batch


def test_synthetic_drift_batch_uses_serving_feature_units_and_formulas():
    batch = generate_synthetic_feature_batch(n_samples=64, seed=123)

    assert batch["emi_burden_pct"].between(0.0, 100.0).all()
    assert batch["risk_capacity_score"].between(0.0, 100.0).all()
    assert set(batch["risk_tolerance_encoded"].unique()) <= {1.0, 3.0, 5.0}
    np.testing.assert_allclose(
        batch["savings_rate"],
        batch["monthly_savings"] / batch["monthly_take_home"],
        atol=1e-4,
    )
    np.testing.assert_allclose(
        batch["liquidity_months"],
        batch["liquid_savings"] / batch["monthly_take_home"],
        atol=1e-4,
    )
    np.testing.assert_allclose(
        batch["emergency_fund_gap_months"],
        np.maximum(0.0, 6.0 - batch["emergency_fund_months"]),
        atol=1e-4,
    )


def test_synthetic_drift_rejects_legacy_feature_names():
    import pytest

    with pytest.raises(ValueError, match="unsupported feature"):
        generate_synthetic_feature_batch(shift_feature="annual_income")
