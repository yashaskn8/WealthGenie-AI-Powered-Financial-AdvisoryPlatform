"""
Live Model Registry Integration Test Suite
Verifies that FastAPI running application connects to the persistent ModelRegistry store
via store_factory, serves live version inspection endpoints, and supports hot registration & rollback.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

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


def test_live_startup_seeds_and_resolves_version_registry(client):
    """Verifies that upon startup, the version registry has active models seeded and resolved."""
    # Check that in-memory registry has a version_registry attached
    version_store = registry.get_version_registry()
    assert version_store is not None, "version_registry must be attached to in-memory ModelRegistry"

    # Query GET /model/registry/versions
    response = client.get("/model/registry/versions")
    assert response.status_code == 200
    data = response.json()
    assert "versions" in data
    assert data["count"] >= 1
    
    # Check that RandomForest version is present and has an active version
    rf_versions = [v for v in data["versions"] if v["model_architecture"] == "RandomForest"]
    assert len(rf_versions) >= 1
    assert any(v["is_active"] for v in rf_versions), "At least one RandomForest version must be active"
    assert rf_versions[0]["artifact_hash"] is not None


def test_get_active_model_endpoint(client):
    """Verifies GET /model/registry/active returns the active model."""
    response = client.get("/model/registry/active?architecture=RandomForest")
    assert response.status_code == 200
    data = response.json()
    assert "active_model" in data
    active = data["active_model"]
    assert active["model_architecture"] == "RandomForest"
    assert active["is_active"] is True
    assert "artifact_hash" in active
    assert "metrics" in active


def test_get_version_by_id_and_integrity(client):
    """Verifies GET /model/registry/versions/{id} and /integrity/{id} endpoints."""
    # Get active version ID
    active_res = client.get("/model/registry/active?architecture=RandomForest")
    version_id = active_res.json()["active_model"]["version_id"]

    # Fetch version details
    ver_res = client.get(f"/model/registry/versions/{version_id}")
    assert ver_res.status_code == 200
    ver_data = ver_res.json()
    assert ver_data["version_id"] == version_id
    assert ver_data["model_architecture"] == "RandomForest"

    # Verify SHA-256 integrity
    int_res = client.get(f"/model/registry/integrity/{version_id}")
    assert int_res.status_code == 200
    int_data = int_res.json()
    assert int_data["integrity"] == "VERIFIED"
    assert int_data["match"] is True


def test_live_register_new_version_and_rollback(client):
    """
    Tests live end-to-end model version registration and rollback via the running HTTP service.
    """
    # 1. Get initial active version
    initial_active_res = client.get("/model/registry/active?architecture=RandomForest")
    v1 = initial_active_res.json()["active_model"]
    v1_id = v1["version_id"]

    # 2. Create a temporary model artifact copy as v2
    base_rf_path = Path(initial_active_res.json()["active_model"]["artifact_path"])
    temp_dir = tempfile.mkdtemp()
    v2_artifact_path = Path(temp_dir) / "model_v2.pkl"
    shutil.copyfile(base_rf_path, v2_artifact_path)

    try:
        # 3. Register v2 as a candidate, then advance through the enforced lifecycle.
        reg_payload = {
            "model_architecture": "RandomForest",
            "artifact_path": str(v2_artifact_path),
            "training_data_hash": v1["training_data_hash"],
            "hyperparameters": v1["hyperparameters"],
            "reference_distributions": v1["reference_distributions"],
            "metrics": {
                name: v1["metrics"][name]
                for name in ("rule_approximation_fidelity", "balanced_accuracy", "macro_f1")
            },
            "notes": "v2 release candidate",
            "set_active": False,
        }
        reg_res = client.post("/model/registry/register", json=reg_payload)
        assert reg_res.status_code == 201
        v2_data = reg_res.json()
        v2_id = v2_data["version_id"]
        assert v2_data["is_active"] is False
        assert v2_data["lifecycle_state"] == "CANDIDATE"

        shadow_res = client.post("/model/registry/shadow/configure", json={"version_id": v2_id})
        assert shadow_res.status_code == 200
        validation_res = client.post(
            f"/model/registry/validate/{v2_id}",
            json={"metrics": reg_payload["metrics"]},
        )
        assert validation_res.status_code == 200
        promotion_res = client.post("/model/registry/promote", json={"version_id": v2_id})
        assert promotion_res.status_code == 200

        # 4. Verify v2 is now active in live service
        active_res_v2 = client.get("/model/registry/active?architecture=RandomForest")
        assert active_res_v2.status_code == 200
        assert active_res_v2.json()["active_model"]["version_id"] == v2_id

        # 5. Roll back to v1 via POST /model/registry/rollback/{v1_id}
        rb_res = client.post(f"/model/registry/rollback/{v1_id}")
        assert rb_res.status_code == 200
        rb_data = rb_res.json()
        assert rb_data["status"] == "rolled_back"
        assert rb_data["active_version"]["version_id"] == v1_id

        # 6. Verify v1 is now active again
        active_res_v1_restored = client.get("/model/registry/active?architecture=RandomForest")
        assert active_res_v1_restored.json()["active_model"]["version_id"] == v1_id

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
