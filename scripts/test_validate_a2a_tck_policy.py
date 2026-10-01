"""Deterministic adversarial tests for the official A2A TCK policy gate."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from xml.sax.saxutils import escape, quoteattr

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_a2a_tck_policy import evaluate_report, format_summary  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / ".github" / "a2a-tck-known-blockers.json"
POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
PIN = POLICY["tck_sha"]
CASES = POLICY["known_failures"]


def git_runner(status: str = ""):
    def run(args, **kwargs):
        if args[-2:] == ["rev-parse", "HEAD"]:
            return CompletedProcess(args, 0, PIN + "\n", "")
        if "status" in args:
            return CompletedProcess(args, 0, status, "")
        return CompletedProcess(args, 0, "", "")
    return run


def make_xml(failed_ids: set[int] = frozenset(), skipped_ids: set[int] = frozenset(), unknown_failure: bool = False,
             changed_reason: int | None = None, extra_error: bool = False,
             failure_status: tuple[int, int] | None = None) -> str:
    failures = []
    skipped = []
    known_passes = []
    generic_passed = 51 - int(unknown_failure) - int(extra_error)
    for index, case in enumerate(CASES):
        if index in failed_ids:
            fragment = case["failure_fragment"]
            if failure_status and failure_status[0] == index:
                expected_status, actual_status = "[415]", f"[{failure_status[1]}]"
                fragment = fragment.replace(expected_status, actual_status, 1)
            reason = "Different failure reason" if changed_reason == index else (
                f"{case['requirement_id']} [required fields] failed: {fragment}"
            )
            failures.append(
                f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
                f'<failure message={quoteattr(reason)}>{escape(reason)}</failure></testcase>'
            )
        elif index in skipped_ids:
            skipped.append(
                f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}"><skipped /></testcase>'
            )
        else:
            known_passes.append(
                f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}" />'
            )
    if unknown_failure:
        failures.append('<testcase classname="tests.compatibility.other.TestOther" name="test_unexpected"><failure message="DM-ART-001 unexpected regression">failed</failure></testcase>')
    if extra_error:
        failures.append('<testcase classname="tests.compatibility.other.TestOther" name="test_error"><error message="runner error">error</error></testcase>')
    generic_skipped_count = 178
    skipped.extend(
        f'<testcase classname="tests.compatibility.other.TestSkipped" name="test_skip_{index}"><skipped /></testcase>'
        for index in range(generic_skipped_count)
    )
    known_passed = sum(1 for index in range(len(CASES)) if index not in failed_ids and index not in skipped_ids)
    passed = generic_passed + known_passed
    total = passed + len(failures) + len(skipped)
    errors = 1 if extra_error else 0
    failures_count = len(failures) - errors
    skipped_count = len(skipped)
    testcase_xml = "".join(failures + skipped + known_passes)
    testcase_xml += "".join(
        f'<testcase classname="tests.compatibility.other.TestPass" name="test_{index}" />'
        for index in range(generic_passed)
    )
    return (
        f'<testsuites tests="{total}" failures="{failures_count}" errors="{errors}" skipped="{skipped_count}">'
        f'<testsuite name="must" tests="{total}" failures="{failures_count}" errors="{errors}" skipped="{skipped_count}">'
        f'{testcase_xml}</testsuite></testsuites>'
    )


class A2ATckPolicyTests(unittest.TestCase):
    def evaluate(self, xml: str | None, *, sha: str = PIN, raw_exit: int = 1, status: str = "",
                 started_at: float = 0.0, valid_report: bool = True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "reports" / "junitreport.xml"
            report.parent.mkdir()
            if xml is not None:
                report.write_text(xml, encoding="utf-8")
                if valid_report:
                    import os
                    os.utime(report, (100.0, 100.0))
            return evaluate_report(
                junit_path=report,
                policy_path=POLICY_PATH,
                tck_dir=root,
                tck_sha=sha,
                raw_exit_code=raw_exit,
                started_at=started_at,
                run=git_runner(status),
            )[0]

    def test_committed_policy_is_exactly_the_reviewed_upstream_exception_allowlist(self):
        expected = {
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestTextArtifact::test_task_has_text_artifact[http_json]",
                "DM-ART-001",
                "Response contains no artifacts",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestFileArtifact::test_task_has_file_artifact[http_json]",
                "DM-ART-001",
                "Response contains no artifacts",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestFileUrlArtifact::test_task_has_file_url_artifact[http_json]",
                "DM-ART-001",
                "Response contains no artifacts",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestDataArtifact::test_task_has_data_artifact[http_json]",
                "DM-ART-001",
                "Response contains no artifacts",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestMessageResponse::test_returns_message_with_text_part[http_json]",
                "DM-MSG-001",
                "Expected a Message response, but got a Task or no payload",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_requirements.py::test_must_requirement[CORE-SEND-003-http_json]",
                "CORE-SEND-003",
                'Operation failed: [415] Unsupported input media type "application/x-unsupported-tck-type"',
                "https://github.com/a2aproject/a2a-tck/issues/202",
                "MISSING_EXPECTED_ERROR_ASSERTION",
            ),
        }
        actual = {
            (
                case["node_id"], case["requirement_id"], case["failure_fragment"],
                case["upstream_issue"], case["classification"],
            )
            for case in POLICY["known_failures"]
        }
        self.assertEqual(actual, expected)

    def test_exact_six_known_upstream_failures_are_accepted_and_visible(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))))
        self.assertTrue(result.accepted, result.violations)
        self.assertEqual(len(result.accepted_known_failures), 6)
        self.assertEqual((result.passed, result.failed, result.skipped, result.total), (51, 6, 178, 235))

    def test_four_known_failures_and_one_now_passing_are_accepted(self):
        result = self.evaluate(make_xml(failed_ids={0, 1, 2, 3}))
        self.assertTrue(result.accepted, result.violations)
        self.assertEqual(len(result.accepted_known_failures), 4)

    def test_all_known_scenarios_passing_are_accepted(self):
        result = self.evaluate(make_xml(), raw_exit=0)
        self.assertTrue(result.accepted, result.violations)
        self.assertEqual(result.accepted_known_failures, [])

    def test_standard_pytest_testsuites_root_without_aggregate_attributes_is_accepted(self):
        xml = make_xml(failed_ids=set(range(6))).replace(
            '<testsuites tests="235" failures="6" errors="0" skipped="178">',
            "<testsuites>",
            1,
        )
        result = self.evaluate(xml)
        self.assertTrue(result.accepted, result.violations)

    def test_known_failures_plus_unknown_failure_fail(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6)), unknown_failure=True))
        self.assertFalse(result.accepted)
        self.assertTrue(result.unknown_failures)

    def test_known_test_with_different_failure_reason_fails(self):
        result = self.evaluate(make_xml(failed_ids={0}, changed_reason=0))
        self.assertFalse(result.accepted)
        self.assertIn("known testcase failed for an unapproved reason", " ".join(result.violations))

    def test_core_send_wrong_status_is_not_accepted_as_upstream_exception(self):
        result = self.evaluate(
            make_xml(failed_ids={5}, failure_status=(5, 400)),
            raw_exit=1,
        )
        self.assertFalse(result.accepted)
        self.assertTrue(result.unknown_failures)
        self.assertIn("known testcase failed for an unapproved reason", " ".join(result.violations))

    def test_summary_names_exceptions_without_claiming_full_conformance(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))))
        summary = format_summary(result, POLICY, PIN)
        self.assertIn("PASS_WITH_KNOWN_UPSTREAM_TCK_EXCEPTIONS", summary)
        self.assertIn("issues/229", summary)
        self.assertIn("issues/202", summary)
        self.assertIn("not a claim of 100% conformance", summary)
        self.assertNotIn("All applicable MUST checks passed", summary)

    def test_unknown_dm_art_failure_fails(self):
        result = self.evaluate(make_xml(unknown_failure=True))
        self.assertFalse(result.accepted)
        self.assertEqual(len(result.unknown_failures), 1)

    def test_missing_or_malformed_junit_fails(self):
        missing = self.evaluate(None)
        malformed = self.evaluate("<testsuites><testsuite>")
        self.assertFalse(missing.accepted)
        self.assertFalse(malformed.accepted)

    def test_known_test_skipped_instead_of_executed_fails(self):
        result = self.evaluate(make_xml(skipped_ids={0}), raw_exit=0)
        self.assertFalse(result.accepted)
        self.assertIn("was skipped instead of executed", " ".join(result.violations))

    def test_tck_sha_mismatch_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), sha="f" * 40)
        self.assertFalse(result.accepted)
        self.assertIn("TCK SHA", " ".join(result.violations))

    def test_dirty_tck_checkout_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), status=" M tests/compatibility/core_operations/test_artifacts.py\n")
        self.assertFalse(result.accepted)
        self.assertIn("unexpected modified/untracked content", " ".join(result.violations))

    def test_unexpected_untracked_tck_path_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), status="?? tests/evil.py\n")
        self.assertFalse(result.accepted)

    def test_untracked_generated_reports_are_the_only_allowed_tck_outputs(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), status="?? reports/junitreport.xml\n")
        self.assertTrue(result.accepted, result.violations)

    def test_tck_report_must_be_created_during_this_run(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), started_at=200.0)
        self.assertFalse(result.accepted)
        self.assertIn("predates this TCK execution", " ".join(result.violations))

    def test_raw_process_exit_must_match_junit_failure_state(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), raw_exit=0)
        self.assertFalse(result.accepted)
        self.assertIn("raw TCK exit code", " ".join(result.violations))

    def test_incomplete_report_fails_even_if_known_cases_match(self):
        xml = make_xml(failed_ids=set(range(6))).replace(
            '<testcase classname="tests.compatibility.other.TestPass" name="test_50" />',
            "",
            1,
        )
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertIn("incomplete", " ".join(result.violations))

    def test_any_test_error_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6)), extra_error=True))
        self.assertFalse(result.accepted)
        self.assertTrue(any("errored" in item for item in result.violations))


if __name__ == "__main__":
    unittest.main(verbosity=2)
