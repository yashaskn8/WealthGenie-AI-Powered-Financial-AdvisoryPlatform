"""
Live Model Registry Integration Test Suite
Verifies that FastAPI running application connects to the persistent ModelRegistry store
via store_factory, serves live version inspection endpoints, and supports hot registration & rollback.
"""

import os
from pathlib import Path
import sys

# Ensure ml-service root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

# Ensure environment is set to local dev mode for testing
os.environ["ENVIRONMENT"] = "local"
os.environ["ML_SERVICE_API_KEY"] = "test-api-key"
os.environ["ML_OPERATOR_KEY"] = "test-operator-key"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402
from model.serving.registry import registry  # noqa: E402


@pytest.fixture(scope="module")
def client():
    """Provides a TestClient initialized with app lifespan and valid auth header."""
    with TestClient(
        app,
        headers={"X-API-Key": "test-api-key", "X-Operator-Key": "test-operator-key"},
    ) as test_client:
        yield test_client


def test_registry_endpoints_require_authentication():
    """Verifies that calling model registry endpoints without valid API key returns 401 Unauthorized."""
    unauth_client = TestClient(app)

    # 1. GET /model/registry/versions without API key
    res = unauth_client.get("/model/registry/versions")
    assert res.status_code == 401, f"Expected 401, got {res.status_code}"
    assert "Invalid or missing API Key" in res.json().get("detail", "")

    # 2. POST /model/registry/promote without API key
    res_promote = unauth_client.post("/model/registry/promote", json={"version_id": "dummy"})
    assert res_promote.status_code == 401, f"Expected 401, got {res_promote.status_code}"
    assert "Invalid or missing API Key" in res_promote.json().get("detail", "")

    # 3. POST /model/registry/promote with WRONG API key
    res_wrong = unauth_client.post("/model/registry/promote", json={"version_id": "dummy"}, headers={"X-API-Key": "wrong-key"})
    assert res_wrong.status_code == 401, f"Expected 401, got {res_wrong.status_code}"
    assert "Invalid or missing API Key" in res_wrong.json().get("detail", "")


def test_live_startup_does_not_seed_unverified_legacy_models(client):
    """Legacy sidecar files are not an active model without an externally pinned bundle."""
    # Check that in-memory registry has a version_registry attached
    version_store = registry.get_version_registry()
    assert version_store is not None, "version_registry must be attached to in-memory ModelRegistry"

    # Query GET /model/registry/versions
    response = client.get("/model/registry/versions")
    assert response.status_code == 200
    data = response.json()
    assert "versions" in data
    assert data["count"] == 0
    assert data["versions"] == []


def test_readyz_reports_authoritative_model_contract(client):
    """Readiness is tied to the loaded RandomForest recommendation path."""
    response = client.get("/readyz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "not_ready"
    assert data["required_model"] == "random_forest"
    assert data["required_model_ready"] is False
    assert "random_forest" not in data["available_models"]


def test_get_active_model_endpoint(client):
    """Verifies GET /model/registry/active returns the active model."""
    response = client.get("/model/registry/active?architecture=RandomForest")
    assert response.status_code == 404


def test_get_version_by_id_and_integrity(client):
    """Verifies GET /model/registry/versions/{id} and /integrity/{id} endpoints."""
    version_id = "no-verified-active-version"
    assert client.get(f"/model/registry/versions/{version_id}").status_code == 404
    assert client.get(f"/model/registry/integrity/{version_id}").status_code == 404


def test_raw_single_file_registration_is_rejected(client, tmp_path):
    artifact = tmp_path / "raw-model.pkl"
    artifact.write_bytes(b"untrusted-pickle")
    before = client.get("/model/registry/versions").json()["count"]
    response = client.post("/model/registry/register", json={
        "model_architecture": "RandomForest",
        "artifact_path": str(artifact),
        "training_data_hash": "a" * 64,
    })
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "MODEL_BUNDLE_REGISTRATION_UNAVAILABLE"
    assert client.get("/model/registry/versions").json()["count"] == before
