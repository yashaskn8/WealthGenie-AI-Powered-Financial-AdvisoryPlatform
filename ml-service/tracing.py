import json
import logging
import math
import os
import re
import time
from pathlib import Path
from typing import Sequence

from opentelemetry import trace
from opentelemetry.trace import StatusCode
from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.propagate import set_global_textmap
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
DEFAULT_TRACE_LOG_PATH = ROOT_DIR / "traces.jsonl"


def resolve_trace_log_path(env=None) -> Path:
    """Resolve a writable trace path without changing the local default."""
    configured_path = (env or os.environ).get("TRACE_LOG_PATH")
    return Path(configured_path).expanduser() if configured_path else DEFAULT_TRACE_LOG_PATH


TRACE_LOG_PATH = resolve_trace_log_path()
logger = logging.getLogger("wealthgenie.tracing")

_SAFE_ATTRIBUTE_NAMES = frozenset({
    "agent.type",
    "agent.name",
    "agent.version",
    "agent.graph_version",
    "agent.scaffold_version",
    "agent.run_id",
    "agent.status",
    "agent.step_count",
    "agent.tool_call_count",
    "agent.model_call_count",
    "agent.tool_name",
    "agent.tool_outcome",
    "agent.policy_result",
    "agent.evidence_status",
    "agent.fallback_used",
    "agent.candidate_id",
    "agent.evaluation_partition",
    "agent.evaluation_version",
    "gen_ai.system",
    "gen_ai.request.model",
    "gen_ai.response.model",
    "gen_ai.operation.name",
    "gen_ai.response.finish_reasons",
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.total_tokens",
    "error.type",
})
_SENSITIVE_ATTRIBUTE_NAME = re.compile(
    r"(?:user|profile|income|salary|tax|email|phone|address|prompt|content|input|output|secret|token|password|cookie|authorization|raw|payload|value)",
    re.IGNORECASE,
)
_SENSITIVE_STRING = re.compile(
    r"Bearer\s+\S+|Basic\s+\S+|\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|"
    r"\b[a-f0-9]{24}\b|(?:user|profile|account)[_-]?id\s*[:=]|"
    r"\b[A-Z]{5}[0-9]{4}[A-Z]\b|\b[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}\b|"
    r"(?<!\w)(?:\+?91[\s-]?)?[6-9][0-9]{9}(?!\w)|(?<!\d)[0-9]{9,18}(?!\d)|"
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|"
    r"(?:mongodb(?:\+srv)?|rediss?)://[^\s/@]+(?::[^\s/@]*)?@|"
    r"\b(?:income|salary|tax|savings|portfolio|profile|financial)[\s_-]*(?:=|:|is)?\s*[₹$]?\s*\d+",
    re.IGNORECASE,
)
_NUMERIC_ATTRIBUTE_NAMES = frozenset({
    "agent.step_count",
    "agent.tool_call_count",
    "agent.model_call_count",
    "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens",
    "gen_ai.usage.total_tokens",
})
_BOOLEAN_ATTRIBUTE_NAMES = frozenset({"agent.fallback_used"})
_SAFE_HTTP_SPAN_NAMES = frozenset({
    "GET /healthz", "GET /readyz", "GET /health", "GET /readiness", "GET /models",
    "POST /predict/enriched", "POST /predict", "POST /predict/pytorch",
    "POST /predict/ft_transformer", "POST /predict/compare",
})


