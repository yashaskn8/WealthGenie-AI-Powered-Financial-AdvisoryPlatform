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
