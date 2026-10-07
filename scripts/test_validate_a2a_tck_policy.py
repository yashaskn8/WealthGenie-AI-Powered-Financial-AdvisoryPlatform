"""Deterministic adversarial tests for the official A2A TCK policy gate."""

from __future__ import annotations

import json
import hashlib
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
TEST_CASES = POLICY["test_cases"]
EXPECTED_FAILURE_BODY_SHA256 = {
    "tests/compatibility/core_operations/test_artifacts.py::TestTextArtifact::test_task_has_text_artifact[http_json]": "1913ad5a59baa06c15763564e7fa1684c584bc2d658a3ed47c149f3f43164e5a",
    "tests/compatibility/core_operations/test_artifacts.py::TestFileArtifact::test_task_has_file_artifact[http_json]": "89c2e2a2fc5db262e2d8b568fe25e94a49b15edca1157911a7586fa78c44d078",
    "tests/compatibility/core_operations/test_artifacts.py::TestFileUrlArtifact::test_task_has_file_url_artifact[http_json]": "e32e99a1a68ea75f03664b91aa94efaa7149947d1331759b3fcc378ef1ba99dd",
    "tests/compatibility/core_operations/test_artifacts.py::TestDataArtifact::test_task_has_data_artifact[http_json]": "87dfb2743ddb76c5428257787fb98de797df047b8b47036353d7142c2dd4f4f7",
    "tests/compatibility/core_operations/test_artifacts.py::TestMessageResponse::test_returns_message_with_text_part[http_json]": "5bd0a9d1c26184f499cca2b5466977c23b7a1629ce2a5754b0521bb1e29de494",
    "tests/compatibility/core_operations/test_requirements.py::test_must_requirement[CORE-SEND-003-http_json]": "58775cea1f70d59b8dc4db996af7cbae55ff55e5aebf0586623a834717f0adbf",
}


def git_runner(status: str = ""):
    def run(args, **kwargs):
        if args[-2:] == ["rev-parse", "HEAD"]:
            return CompletedProcess(args, 0, PIN + "\n", "")
        if "status" in args:
            return CompletedProcess(args, 0, status, "")
        return CompletedProcess(args, 0, "", "")
    return run