def sanitize_telemetry_value(value):
    """Keep telemetry scalar-only and redact common credential/financial canaries."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value
    if not isinstance(value, str):
        return None
    if _SENSITIVE_STRING.search(value):
        return None
    return value[:120]


def sanitize_telemetry_attributes(attributes=None):
    """Use a deny-by-default allowlist; never serialize arbitrary span attributes."""
    safe = {}
    if not isinstance(attributes, dict):
        return safe
    for name, value in attributes.items():
        if name not in _SAFE_ATTRIBUTE_NAMES or _SENSITIVE_ATTRIBUTE_NAME.search(name):
            continue
        if name in _NUMERIC_ATTRIBUTE_NAMES:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
        elif name in _BOOLEAN_ATTRIBUTE_NAMES:
            if not isinstance(value, bool):
                continue
        elif not isinstance(value, str):
            continue
        sanitized = sanitize_telemetry_value(value)
        if sanitized is not None:
            safe[name] = sanitized
    return safe


def sanitize_span_events(events=None):
    """Export only bounded, sanitized exception type/message events; omit stacks."""
    safe_events = []
    for event in list(events or ())[:32]:
        if getattr(event, "name", None) != "exception":
            continue
        attributes = getattr(event, "attributes", {}) or {}
        safe_attributes = {}
        for key in ("exception.type", "exception.message"):
            value = sanitize_telemetry_value(attributes.get(key))
            if value is not None:
                safe_attributes[key] = value
        timestamp_ns = getattr(event, "timestamp", None)
        timestamp = None
        if isinstance(timestamp_ns, int) and timestamp_ns >= 0:
            timestamp = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp_ns / 1e9)
            )
        safe_events.append({"name": "exception", "timestamp": timestamp, "attributes": safe_attributes})
    return safe_events


def sanitize_span_name(name):
    """Retain known static routes and method class; discard dynamic span names."""
    if not isinstance(name, str):
        return "internal.operation"
    if name in _SAFE_HTTP_SPAN_NAMES:
        return name
    match = re.match(r"^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b", name)
    return f"http.request.{match.group(1)}" if match else "internal.operation"


class FileSpanExporter(SpanExporter):
    """Exports spans directly to a local traces.jsonl file."""

    def __init__(self, file_path: Path = TRACE_LOG_PATH):
        self.file_path = Path(file_path).expanduser()
        self.write_failure_reported = False

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        try:
            records = []
            for span in spans:
                ctx = span.get_span_context()
                trace_id = format(ctx.trace_id, "032x")
                span_id = format(ctx.span_id, "016x")
                parent_span_id = format(span.parent.span_id, "016x") if span.parent else None

                duration_ns = (span.end_time - span.start_time) if (span.end_time and span.start_time) else 0
                duration_ms = round(duration_ns / 1e6, 2)

                status_str = "UNSET"
                if span.status.status_code == StatusCode.OK:
                    status_str = "OK"
                elif span.status.status_code == StatusCode.ERROR:
                    status_str = "ERROR"

                record = {
                    "service": "wealthgenie-ml-service",
                    "trace_id": trace_id,
                    "span_id": span_id,
                    "parent_span_id": parent_span_id,
                    "name": sanitize_span_name(span.name),
                    "duration_ms": duration_ms,
                    "status": status_str,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(span.start_time / 1e9)) if span.start_time else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "attributes": sanitize_telemetry_attributes(span.attributes),
                    "events": sanitize_span_events(getattr(span, "events", ())),
                }
                records.append(json.dumps(record, default=str))

            if records:
                self.file_path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.file_path, "a", encoding="utf-8") as f:
                    f.write("\n".join(records) + "\n")
            self.write_failure_reported = False
            return SpanExportResult.SUCCESS
        except Exception:
            if not self.write_failure_reported:
                logger.warning("Failed to export spans to the configured file sink.")
                self.write_failure_reported = True
            return SpanExportResult.FAILURE

    def shutdown(self):
        pass


def setup_tracing(app) -> TracerProvider:
    """Configures global OpenTelemetry TracerProvider and instruments the FastAPI app."""
    # Set W3C TraceContext propagator globally
    set_global_textmap(TraceContextTextMapPropagator())

    resource = Resource.create({"service.name": "wealthgenie-ml-service"})
    provider = TracerProvider(resource=resource)
    exporter = FileSpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    return provider
