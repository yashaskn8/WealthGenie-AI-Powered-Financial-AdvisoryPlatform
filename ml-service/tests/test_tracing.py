import json
import logging
from pathlib import Path

from tracing import FileSpanExporter, resolve_trace_log_path


class SampleSpan:
    name = "test.span"
    parent = None
    start_time = 1_700_000_000_000_000_000
    end_time = 1_700_000_001_000_000_000
    status = type("Status", (), {"status_code": "UNSET"})()
    attributes = {"test": True}
    events = ()

    @staticmethod
    def get_span_context():
        return type("Context", (), {"trace_id": 1, "span_id": 2})()


def test_trace_path_override_and_parent_creation(tmp_path: Path):
    configured_path = tmp_path / "nested" / "traces.jsonl"

    assert resolve_trace_log_path({"TRACE_LOG_PATH": str(configured_path)}) == configured_path
    result = FileSpanExporter(configured_path).export([SampleSpan()])

    assert result.name == "SUCCESS"
    assert configured_path.exists()
    assert json.loads(configured_path.read_text(encoding="utf-8"))["service"] == "wealthgenie-ml-service"


def test_trace_export_failure_is_bounded_and_does_not_raise(tmp_path: Path, caplog):
    directory_used_as_file = tmp_path / "trace-directory"
    directory_used_as_file.mkdir()
    exporter = FileSpanExporter(directory_used_as_file)

    with caplog.at_level(logging.WARNING, logger="wealthgenie.tracing"):
        assert exporter.export([SampleSpan()]).name == "FAILURE"
        assert exporter.export([SampleSpan()]).name == "FAILURE"

    assert len([record for record in caplog.records if "Failed to export spans" in record.message]) == 1


def test_file_exporter_rejects_unapproved_span_attributes_and_names(tmp_path: Path):
    span = SampleSpan()
    span.name = "POST /profile/prana-income-180000"
    span.attributes = {
        "agent.name": "plan-review",
        "agent.run_id": "run-safe-123",
        "profile.income": 180000,
        "prompt": "PAN: ABCDE1234F",
        "gen_ai.request.model": "provider-model-safe",
        "authorization": "Bearer telemetry-bearer-secret-sentinel",
        "http.request.header.x-correlation-id": "person@example.invalid",
        "identity.canary": "Aadhaar: 1234 5678 9012; account 123456789012",
        "identity.canary": "Aadhaar: 1234 5678 9012; account 123456789012",
    }
    path = tmp_path / "traces.jsonl"

    assert FileSpanExporter(path).export([span]).name == "SUCCESS"
    record = json.loads(path.read_text(encoding="utf-8"))
    serialized = json.dumps(record)

    for secret in (
        "prana-income-180000",
        "180000",
        "ABCDE1234F",
        "1234 5678 9012",
        "123456789012",
        "1234 5678 9012",
        "123456789012",
        "telemetry-bearer-secret-sentinel",
        "person@example.invalid",
    ):
        assert secret not in serialized
    assert record["name"] == "http.request.POST"
    assert record["attributes"] == {
        "agent.name": "plan-review",
        "agent.run_id": "run-safe-123",
        "gen_ai.request.model": "provider-model-safe",
    }


def test_file_exporter_retains_only_sanitized_exception_event_fields(tmp_path: Path):
    Event = type("Event", (), {})
    event = Event()
    event.name = "exception"
    event.timestamp = 1_700_000_000_000_000_000
    event.attributes = {
        "exception.type": "ProviderError",
        "exception.message": "provider failed for PAN ABCDE1234F, phone +919876543210, profileId: 64b000000000000000000010",
        "exception.stacktrace": "sensitive-stack-sentinel",
    }
    span = SampleSpan()
    span.events = (event,)
    path = tmp_path / "exception-traces.jsonl"

    assert FileSpanExporter(path).export([span]).name == "SUCCESS"
    record = json.loads(path.read_text(encoding="utf-8"))
    assert len(record["events"]) == 1
    assert record["events"][0]["attributes"]["exception.type"] == "ProviderError"
    assert "ABCDE1234F" not in json.dumps(record)
    assert "+919876543210" not in json.dumps(record)
    assert "64b000000000000000000010" not in json.dumps(record)
    assert "sensitive-stack-sentinel" not in json.dumps(record)


def test_file_exporter_does_not_log_exception_contents(tmp_path: Path, caplog):
    directory_used_as_file = tmp_path / "trace-directory"
    directory_used_as_file.mkdir()
    exporter = FileSpanExporter(directory_used_as_file)
    span = SampleSpan()
    span.attributes = {"agent.name": "PAN: ABCDE1234F"}

    with caplog.at_level(logging.WARNING, logger="wealthgenie.tracing"):
        assert exporter.export([span]).name == "FAILURE"

    assert "ABCDE1234F" not in caplog.text
    assert "trace-directory" not in caplog.text
