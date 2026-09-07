"""
WealthGenie RAG Subsystem - Observability & Telemetry Collector
Instruments every RAG pipeline stage, collects latency histograms, token counts, cache metrics, and persists telemetry logs.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List

from model.config import BASE_DIR

TELEMETRY_DIR = BASE_DIR / "reports" / "rag_telemetry"
TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("wealthgenie.rag.observability")


class RAGObservabilityCollector:
    """Collects, aggregates, and persists structured RAG pipeline performance telemetry."""

    def __init__(self, telemetry_dir: Path = TELEMETRY_DIR):
        self.telemetry_dir = telemetry_dir
        self.telemetry_dir.mkdir(parents=True, exist_ok=True)
        self._trace_records: List[Dict[str, Any]] = []

    def record_query_trace(
        self,
        query: str,
        search_query: str,
        retrieval_strategy: str,
        reranker_strategy: str,
        stage_latencies_ms: Dict[str, float],
        chunks_retrieved: int,
        chunks_after_rerank: int,
        context_char_count: int,
        citation_count: int,
        top_score: float,
        cache_hits: int = 0,
        cache_misses: int = 0,
    ) -> Dict[str, Any]:
        """Records a structured telemetry trace record for a RAG query execution."""
        timestamp_str = datetime.now(timezone.utc).isoformat()
        total_latency = sum(stage_latencies_ms.values())

        trace = {
            "timestamp_utc": timestamp_str,
            "query": query,
            "search_query": search_query,
            "retrieval_strategy": retrieval_strategy,
            "reranker_strategy": reranker_strategy,
            "latencies_ms": {
                "query_understanding": round(stage_latencies_ms.get("query_understanding", 0.0), 2),
                "retrieval": round(stage_latencies_ms.get("retrieval", 0.0), 2),
                "reranking": round(stage_latencies_ms.get("reranking", 0.0), 2),
                "prompt_assembly": round(stage_latencies_ms.get("prompt_assembly", 0.0), 2),
                "answer_synthesis": round(stage_latencies_ms.get("answer_synthesis", 0.0), 2),
                "total": round(total_latency, 2),
            },
            "counts": {
                "chunks_retrieved": chunks_retrieved,
                "chunks_after_rerank": chunks_after_rerank,
                "context_char_count": context_char_count,
                "citation_count": citation_count,
            },
            "confidence": {
                "top_score": round(top_score, 4),
            },
            "cache": {
                "hits": cache_hits,
                "misses": cache_misses,
                "hit_rate": round(cache_hits / (cache_hits + cache_misses), 4) if (cache_hits + cache_misses) > 0 else 0.0,
            },
        }

        self._trace_records.append(trace)
        logger.info(f"Recorded RAG Telemetry Trace | Latency: {trace['latencies_ms']['total']}ms | Strategy: {retrieval_strategy} | Chunks: {chunks_retrieved}")
        return trace

    def persist_telemetry_snapshot(self) -> Path:
        """Persists current trace history to a daily structured JSON log file."""
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        snapshot_file = self.telemetry_dir / f"telemetry_{date_str}.json"

        with open(snapshot_file, "w", encoding="utf-8") as f:
            json.dump(self._trace_records, f, indent=2)

        logger.info(f"Persisted {len(self._trace_records)} RAG telemetry records to {snapshot_file}")
        return snapshot_file

    def get_summary_stats(self) -> Dict[str, Any]:
        """Computes summary stats across recorded query traces."""
        if not self._trace_records:
            return {"total_queries": 0}

        latencies = [t["latencies_ms"]["total"] for t in self._trace_records]
        retrieved_counts = [t["counts"]["chunks_retrieved"] for t in self._trace_records]

        return {
            "total_queries": len(self._trace_records),
            "p50_latency_ms": round(sorted(latencies)[len(latencies) // 2], 2),
            "max_latency_ms": round(max(latencies), 2),
            "avg_chunks_retrieved": round(sum(retrieved_counts) / len(retrieved_counts), 2),
        }