def make_xml(failed_ids: set[int] = frozenset(), skipped_ids: set[int] = frozenset(),
             unknown_failure: bool = False, changed_reason: int | None = None,
             extra_error: bool = False, failure_status: tuple[int, int] | None = None,
             resolve_skip_ids: set[int] = frozenset(), additional_skip_id: int | None = None,
             wrong_skip_reason_id: int | None = None, replace_pass_identity: bool = False,
             omit_test_index: int | None = None, extra_skip_type_id: int | None = None,
             skip_body_id: int | None = None) -> str:
    known_by_identity = {
        (case["junit_classname"], case["junit_name"]): index
        for index, case in enumerate(CASES)
    }
    skip_indices = [
        index for index, case in enumerate(TEST_CASES)
        if case["expected_skip_reason"] is not None
    ]
    expected_results = []
    normal_passes = []

    for index, case in enumerate(TEST_CASES):
        if index == omit_test_index:
            continue
        identity = (case["junit_classname"], case["junit_name"])
        classname = case["junit_classname"]
        name = case["junit_name"]
        known_index = known_by_identity.get(identity)
        if known_index is not None and known_index in failed_ids:
            fragment = CASES[known_index]["failure_signature"]
            if failure_status and failure_status[0] == known_index:
                expected_status, actual_status = "[400]", f"[{failure_status[1]}]"
                fragment = fragment.replace(expected_status, actual_status, 1)
            reason = "Different failure reason" if changed_reason == known_index else fragment
            body = CASES[known_index]["failure_body"]
            item = (
                f'<testcase classname="{classname}" name="{name}">'
                f'<failure message={quoteattr(reason)}>{escape(body)}</failure></testcase>'
            )
            expected_results.append(item)
        elif known_index is not None and known_index in skipped_ids:
            expected_results.append(
                f'<testcase classname="{classname}" name="{name}"><skipped message="forced skip" /></testcase>'
            )
        elif case["expected_skip_reason"] is not None and index not in resolve_skip_ids:
            skip_reason = (
                "changed skip reason" if wrong_skip_reason_id == index
                else case["expected_skip_reason"]
            )
            skip_type = ' type="UNEXPECTED"' if extra_skip_type_id == index else ""
            skip_body = "Actual skip details: hidden regression" if skip_body_id == index else ""
            expected_results.append(
                f'<testcase classname="{classname}" name="{name}"><skipped message={quoteattr(skip_reason)}{skip_type}>{escape(skip_body)}</skipped></testcase>'
            )
        elif index == additional_skip_id:
            expected_results.append(
                f'<testcase classname="{classname}" name="{name}"><skipped message="unexpected conditional skip" /></testcase>'
            )
        else:
            item = f'<testcase classname="{classname}" name="{name}" />'
            expected_results.append(item)
            if known_index is None:
                normal_passes.append(index)

    if unknown_failure:
        target = normal_passes[0]
        case = TEST_CASES[target]
        expected_results[target] = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            '<failure message="DM-ART-001 unexpected regression">unexpected failure</failure></testcase>'
        )
    if extra_error:
        target = normal_passes[-1]
        case = TEST_CASES[target]
        expected_results[target] = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            '<error message="runner error">error</error></testcase>'
        )
    if replace_pass_identity:
        target = normal_passes[0]
        case = TEST_CASES[target]
        expected_results[target] = (
            '<testcase classname="tests.compatibility.other.TestOther" name="test_unexpected_pass" />'
        )

    if additional_skip_id is not None and skip_indices:
        resolved = skip_indices[0]
        if resolved != additional_skip_id:
            case = TEST_CASES[resolved]
            expected_results[resolved] = f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}" />'

    failures = sum("<failure " in item for item in expected_results)
    errors = sum("<error " in item for item in expected_results)
    skipped_count = sum("<skipped " in item for item in expected_results)
    total = len(expected_results)
    testcase_xml = "".join(expected_results)
    return (
        f'<testsuites tests="{total}" failures="{failures}" errors="{errors}" skipped="{skipped_count}">'
        f'<testsuite name="must" tests="{total}" failures="{failures}" errors="{errors}" skipped="{skipped_count}">'
        f'{testcase_xml}</testsuite></testsuites>'
    )


def policy_copy() -> dict:
    return json.loads(json.dumps(POLICY))


