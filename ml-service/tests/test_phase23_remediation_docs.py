"""Guard the two audited Phase-2/Phase-3 operational documentation contracts."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_project_status_describes_mutation_idempotency_as_fail_closed():
    status = (ROOT / "PROJECT_STATUS.md").read_text(encoding="utf-8")
    middleware = (ROOT / "server" / "middleware" / "idempotency.js").read_text(encoding="utf-8")
    redis_audit = (ROOT / "server" / "test" / "redisFailClosed.test.js").read_text(encoding="utf-8")

    idempotency_row = next(line for line in status.splitlines() if "`idempotency` (idempotency.js)" in line)
    assert "FAIL OPEN" not in idempotency_row
    assert "FAIL CLOSED" in idempotency_row
    assert "IDEMPOTENCY_UNAVAILABLE" in idempotency_row
    assert "IDEMPOTENCY_UNAVAILABLE" in middleware
    assert "without safety" not in redis_audit.lower()
    assert "as they should for availability" not in redis_audit.lower()
    assert "profileRateLimit.js (profile build)" in redis_audit
    assert "DEGRADED / BOUNDED" in status


def test_rag_docs_describe_migration_and_generation_truthfully():
    rag_docs = (ROOT / "ml-service" / "rag" / "README.md").read_text(encoding="utf-8")
    migration = (ROOT / "ml-service" / "model" / "migrations" / "phase3_state.py").read_text(encoding="utf-8")

    assert "phase3_shared_state/3" in rag_docs
    assert "WEALTHGENIE_RAG_BOOTSTRAP=1" in rag_docs
    assert "rag_corpus_generation_members" in rag_docs
    assert "MIGRATION_VERSION = 3" in migration
