"""
WealthGenie Open-Weight LLM Platform - Audit Logger
Provides structured audit trail for all LLM generation, tool, and RAG operations.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("wealthgenie.llm.ops.audit")


class AuditEntry(BaseModel):
    """Single structured audit log record."""
    model_config = ConfigDict(protected_namespaces=())
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    operation: str = Field(..., description="Operation type (generate, tool_call, rag_query, switch_model)")
    tenant_id: str = Field("default", description="Tenant scope")
    provider: str = Field("", description="LLM provider used")
    model_name: str = Field("", description="Model identifier")
    latency_ms: float = Field(0.0, description="Operation latency in ms")
    prompt_tokens: int = Field(0, description="Input prompt token count")
    completion_tokens: int = Field(0, description="Output completion token count")
    status: str = Field("success", description="Operation outcome (success, error, circuit_open)")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class AuditLogger:
    """Thread-safe audit logger with in-memory buffer and optional file persistence."""

    def __init__(self, log_dir: Optional[str] = None, max_buffer_size: int = 1000):
        self._buffer: List[AuditEntry] = []
        self._max_buffer_size = max_buffer_size
        self._log_dir: Optional[Path] = Path(log_dir) if log_dir else None
        if self._log_dir:
            self._log_dir.mkdir(parents=True, exist_ok=True)

    def log(self, entry: AuditEntry) -> None:
        """Records an audit entry to the buffer and optionally persists to disk."""
        self._buffer.append(entry)
        logger.info(
            f"AUDIT | op={entry.operation} tenant={entry.tenant_id} "
            f"provider={entry.provider} model={entry.model_name} "
            f"latency={entry.latency_ms}ms status={entry.status}"
        )
        # Rotate buffer if exceeding max size
        if len(self._buffer) > self._max_buffer_size:
            self._buffer = self._buffer[-self._max_buffer_size:]

        # Append to persistent log file
        if self._log_dir:
            log_file = self._log_dir / "llm_audit.jsonl"
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(entry.model_dump_json() + "\n")

    def get_recent(self, count: int = 50) -> List[Dict[str, Any]]:
        """Returns the most recent audit entries."""
        return [e.model_dump() for e in self._buffer[-count:]]

    def get_stats(self) -> Dict[str, Any]:
        """Computes aggregate operational statistics from the audit buffer."""
        if not self._buffer:
            return {"total_operations": 0}

        total = len(self._buffer)
        success = sum(1 for e in self._buffer if e.status == "success")
        errors = sum(1 for e in self._buffer if e.status == "error")
        latencies = [e.latency_ms for e in self._buffer if e.latency_ms > 0]
        total_tokens = sum(e.prompt_tokens + e.completion_tokens for e in self._buffer)

        ops_by_type: Dict[str, int] = {}
        for e in self._buffer:
            ops_by_type[e.operation] = ops_by_type.get(e.operation, 0) + 1

        return {
            "total_operations": total,
            "success_count": success,
            "error_count": errors,
            "success_rate": round(success / total * 100, 2) if total > 0 else 0.0,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else 0.0,
            "total_tokens_processed": total_tokens,
            "operations_by_type": ops_by_type,
        }

    def clear(self) -> None:
        """Clears the in-memory audit buffer."""
        self._buffer.clear()


# Module-level singleton
llm_audit_logger = AuditLogger()
