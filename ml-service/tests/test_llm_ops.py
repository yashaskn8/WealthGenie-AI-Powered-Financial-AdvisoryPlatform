"""
WealthGenie Open-Weight LLM Platform - LLMOps Hardening Test Suite (Phase 3.6)
Tests circuit breaker, audit logger, rate limiter, and health monitor.
"""

import time

from llm.ops.circuit_breaker import CircuitBreaker, CircuitState
from llm.ops.audit_logger import AuditLogger, AuditEntry
from llm.ops.rate_limiter import TokenBucketRateLimiter
from llm.ops.health_monitor import LLMHealthMonitor


# ── Circuit Breaker Tests ──────────────────────────────────────────────


def test_circuit_breaker_starts_closed():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout_seconds=0.5)
    assert cb.state == CircuitState.CLOSED
    assert cb.allow_request()


def test_circuit_breaker_trips_to_open_after_failures():
    cb = CircuitBreaker(failure_threshold=3, recovery_timeout_seconds=60.0)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CircuitState.CLOSED
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    assert not cb.allow_request()


def test_circuit_breaker_recovers_to_half_open():
    cb = CircuitBreaker(failure_threshold=2, recovery_timeout_seconds=0.1)
    cb.record_failure()
    cb.record_failure()
    assert cb.state == CircuitState.OPEN

    time.sleep(0.15)
    assert cb.state == CircuitState.HALF_OPEN
    assert cb.allow_request()


def test_circuit_breaker_resets_on_success():
    cb = CircuitBreaker(failure_threshold=2, recovery_timeout_seconds=0.1)
    cb.record_failure()
    cb.record_failure()
    time.sleep(0.15)
    assert cb.state == CircuitState.HALF_OPEN

    cb.record_success()
    assert cb.state == CircuitState.CLOSED
    assert cb.allow_request()


def test_circuit_breaker_manual_reset():
    cb = CircuitBreaker(failure_threshold=1)
    cb.record_failure()
    assert cb.state == CircuitState.OPEN
    cb.reset()
    assert cb.state == CircuitState.CLOSED


def test_circuit_breaker_status():
    cb = CircuitBreaker(failure_threshold=5, name="test_cb")
    status = cb.get_status()
    assert status["name"] == "test_cb"
    assert status["state"] == "closed"
    assert status["failure_threshold"] == 5


# ── Audit Logger Tests ─────────────────────────────────────────────────


def test_audit_logger_records_entries():
    al = AuditLogger()
    entry = AuditEntry(operation="generate", provider="mock", model_name="mock-model", latency_ms=42.5)
    al.log(entry)
    assert len(al.get_recent(10)) == 1
    assert al.get_recent(10)[0]["operation"] == "generate"


def test_audit_logger_stats():
    al = AuditLogger()
    al.log(AuditEntry(operation="generate", latency_ms=10.0, prompt_tokens=50, completion_tokens=100, status="success"))
    al.log(AuditEntry(operation="tool_call", latency_ms=5.0, status="success"))
    al.log(AuditEntry(operation="generate", latency_ms=20.0, status="error"))

    stats = al.get_stats()
    assert stats["total_operations"] == 3
    assert stats["success_count"] == 2
    assert stats["error_count"] == 1
    assert stats["operations_by_type"]["generate"] == 2
    assert stats["total_tokens_processed"] == 150


def test_audit_logger_file_persistence(tmp_path):
    al = AuditLogger(log_dir=str(tmp_path))
    al.log(AuditEntry(operation="generate", provider="mock"))
    al.log(AuditEntry(operation="rag_query", provider="api"))

    log_file = tmp_path / "llm_audit.jsonl"
    assert log_file.exists()
    lines = log_file.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2


def test_audit_logger_buffer_rotation():
    al = AuditLogger(max_buffer_size=5)
    for i in range(10):
        al.log(AuditEntry(operation=f"op_{i}"))
    assert len(al.get_recent(100)) <= 5


# ── Rate Limiter Tests ──────────────────────────────────────────────────


def test_rate_limiter_allows_requests():
    rl = TokenBucketRateLimiter(max_tokens=10, refill_rate_per_second=100.0)
    for _ in range(10):
        assert rl.allow_request("tenant_a")
    # 11th should fail (no time to refill)
    assert not rl.allow_request("tenant_a")


def test_rate_limiter_per_tenant_isolation():
    rl = TokenBucketRateLimiter(max_tokens=5, refill_rate_per_second=0.0)
    for _ in range(5):
        rl.allow_request("tenant_a")
    assert not rl.allow_request("tenant_a")
    # tenant_b should still have tokens
    assert rl.allow_request("tenant_b")


def test_rate_limiter_refills_over_time():
    rl = TokenBucketRateLimiter(max_tokens=5, refill_rate_per_second=100.0)
    for _ in range(5):
        rl.allow_request("t1")
    assert not rl.allow_request("t1")
    time.sleep(0.1)  # Should refill ~10 tokens
    assert rl.allow_request("t1")


def test_rate_limiter_status():
    rl = TokenBucketRateLimiter(max_tokens=20, refill_rate_per_second=5.0)
    rl.allow_request("default")
    status = rl.get_status()
    assert "default" in status
    assert status["default"]["max_tokens"] == 20


# ── Health Monitor Tests ────────────────────────────────────────────────


def test_health_monitor_system_health():
    monitor = LLMHealthMonitor()
    health = monitor.get_system_health()
    assert "timestamp" in health
    assert "circuit_breaker" in health
    assert "rate_limiter" in health
    assert "audit_stats" in health
    assert "gpu" in health


def test_health_monitor_is_healthy():
    cb = CircuitBreaker(failure_threshold=2)
    monitor = LLMHealthMonitor(circuit_breaker=cb)
    assert monitor.is_healthy()

    cb.record_failure()
    cb.record_failure()
    assert not monitor.is_healthy()
