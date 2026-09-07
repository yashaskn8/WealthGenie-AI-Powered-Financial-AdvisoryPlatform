"""
Tests for ML Service fail-closed configuration validation and security startup checks.
"""

import pytest
from fastapi import HTTPException
from security import validate_ml_service_config, validate_ml_operator_config, verify_api_key, verify_operator_key


def test_production_missing_api_key_raises_runtime_error():
    env = {
        "ENVIRONMENT": "production",
        "ML_SERVICE_API_KEY": "",
    }
    with pytest.raises(RuntimeError, match="ML_SERVICE_API_KEY is required in production"):
        validate_ml_service_config(env)


def test_production_placeholder_api_key_raises_runtime_error():
    env = {
        "ENVIRONMENT": "production",
        "ML_SERVICE_API_KEY": "CHANGE_ME_ML_SERVICE_API_KEY",
    }
    with pytest.raises(RuntimeError, match="Insecure placeholder ML_SERVICE_API_KEY"):
        validate_ml_service_config(env)


def test_production_valid_api_key_succeeds():
    env = {
        "ENVIRONMENT": "production",
        "ML_SERVICE_API_KEY": "secure_production_secret_key_2026",
    }
    # Should not raise
    validate_ml_service_config(env)


def test_local_dev_mode_permits_empty_api_key():
    env = {
        "ENVIRONMENT": "local",
        "ML_SERVICE_API_KEY": "",
    }
    # Should not raise in local dev mode
    validate_ml_service_config(env)


def test_production_missing_operator_key_raises_runtime_error():
    env = {
        "ENVIRONMENT": "production",
        "ML_OPERATOR_KEY": "",
    }
    with pytest.raises(RuntimeError, match="ML_OPERATOR_KEY is required in production"):
        validate_ml_operator_config(env)


def test_production_placeholder_operator_key_raises_runtime_error():
    env = {
        "ENVIRONMENT": "production",
        "ML_OPERATOR_KEY": "CHANGE_ME_OPERATOR_KEY_123",
    }
    with pytest.raises(RuntimeError, match="Insecure placeholder ML_OPERATOR_KEY"):
        validate_ml_operator_config(env)


def test_production_valid_operator_key_succeeds():
    env = {
        "ENVIRONMENT": "production",
        "ML_OPERATOR_KEY": "secure_operator_secret_key_9999",
    }
    # Should not raise
    validate_ml_operator_config(env)


def test_local_dev_mode_permits_empty_operator_key():
    env = {
        "ENVIRONMENT": "local",
        "ML_OPERATOR_KEY": "",
    }
    # Should not raise in local dev mode
    validate_ml_operator_config(env)


@pytest.mark.asyncio
async def test_verify_api_key_rejects_placeholder_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ML_SERVICE_API_KEY", "CHANGE_ME_ML_SERVICE_API_KEY")

    with pytest.raises(HTTPException) as exc_info:
        await verify_api_key("CHANGE_ME_ML_SERVICE_API_KEY")

    assert exc_info.value.status_code == 500
    assert "Insecure placeholder" in exc_info.value.detail


@pytest.mark.asyncio
async def test_verify_operator_key_rejects_placeholder_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ML_OPERATOR_KEY", "CHANGE_ME_OPERATOR_KEY")

    with pytest.raises(HTTPException) as exc_info:
        await verify_operator_key("CHANGE_ME_OPERATOR_KEY")

    assert exc_info.value.status_code == 500
    assert "Insecure placeholder" in exc_info.value.detail
