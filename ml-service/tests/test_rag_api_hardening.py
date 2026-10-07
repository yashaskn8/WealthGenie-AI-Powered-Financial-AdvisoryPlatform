"""
WealthGenie RAG Subsystem - API Hardening Test Suite
Tests security headers, sliding window rate limiting, input validation rules, and error payloads.
"""

import os
import json
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from main import app
from rag.router import (
    MAX_TRACKED_RATE_LIMIT_BUCKETS,
    MAX_INGEST_TEXT_CHARS,
    _GLOBAL_RATE_LIMIT_TIMESTAMPS,
    _RATE_LIMIT_STORE,
    clear_rate_limit_state,
    check_rate_limit,
)
from rag.request_size_limit import RAG_INDEX_MAX_BODY_BYTES

@pytest.fixture
def client():
    clear_rate_limit_state()
    api_key = os.environ.get("ML_SERVICE_API_KEY", "wealthgenie_secret_api_key_2026")
    with TestClient(app, headers={"X-API-Key": api_key, "X-Verified-User-Id": "test-user-id"}) as c:
        yield c
    clear_rate_limit_state()


def test_api_security_headers(client):
    response = client.get("/rag/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("X-XSS-Protection") == "1; mode=block"


def test_short_content_input_validation(client):
    payload = {
        "title": "Short Doc",
        "content": "too short",  # <10 chars
        "source": "api",
    }
    response = client.post("/rag/index", json=payload)
    assert response.status_code == 422  # Unprocessable Entity Pydantic validation


def test_rate_limiting_enforcement(client):
    clear_rate_limit_state()

    # Make 60 rate-limited query requests -> should succeed
    for i in range(60):
        res = client.post("/rag/query", json={"question": f"Test Question {i}"})
        assert res.status_code == 200

    # 61st request from same IP -> Rate limit HTTP 429
    res_overflow = client.post("/rag/query", json={"question": "Overflow question"})
    assert res_overflow.status_code == 429
    assert "Rate limit exceeded" in res_overflow.json()["detail"]

    clear_rate_limit_state()


def test_query_rejects_questions_over_the_documented_bound(client):
    response = client.post("/rag/query", json={"question": "x" * 2001})
    assert response.status_code == 422


def test_authenticated_malformed_and_invalid_schema_requests_consume_rate_quota(client, monkeypatch):
    import rag.router as router

    clear_rate_limit_state()
    monkeypatch.setattr(router, "MAX_REQUESTS_PER_MINUTE", 2)
    malformed_json = client.post(
        "/rag/query", content=b'{"question":', headers={"Content-Type": "application/json"},
    )
    invalid_schema = client.post("/rag/query", json={"question": 42})
    over_quota = client.post(
        "/rag/query", content=b'{"question":', headers={"Content-Type": "application/json"},
    )

    assert malformed_json.status_code == 422
    assert invalid_schema.status_code == 422
    assert over_quota.status_code == 429
    clear_rate_limit_state()


def test_unauthenticated_malformed_requests_consume_only_the_per_ip_quota(monkeypatch):
    import rag.router as router

    clear_rate_limit_state()
    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ML_SERVICE_API_KEY", "required-test-key")
    monkeypatch.setattr(router, "MAX_REQUESTS_PER_MINUTE", 2)
    with TestClient(app) as unauthenticated_client:
        first = unauthenticated_client.post(
            "/rag/query", content=b'{"question":', headers={"Content-Type": "application/json"},
        )
        second = unauthenticated_client.post(
            "/rag/query", content=b'{"question":', headers={"Content-Type": "application/json"},
        )
        third = unauthenticated_client.post(
            "/rag/query", content=b'{"question":', headers={"Content-Type": "application/json"},
        )

    assert first.status_code == 422
    assert second.status_code == 422
    assert third.status_code == 429
    assert len(router._RATE_LIMIT_STORE["testclient"]) == 2
    assert _GLOBAL_RATE_LIMIT_TIMESTAMPS == []
    clear_rate_limit_state()


def test_unauthenticated_oversized_requests_do_not_consume_shared_quotas(monkeypatch):
    import rag.router as router

    clear_rate_limit_state()
    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ML_SERVICE_API_KEY", "required-test-key")
    monkeypatch.setattr(router, "MAX_REQUESTS_PER_MINUTE", 1)
    payload = b"x" * (RAG_INDEX_MAX_BODY_BYTES + 1)
    with TestClient(app) as unauthenticated_client:
        first = unauthenticated_client.post("/rag/index", content=payload)
        second = unauthenticated_client.post("/rag/index", content=payload)

    assert first.status_code == 413
    assert second.status_code == 429
    assert len(router._RATE_LIMIT_STORE["testclient"]) == 1
    assert _GLOBAL_RATE_LIMIT_TIMESTAMPS == []
    clear_rate_limit_state()


def test_rate_limit_binds_verified_principal_across_client_ips(monkeypatch):
    import rag.router as router

    clear_rate_limit_state()
    monkeypatch.setattr(router, "MAX_REQUESTS_PER_MINUTE", 2)
    check_rate_limit("192.0.2.1", "verified-user")
    check_rate_limit("198.51.100.2", "verified-user")
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit("203.0.113.3", "verified-user")
    assert exc_info.value.status_code == 429
    clear_rate_limit_state()


def test_global_rate_limit_applies_across_distinct_ips_and_principals(monkeypatch):
    import rag.router as router

    clear_rate_limit_state()
    monkeypatch.setattr(router, "MAX_GLOBAL_REQUESTS_PER_MINUTE", 2)
    check_rate_limit("192.0.2.1", "verified-user-1")
    check_rate_limit("198.51.100.2", "verified-user-2")
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit("203.0.113.3", "verified-user-3")
    assert exc_info.value.status_code == 429
    clear_rate_limit_state()


def test_rate_limit_bucket_storage_stays_bounded(monkeypatch):
    clear_rate_limit_state()
    import rag.router as router
    monkeypatch.setattr(router, "MAX_GLOBAL_REQUESTS_PER_MINUTE", MAX_TRACKED_RATE_LIMIT_BUCKETS + 32)
    for index in range(MAX_TRACKED_RATE_LIMIT_BUCKETS + 32):
        check_rate_limit(f"192.0.2.{index}", f"verified-user-{index}")
    assert len(_RATE_LIMIT_STORE) == MAX_TRACKED_RATE_LIMIT_BUCKETS
    clear_rate_limit_state()



def test_index_rejects_oversized_content_before_ingestion(client):
    response = client.post("/rag/index", json={
        "title": "Oversized document",
        "content": "x" * (MAX_INGEST_TEXT_CHARS + 1),
        "source": "test",
    })
    assert response.status_code == 413


def test_index_rejects_unknown_fields(client):
    response = client.post("/rag/index", json={
        "title": "Valid document",
        "content": "This is enough valid document text.",
        "source": "test",
        "unexpected": "small extra field",
    })
    assert response.status_code == 422


def test_index_body_limit_rejects_oversized_unrecognized_json_before_validation(client):
    payload = json.dumps({
        "title": "Valid document",
        "content": "This is enough valid document text.",
        "source": "test",
        "unexpected": "x" * RAG_INDEX_MAX_BODY_BYTES,
    }).encode("utf-8")
    response = client.post(
        "/rag/index",
        content=payload,
        headers={"Content-Type": "application/json"},
    )
    assert len(payload) > RAG_INDEX_MAX_BODY_BYTES
    assert response.status_code == 413


def test_index_has_a_stricter_verified_principal_rate_limit(monkeypatch):
    import rag.router as router

    clear_rate_limit_state()
    monkeypatch.setattr(router, "MAX_INDEX_REQUESTS_PER_MINUTE", 2)
    check_rate_limit("192.0.2.1", "verified-index-user", request_kind="index")
    check_rate_limit("198.51.100.2", "verified-index-user", request_kind="index")
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit("203.0.113.3", "verified-index-user", request_kind="index")
    assert exc_info.value.status_code == 429
    clear_rate_limit_state()



def test_index_rejects_oversized_ignored_identity_metadata(client):
    response = client.post("/rag/index", json={
        "title": "Bounded metadata",
        "content": "This text is long enough to pass the minimum length.",
        "source": "test",
        "tenant_id": "x" * 129,
    })
    assert response.status_code == 422


def test_query_rejects_oversized_unused_profile_payload(client):
    response = client.post("/rag/query", json={
        "question": "Explain my profile",
        "user_profile": {"notes": "x" * 16_385},
    })
    assert response.status_code == 422