class A2ATckPolicyTests(unittest.TestCase):
    def evaluate(self, xml: str | None, *, sha: str = PIN, raw_exit: int = 1, status: str = "",
                 started_at: float = 0.0, valid_report: bool = True,
                 policy_data: dict | None = None,
                 source_files: dict[str, str] | None = None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "reports" / "junitreport.xml"
            report.parent.mkdir()
            for relative_path, contents in (source_files or {}).items():
                source = root / relative_path
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text(contents, encoding="utf-8")
            policy_path = POLICY_PATH
            if policy_data is not None:
                policy_path = root / "policy.json"
                policy_path.write_text(json.dumps(policy_data), encoding="utf-8")
            if xml is not None:
                report.write_text(xml, encoding="utf-8")
                if valid_report:
                    import os
                    os.utime(report, (100.0, 100.0))
            return evaluate_report(
                junit_path=report,
                policy_path=policy_path,
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
                "AssertionError: DM-ART-001 [Artifact contains required fields] failed on http_json: Response contains no artifacts (see specification/specification.md#417-artifact)",
                "1913ad5a59baa06c15763564e7fa1684c584bc2d658a3ed47c149f3f43164e5a",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestFileArtifact::test_task_has_file_artifact[http_json]",
                "DM-ART-001",
                "AssertionError: DM-ART-001 [Artifact contains required fields] failed on http_json: Response contains no artifacts (see specification/specification.md#417-artifact)",
                "89c2e2a2fc5db262e2d8b568fe25e94a49b15edca1157911a7586fa78c44d078",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestFileUrlArtifact::test_task_has_file_url_artifact[http_json]",
                "DM-ART-001",
                "AssertionError: DM-ART-001 [Artifact contains required fields] failed on http_json: Response contains no artifacts (see specification/specification.md#417-artifact)",
                "e32e99a1a68ea75f03664b91aa94efaa7149947d1331759b3fcc378ef1ba99dd",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestDataArtifact::test_task_has_data_artifact[http_json]",
                "DM-ART-001",
                "AssertionError: DM-ART-001 [Artifact contains required fields] failed on http_json: Response contains no artifacts (see specification/specification.md#417-artifact)",
                "87dfb2743ddb76c5428257787fb98de797df047b8b47036353d7142c2dd4f4f7",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_artifacts.py::TestMessageResponse::test_returns_message_with_text_part[http_json]",
                "DM-MSG-001",
                "AssertionError: DM-MSG-001 [Message contains required fields] failed on http_json: Expected a Message response, but got a Task or no payload (see specification/specification.md#414-message)",
                "5bd0a9d1c26184f499cca2b5466977c23b7a1629ce2a5754b0521bb1e29de494",
                "https://github.com/a2aproject/a2a-tck/issues/229",
                "FIXTURE_APPLICABILITY",
            ),
            (
                "tests/compatibility/core_operations/test_requirements.py::test_must_requirement[CORE-SEND-003-http_json]",
                "CORE-SEND-003",
                'AssertionError: CORE-SEND-003 [SendMessage returns ContentTypeNotSupportedError for unsupported media] failed on http_json: Operation failed: [400] Unsupported input media type "application/x-unsupported-tck-type"; supported input media types are application/json and text/plain. (see specification/specification.md#311-send-message)\nassert not [\'Operation failed: [400] Unsupported input media type "application/x-unsupported-tck-type"; supported input media types are application/json and text/plain.\']',
                "58775cea1f70d59b8dc4db996af7cbae55ff55e5aebf0586623a834717f0adbf",
                "https://github.com/a2aproject/a2a-tck/issues/202",
                "MISSING_EXPECTED_ERROR_ASSERTION",
            ),
        }
        actual = {
            (
                case["node_id"], case["requirement_id"], case["failure_signature"],
                hashlib.sha256(case["failure_body"].encode()).hexdigest(),
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

    def test_known_test_with_wrong_requirement_id_fails(self):
        xml = make_xml(failed_ids={0}).replace("DM-ART-001", "DM-ART-999")
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertIn("known testcase failed for an unapproved reason", " ".join(result.violations))

    def test_same_classname_with_different_failing_test_name_is_unknown(self):
        original = CASES[0]["junit_name"]
        replacement = "test_different_artifact_behavior[http_json]"
        xml = make_xml(failed_ids={0}).replace(f'name="{original}"', f'name="{replacement}"', 1)
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertTrue(any(item.endswith(f"::{replacement}") for item in result.unknown_failures))

    def test_duplicate_junit_testcase_identity_fails(self):
        xml = make_xml()
        duplicate = (
            f'<testcase classname="{CASES[0]["junit_classname"]}" '
            f'name="{CASES[0]["junit_name"]}" />'
        )
        xml = xml.replace("</testsuite>", f"{duplicate}</testsuite>")
        xml = xml.replace('tests="235"', 'tests="236"')
        result = self.evaluate(xml, raw_exit=0)
        self.assertFalse(result.accepted)
        self.assertIn("duplicate testcase identity", " ".join(result.violations))

    def test_missing_known_testcase_fails_even_when_total_count_is_preserved(self):
        xml = make_xml()
        missing = (
            f'<testcase classname="{CASES[0]["junit_classname"]}" '
            f'name="{CASES[0]["junit_name"]}" />'
        )
        self.assertIn(missing, xml)
        xml = xml.replace(missing, '<testcase classname="tests.compatibility.other.TestPass" name="replacement_pass" />', 1)
        result = self.evaluate(xml, raw_exit=0)
        self.assertFalse(result.accepted)
        self.assertIn("expected known testcase did not execute", " ".join(result.violations))

    def test_junit_aggregate_count_mismatch_fails(self):
        xml = make_xml(failed_ids=set(range(6))).replace(
            '<testsuite name="must" tests="235"',
            '<testsuite name="must" tests="234"',
            1,
        )
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertIn("tests' count 234 does not match testcase count 235", " ".join(result.violations))

    def test_known_failure_with_expected_fragment_and_unexpected_text_fails(self):
        xml = make_xml(failed_ids={0}).replace(
            "Response contains no artifacts",
            "Response contains no artifacts; unexpected assertion: sensitive data leaked",
            1,
        )
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertTrue(result.unknown_failures)

    def test_known_failure_with_approved_message_but_unexpected_body_text_fails(self):
        xml = make_xml(failed_ids={0}).replace(
            "</failure>",
            "Additional assertion failed: private data was exposed.</failure>",
            1,
        )
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertTrue(result.unknown_failures)

    def test_known_failure_with_unapproved_text_prepended_to_body_fails(self):
        xml = make_xml(failed_ids={0}).replace(
            "tests/compatibility/core_operations/test_artifacts.py:107",
            "UNAPPROVED ASSERTION: private data was exposed.\ntests/compatibility/core_operations/test_artifacts.py:107",
            1,
        )
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertTrue(result.unknown_failures)

    def test_known_failure_with_unexpected_xml_attribute_fails(self):
        xml = make_xml(failed_ids=set(range(6)))
        xml = xml.replace("<failure message=", '<failure type="UnexpectedException" message=', 1)
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertTrue(result.unknown_failures)

    def test_policy_cannot_reduce_the_pinned_report_counts(self):
        changed_policy = policy_copy()
        changed_policy["test_case_count"] = 6
        changed_policy["skipped_test_case_count"] = 0
        testcases = "".join(
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<failure message={quoteattr(case["failure_signature"])}>{escape(case["failure_signature"])}</failure>'
            "</testcase>"
            for case in CASES
        )
        xml = (
            '<testsuites tests="6" failures="6" errors="0" skipped="0">'
            '<testsuite name="must" tests="6" failures="6" errors="0" skipped="0">'
            f'{testcases}</testsuite></testsuites>'
        )
        result = self.evaluate(xml, policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("pinned test_case_count", " ".join(result.violations))

    def test_legacy_policy_schema_version_fails(self):
        changed_policy = policy_copy()
        changed_policy["policy_schema_version"] = 4
        result = self.evaluate(make_xml(failed_ids=set(range(6))), policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("unsupported A2A policy schema version", " ".join(result.violations))

    def test_nested_junit_testsuite_aggregate_mismatch_fails(self):
        xml = make_xml(failed_ids=set(range(6)))
        outer_suite = '<testsuite name="must" tests="235" failures="6" errors="0" skipped="178">'
        nested_suite = '<testsuite name="nested" tests="999" failures="999" errors="99" skipped="99">'
        xml = xml.replace(outer_suite, outer_suite + nested_suite, 1)
        xml = xml.replace("</testsuite></testsuites>", "</testsuite></testsuite></testsuites>", 1)
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertTrue(any("nested" in item or "count 999" in item for item in result.violations))

    def test_nested_testcase_failure_marker_cannot_be_hidden_as_a_pass(self):
        xml = make_xml(failed_ids=set(range(6)))
        xml = xml.replace(
            "><failure message=", "><details><failure message=", 1
        ).replace("</failure></testcase>", "</failure></details></testcase>", 1)
        xml = xml.replace('failures="6"', 'failures="5"')
        result = self.evaluate(xml, raw_exit=1)
        self.assertFalse(result.accepted)
        self.assertTrue(any("nested or unexpected" in item for item in result.violations))

    def test_core_send_wrong_status_is_not_accepted_as_upstream_exception(self):
        result = self.evaluate(
            make_xml(failed_ids={5}, failure_status=(5, 415)),
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

    def test_pinned_failure_traceback_accepts_windows_source_path_separators(self):
        xml = make_xml(failed_ids=set(range(6))).replace(
            "tests/compatibility/", "tests\\compatibility\\",
        )
        result = self.evaluate(xml)
        self.assertTrue(result.accepted, result.violations)

    def test_expected_skip_accepts_only_its_tck_source_location_and_exact_reason(self):
        skip_index = next(index for index, case in enumerate(TEST_CASES) if case["expected_skip_reason"] is not None)
        case = TEST_CASES[skip_index]
        reason = case["expected_skip_reason"]
        xml = make_xml(failed_ids=set(range(6)))
        old = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<skipped message={quoteattr(reason)}></skipped></testcase>'
        )
        body = f'tests\\compatibility\\_test_helpers.py:86: {reason}'
        new = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<skipped message={quoteattr(reason)}>{escape(body)}</skipped></testcase>'
        )
        self.assertIn(old, xml)
        source = "\n".join(["# source"] * 85 + ["pytest.skip(reason)"]) + "\n"
        result = self.evaluate(
            xml.replace(old, new, 1),
            source_files={"tests/compatibility/_test_helpers.py": source},
        )
        self.assertTrue(result.accepted, result.violations)

    def test_expected_skip_accepts_pytest_skip_type_but_no_other_type(self):
        skip_index = next(index for index, case in enumerate(TEST_CASES) if case["expected_skip_reason"] is not None)
        case = TEST_CASES[skip_index]
        reason = case["expected_skip_reason"]
        xml = make_xml(failed_ids=set(range(6)))
        old = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<skipped message={quoteattr(reason)}></skipped></testcase>'
        )
        new = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<skipped message={quoteattr(reason)} type="pytest.skip"></skipped></testcase>'
        )
        self.assertIn(old, xml)
        result = self.evaluate(xml.replace(old, new, 1))
        self.assertTrue(result.accepted, result.violations)

    def test_expected_skip_rejects_traceback_location_outside_the_pinned_tck(self):
        skip_index = next(index for index, case in enumerate(TEST_CASES) if case["expected_skip_reason"] is not None)
        case = TEST_CASES[skip_index]
        reason = case["expected_skip_reason"]
        xml = make_xml(failed_ids=set(range(6)))
        old = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<skipped message={quoteattr(reason)}></skipped></testcase>'
        )
        body = f'C:\\\\outside\\\\a2a-tck\\\\tests\\\\compatibility\\\\_test_helpers.py:86: {reason}'
        new = (
            f'<testcase classname="{case["junit_classname"]}" name="{case["junit_name"]}">'
            f'<skipped message={quoteattr(reason)}>{escape(body)}</skipped></testcase>'
        )
        result = self.evaluate(xml.replace(old, new, 1))
        self.assertFalse(result.accepted)
        self.assertIn("skip representation is not exact", " ".join(result.violations))

    def test_unexpected_additional_skip_fails_even_when_skip_count_is_preserved(self):
        known_ids = {(known["junit_classname"], known["junit_name"]) for known in CASES}
        extra_skip_index = next(
            index for index, case in enumerate(TEST_CASES)
            if case["expected_skip_reason"] is None
            and (case["junit_classname"], case["junit_name"]) not in known_ids
        )
        result = self.evaluate(make_xml(
            failed_ids=set(range(6)),
            additional_skip_id=extra_skip_index,
        ))
        self.assertFalse(result.accepted)
        self.assertIn("not in the pinned skip inventory", " ".join(result.violations))

    def test_resolved_expected_skip_may_pass_without_changing_the_inventory(self):
        first_skip = next(index for index, case in enumerate(TEST_CASES) if case["expected_skip_reason"] is not None)
        result = self.evaluate(make_xml(failed_ids=set(range(6)), resolve_skip_ids={first_skip}))
        self.assertTrue(result.accepted, result.violations)
        self.assertEqual(result.skipped, 177)

    def test_skip_reason_must_match_the_pinned_observed_reason(self):
        skip_index = next(index for index, case in enumerate(TEST_CASES) if case["expected_skip_reason"] is not None)
        result = self.evaluate(make_xml(failed_ids=set(range(6)), wrong_skip_reason_id=skip_index))
        self.assertFalse(result.accepted)
        self.assertIn("skip reason differs from pinned evidence", " ".join(result.violations))

    def test_skip_type_attribute_and_body_text_cannot_hide_a_regression(self):
        skip_index = next(index for index, case in enumerate(TEST_CASES) if case["expected_skip_reason"] is not None)
        result = self.evaluate(make_xml(
            failed_ids=set(range(6)),
            extra_skip_type_id=skip_index,
            skip_body_id=skip_index,
        ))
        self.assertFalse(result.accepted)
        self.assertIn("skip representation is not exact", " ".join(result.violations))

    def test_unexpected_junit_identity_cannot_replace_a_pinned_must_case(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6)), replace_pass_identity=True))
        self.assertFalse(result.accepted)
        self.assertTrue(any("outside the pinned MUST testcase inventory" in item for item in result.violations))
        self.assertTrue(any("did not execute" in item for item in result.violations))

    def test_tampered_skip_inventory_fails_its_compiled_digest(self):
        changed_policy = policy_copy()
        changed_policy["test_cases"][0]["expected_skip_reason"] = "forged"
        result = self.evaluate(make_xml(failed_ids=set(range(6))), policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("differ from the pinned exact inventory", " ".join(result.violations))

    def test_tck_sha_mismatch_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), sha="f" * 40)
        self.assertFalse(result.accepted)
        self.assertIn("TCK SHA", " ".join(result.violations))

    def test_wrong_tck_repository_fails(self):
        changed_policy = policy_copy()
        changed_policy["tck_repository"] = "someone-else/a2a-tck"
        result = self.evaluate(make_xml(failed_ids=set(range(6))), policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("not the official upstream repository", " ".join(result.violations))

    def test_changed_upstream_classification_fails(self):
        changed_policy = policy_copy()
        changed_policy["upstream_issues"][0]["classification"] = "PRODUCT_DEFECT"
        result = self.evaluate(make_xml(failed_ids=set(range(6))), policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("upstream issues/classifications differ", " ".join(result.violations))

    def test_missing_upstream_issue_fails(self):
        changed_policy = policy_copy()
        changed_policy["upstream_issues"].pop()
        result = self.evaluate(make_xml(failed_ids=set(range(6))), policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("upstream issues/classifications differ", " ".join(result.violations))

    def test_extra_upstream_issue_fails(self):
        changed_policy = policy_copy()
        changed_policy["upstream_issues"].append({
            "url": "https://github.com/a2aproject/a2a-tck/issues/999",
            "classification": "FIXTURE_APPLICABILITY",
            "rationale": "unreviewed",
        })
        result = self.evaluate(make_xml(failed_ids=set(range(6))), policy_data=changed_policy)
        self.assertFalse(result.accepted)
        self.assertIn("upstream issues/classifications differ", " ".join(result.violations))

    def test_dirty_tck_checkout_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), status=" M tests/compatibility/core_operations/test_artifacts.py\n")
        self.assertFalse(result.accepted)
        self.assertIn("unexpected modified/untracked content", " ".join(result.violations))

    def test_unexpected_untracked_tck_path_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6))), status="?? tests/evil.py\n")
        self.assertFalse(result.accepted)

    def test_unexpected_file_inside_generated_reports_directory_fails(self):
        result = self.evaluate(
            make_xml(failed_ids=set(range(6))),
            status="?? reports/unexpected.py\n",
        )
        self.assertFalse(result.accepted)

    def test_untracked_generated_reports_are_the_only_allowed_tck_outputs(self):
        status = "".join(
            f"?? {path}\n"
            for path in (
                "reports/compatibility.html",
                "reports/compatibility.json",
                "reports/junitreport.xml",
                "reports/tck_report.html",
            )
        )
        result = self.evaluate(make_xml(failed_ids=set(range(6))), status=status)
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
        omitted = next(
            index for index, case in enumerate(TEST_CASES)
            if case["expected_skip_reason"] is None
            and (case["junit_classname"], case["junit_name"]) not in {
                (known["junit_classname"], known["junit_name"]) for known in CASES
            }
        )
        xml = make_xml(failed_ids=set(range(6)), omit_test_index=omitted)
        result = self.evaluate(xml)
        self.assertFalse(result.accepted)
        self.assertIn("incomplete", " ".join(result.violations))

    def test_any_test_error_fails(self):
        result = self.evaluate(make_xml(failed_ids=set(range(6)), extra_error=True))
        self.assertFalse(result.accepted)
        self.assertTrue(any("errored" in item for item in result.violations))


if __name__ == "__main__":
    unittest.main(verbosity=2)
