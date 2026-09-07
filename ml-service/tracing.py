import json
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
TRACE_LOG_PATH = ROOT_DIR / "traces.jsonl"


class FileSpanExporter(SpanExporter):
    """Exports spans directly to a local traces.jsonl file."""

    def __init__(self, file_path: Path = TRACE_LOG_PATH):
        self.file_path = file_path

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
                    "name": span.name,
                    "duration_ms": duration_ms,
                    "status": status_str,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(span.start_time / 1e9)) if span.start_time else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "attributes": dict(span.attributes) if span.attributes else {},
                }
                records.append(json.dumps(record, default=str))

            if records:
                with open(self.file_path, "a", encoding="utf-8") as f:
                    f.write("\n".join(records) + "\n")
            return SpanExportResult.SUCCESS
        except Exception as e:
            print(f"[Tracing] Failed to export spans to file: {e}")
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
