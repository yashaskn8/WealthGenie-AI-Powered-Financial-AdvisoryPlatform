"""
WealthGenie RAG Subsystem - Structured JSON Logging Framework
Provides enterprise-grade structured JSON log formatting with context tracking (tenant_id, trace_id, duration_ms).
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional

from model.config import BASE_DIR

LOG_DIR = BASE_DIR / "reports" / "rag_store"
LOG_DIR.mkdir(parents=True, exist_ok=True)
RAG_LOG_FILE = LOG_DIR / "rag_execution.log"


class StructuredJSONFormatter(logging.Formatter):
    """Formats log records as structured JSON payloads for observability ingestors."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include custom contextual attributes if attached
        for key in ("tenant_id", "trace_id", "component", "duration_ms", "chunks_count"):
            if hasattr(record, key):
                log_entry[key] = getattr(record, key)

        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


def setup_rag_logger(name: str = "wealthgenie.rag", log_file: Path = RAG_LOG_FILE, level: int = logging.INFO) -> logging.Logger:
    """Configures and returns a structured logger for the RAG platform."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Avoid duplicate handlers
    if logger.handlers:
        return logger

    formatter = StructuredJSONFormatter()

    # Stream Handler (stdout)
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    # File Handler
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def log_rag_event(
    logger: logging.Logger,
    level: int,
    message: str,
    tenant_id: str = "default",
    trace_id: Optional[str] = None,
    component: Optional[str] = None,
    duration_ms: Optional[float] = None,
    **extra_kwargs,
):
    """Utility helper to emit structured contextual RAG log events."""
    extra = {
        "tenant_id": tenant_id,
        "trace_id": trace_id or "N/A",
        "component": component or logger.name,
        "duration_ms": duration_ms if duration_ms is not None else 0.0,
        **extra_kwargs,
    }
    logger.log(level, message, extra=extra)
