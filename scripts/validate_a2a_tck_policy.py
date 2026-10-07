#!/usr/bin/env python3
"""Fail-closed acceptance policy for the pinned, unmodified A2A TCK run."""

from __future__ import annotations

import argparse
import json
import hashlib
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any


REQUIREMENT_ID = re.compile(r"\b(?:DM|CORE)-[A-Z]+-\d{3}\b")
PINNED_TCK_SHA = "263b9cfaf16a554bdfb166a7ba5b67716e946349"
PINNED_TEST_CASE_COUNT = 235
PINNED_SKIPPED_TEST_CASE_COUNT = 178
PINNED_TEST_CASE_INVENTORY_SHA256 = "62cedc3216bb27545d2ede0bb8cf6588ef893e2f827b1de2ac4104a215122028"
PINNED_TEST_INVENTORY_EVIDENCE = {
    "tck_sha": PINNED_TCK_SHA,
    "workflow_run_id": 37421617732,
    "workflow_name": "A2A v1 MUST conformance",
    "workflow_head_sha": "15454b98fa87ed29db7fd58eb21cbe29eb016678",
    "workflow_head_is_ancestor_of_current_main": True,
    "junit_report_sha256": "69b917d3c73c37c375c44b3a694ed7408b643733a7b271e67416a4b9c4f5ca4b",
    "collected_identity_match": True,
    "observed_skip_count": PINNED_SKIPPED_TEST_CASE_COUNT,
}
EXPECTED_UPSTREAM_ISSUES = {
    "https://github.com/a2aproject/a2a-tck/issues/229": "FIXTURE_APPLICABILITY",
    "https://github.com/a2aproject/a2a-tck/issues/202": "MISSING_EXPECTED_ERROR_ASSERTION",
}


@dataclass
class Outcome:
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    errors: int = 0
    total: int = 0
    accepted_known_failures: list[str] = field(default_factory=list)
    unknown_failures: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)

    @property
    def accepted(self) -> bool:
        return not self.violations and not self.unknown_failures


def _policy_cases(policy: dict[str, Any], outcome: Outcome) -> dict[tuple[str, str], dict[str, str]]:
    cases = policy.get("known_failures")
    if not isinstance(cases, list) or len(cases) != 6:
        outcome.violations.append("policy must contain exactly the six reviewed pinned-TCK exceptions")
        return {}

    issue_entries = policy.get("upstream_issues")
    if not isinstance(issue_entries, list):
        issue_entries = []
    issue_classifications = {
        issue.get("url"): issue.get("classification")
        for issue in issue_entries
        if isinstance(issue, dict)
    }
    indexed: dict[tuple[str, str], dict[str, str]] = {}
    node_ids: set[str] = set()
    for case in cases:
        if not isinstance(case, dict):
            outcome.violations.append("policy contains a malformed known-failure entry")
            continue
        required = (
            "node_id", "junit_classname", "junit_name", "requirement_id",
            "failure_signature", "failure_body", "upstream_issue", "classification",
        )
        if any(not isinstance(case.get(key), str) or not case[key] for key in required):
            outcome.violations.append("policy known-failure entry is missing required identity or failure metadata")
            continue
        if issue_classifications.get(case["upstream_issue"]) != case["classification"]:
            outcome.violations.append(f"policy case has an unreviewed upstream issue/classification: {case['node_id']}")
            continue
        key = (case["junit_classname"], case["junit_name"])
        if key in indexed or case["node_id"] in node_ids:
            outcome.violations.append("policy contains duplicate known-failure identities")
            continue
        dotted_identity = case["junit_classname"].split(".")
        module_path = "/".join(dotted_identity)
        valid_node_ids = {f"{module_path}.py::{case['junit_name']}"}
        if len(dotted_identity) > 1:
            class_name = dotted_identity[-1]
            class_module_path = "/".join(dotted_identity[:-1])
            valid_node_ids.add(f"{class_module_path}.py::{class_name}::{case['junit_name']}")
        if case["node_id"] not in valid_node_ids:
            outcome.violations.append(f"policy node ID does not match JUnit identity: {case['node_id']}")
            continue
        indexed[key] = case
        node_ids.add(case["node_id"])
    return indexed



def _policy_test_cases(policy: dict[str, Any], outcome: Outcome) -> dict[tuple[str, str], dict[str, Any]]:
    raw_cases = policy.get("test_cases")
    if not isinstance(raw_cases, list) or len(raw_cases) != PINNED_TEST_CASE_COUNT:
        outcome.violations.append("policy must contain the exact pinned MUST testcase identity inventory")
        return {}

    indexed: dict[tuple[str, str], dict[str, Any]] = {}
    for case in raw_cases:
        if not isinstance(case, dict) or set(case) != {
            "junit_classname", "junit_name", "expected_skip_reason",
        }:
            outcome.violations.append("policy testcase inventory contains a malformed entry")
            continue
        classname = case.get("junit_classname")
        name = case.get("junit_name")
        skip_reason = case.get("expected_skip_reason")
        if not isinstance(classname, str) or not classname or not isinstance(name, str) or not name:
            outcome.violations.append("policy testcase inventory is missing an exact JUnit identity")
            continue
        if skip_reason is not None and (not isinstance(skip_reason, str) or not skip_reason):
            outcome.violations.append("policy testcase inventory contains a malformed expected skip reason")
            continue
        identity = (classname, name)
        if identity in indexed:
            outcome.violations.append(f"policy testcase inventory contains a duplicate identity: {classname}::{name}")
            continue
        indexed[identity] = case

    canonical = "\n".join(
        f'{case["junit_classname"]}::{case["junit_name"]}\t{case["expected_skip_reason"] or ""}'
        for case in sorted(indexed.values(), key=lambda value: (value["junit_classname"], value["junit_name"]))
    ).encode("utf-8")
    inventory_hash = hashlib.sha256(canonical).hexdigest()
    if (
        len(indexed) != PINNED_TEST_CASE_COUNT
        or inventory_hash != PINNED_TEST_CASE_INVENTORY_SHA256
        or policy.get("test_case_inventory_sha256") != PINNED_TEST_CASE_INVENTORY_SHA256
    ):
        outcome.violations.append("policy testcase identities or skip reasons differ from the pinned exact inventory")

    skip_count = sum(case["expected_skip_reason"] is not None for case in indexed.values())
    if skip_count != PINNED_SKIPPED_TEST_CASE_COUNT:
        outcome.violations.append("policy testcase inventory does not contain the pinned observed skip set")
    if policy.get("skipped_test_case_count") != skip_count:
        outcome.violations.append("policy skipped testcase inventory count does not match its exact skip set")
    if policy.get("test_inventory_evidence") != PINNED_TEST_INVENTORY_EVIDENCE:
        outcome.violations.append("policy testcase inventory provenance differs from the pinned successful TCK evidence")
    return indexed

def _status(case: ET.Element) -> tuple[str, list[ET.Element], list[ET.Element], list[ET.Element]]:
    failures = case.findall("failure")
    errors = case.findall("error")
    skipped = case.findall("skipped")
    status_count = len(failures) + len(errors) + len(skipped)
    if status_count > 1:
        return "invalid", failures, errors, skipped
    if failures:
        return "failed", failures, errors, skipped
    if errors:
        return "error", failures, errors, skipped
    if skipped:
        return "skipped", failures, errors, skipped
    return "passed", failures, errors, skipped


def _failure_text(element: ET.Element) -> str:
    return "\n".join(part for part in (element.attrib.get("message", ""), "".join(element.itertext())) if part)


def _failure_body_matches(element: ET.Element, case: dict[str, str]) -> bool:
    actual = "".join(element.itertext())
    expected = case["failure_body"]
    source_location = re.compile(r"(?m)^(?P<indent>[ \t]*)(?P<path>[^\r\n]*?\.py):(?P<line>\d+):")
    def normalize(value: str) -> str:
        return source_location.sub(
            lambda match: (
                f'{match.group("indent")}{match.group("path").replace(chr(92), "/")}:'
                f'{match.group("line")}:'
            ),
            value,
        )
    return normalize(actual) == normalize(expected)


def _skip_body_matches(element: ET.Element, expected_reason: str, tck_dir: Path) -> bool:
    body = "".join(element.itertext()).strip()
    if not body:
        return True
    if "\n" in body or "\r" in body:
        return False
    normalized = body.replace("\\", "/")
    match = re.fullmatch(r"(?P<location>.+\.py):(?P<line>[1-9]\d*): (?P<reason>.+)", normalized)
    if not match or match.group("reason") != expected_reason:
        return False

    location = match.group("location")
    marker = "/tests/compatibility/"
    if location.startswith("tests/compatibility/"):
        prefix = ""
        relative = location
    else:
        marker_index = location.rfind(marker)
        if marker_index < 0:
            return False
        prefix = location[:marker_index].rstrip("/")
        relative = location[marker_index + 1:]
        expected_root = str(tck_dir.resolve()).replace("\\", "/").rstrip("/")
        if os.name == "nt":
            if prefix.casefold() != expected_root.casefold():
                return False
        elif prefix != expected_root:
            return False

    source_path = PurePosixPath(relative)
    if not (
        source_path.parts[:2] == ("tests", "compatibility")
        and all(part not in ("", ".", "..") for part in source_path.parts)
        and source_path.suffix == ".py"
    ):
        return False
    source_file = (tck_dir / Path(*source_path.parts)).resolve()
    root = tck_dir.resolve()
    if not source_file.is_relative_to(root) or not source_file.is_file():
        return False
    try:
        source_lines = source_file.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return False
    return int(match.group("line")) <= len(source_lines)


def _validate_checkout(
    tck_dir: Path,
    expected_sha: str,
    outcome: Outcome,
    run: Any = subprocess.run,
    allowed_untracked: tuple[str, ...] = ("reports/",),
) -> None:
    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return run(["git", "-C", str(tck_dir), *args], capture_output=True, text=True, check=False)

    head = git("rev-parse", "HEAD")
    if head.returncode != 0 or head.stdout.strip().lower() != expected_sha.lower():
        outcome.violations.append("TCK checkout HEAD does not match the pinned SHA")
        return

    status = git("status", "--porcelain=v1", "--untracked-files=all")
    if status.returncode != 0:
        outcome.violations.append("could not verify TCK checkout status")
        return
    for line in status.stdout.splitlines():
        if len(line) < 4:
            outcome.violations.append("TCK checkout returned an unparseable git status entry")
            continue
        code, raw_path = line[:2], line[3:]
        if code == "??":
            path = PurePosixPath(raw_path.replace("\\", "/"))
            allowed = path.as_posix() in allowed_untracked and ".." not in path.parts
            if allowed:
                continue
        outcome.violations.append(f"TCK checkout has unexpected modified/untracked content: {raw_path}")


def evaluate_report(
    *,
    junit_path: Path,
    policy_path: Path,
    tck_dir: Path,
    tck_sha: str,
    raw_exit_code: int,
    started_at: float,
    run: Any = subprocess.run,
) -> tuple[Outcome, dict[str, Any]]:
    outcome = Outcome()
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        outcome.violations.append(f"could not read valid A2A policy: {error}")
        return outcome, {}

    if policy.get("policy_schema_version") != 5:
        outcome.violations.append("unsupported A2A policy schema version")
    if policy.get("test_case_count") != PINNED_TEST_CASE_COUNT:
        outcome.violations.append(f"policy test_case_count must equal pinned test_case_count {PINNED_TEST_CASE_COUNT}")
    pinned_sha = policy.get("tck_sha")
    if not isinstance(pinned_sha, str) or pinned_sha.lower() != PINNED_TCK_SHA or tck_sha.lower() != PINNED_TCK_SHA:
        outcome.violations.append("supplied TCK SHA does not match the policy pin")
    if policy.get("tck_repository") != "a2aproject/a2a-tck":
        outcome.violations.append("policy TCK repository is not the official upstream repository")
    issues = policy.get("upstream_issues")
    actual_issues: dict[str, str] = {}
    if not isinstance(issues, list):
        outcome.violations.append("policy upstream issue catalog is missing or malformed")
    else:
        for issue in issues:
            if not isinstance(issue, dict) or not all(
                isinstance(issue.get(key), str) and issue[key]
                for key in ("url", "classification", "rationale")
            ):
                outcome.violations.append("policy contains malformed upstream issue metadata")
                continue
            if issue["url"] in actual_issues:
                outcome.violations.append("policy contains duplicate upstream issue metadata")
            actual_issues[issue["url"]] = issue["classification"]
        if actual_issues != EXPECTED_UPSTREAM_ISSUES:
            outcome.violations.append("policy upstream issues/classifications differ from the reviewed exact set")
    if policy.get("classification") != "KNOWN_UPSTREAM_TCK_EXCEPTIONS":
        outcome.violations.append("policy classification is invalid")
    if policy.get("acceptance") != {
        "allow_skipped_known_tests": False,
        "allow_unknown_failures": False,
        "allow_test_errors": False,
        "allow_tracked_tck_changes": False,
        "allow_untracked_tck_paths": [
            "reports/compatibility.html",
            "reports/compatibility.json",
            "reports/junitreport.xml",
            "reports/tck_report.html",
        ],
    }:
        outcome.violations.append("policy acceptance rules differ from the fail-closed gate contract")

    cases = _policy_cases(policy, outcome)
    test_case_inventory = _policy_test_cases(policy, outcome)
    allowed_untracked = tuple(policy.get("acceptance", {}).get("allow_untracked_tck_paths", []))
    if any(not isinstance(item, str) for item in allowed_untracked):
        outcome.violations.append("policy contains malformed untracked-path allowances")
        allowed_untracked = ()
    _validate_checkout(tck_dir, str(pinned_sha or ""), outcome, run, allowed_untracked)

    try:
        report_stat = junit_path.stat()
        if report_stat.st_mtime + 1.0 < started_at:
            outcome.violations.append("JUnit report predates this TCK execution")
        root = ET.parse(junit_path).getroot()
    except (OSError, ET.ParseError) as error:
        outcome.violations.append(f"JUnit report is missing or malformed: {error}")
        return outcome, policy

    if root.tag not in ("testsuite", "testsuites"):
        outcome.violations.append("JUnit report root is not testsuite/testsuites")
    testcases = list(root.iter("testcase"))
    outcome.total = len(testcases)
    expected_count = PINNED_TEST_CASE_COUNT
    if outcome.total != expected_count:
        outcome.violations.append(
            f"JUnit report is incomplete: expected {expected_count!r} testcases, found {outcome.total}"
        )
    expected_skipped = PINNED_SKIPPED_TEST_CASE_COUNT

    seen: set[tuple[str, str]] = set()
    known_seen: set[tuple[str, str]] = set()
    inventory_seen: set[tuple[str, str]] = set()
    for case in testcases:
        classname = case.attrib.get("classname", "")
        name = case.attrib.get("name", "")
        identity = (classname, name)
        display_id = f"{classname}::{name}"
        if not classname or not name:
            outcome.violations.append("JUnit testcase is missing classname or name")
            continue
        if identity in seen:
            outcome.violations.append(f"JUnit report contains duplicate testcase identity: {display_id}")
            continue
        seen.add(identity)
        expected_case = test_case_inventory.get(identity)
        if expected_case is None:
            outcome.violations.append(f"JUnit report contains an identity outside the pinned MUST testcase inventory: {display_id}")
        else:
            inventory_seen.add(identity)
        allowed_children = {"failure", "error", "skipped", "system-out", "system-err"}
        if any(child.tag not in allowed_children or len(child) for child in case):
            outcome.violations.append(f"JUnit testcase has nested or unexpected result elements: {display_id}")
        status, failures, errors, skipped = _status(case)
        known = cases.get(identity)
        if known:
            known_seen.add(identity)
        if status == "invalid":
            outcome.violations.append(f"JUnit testcase has conflicting result markers: {display_id}")
        elif status == "passed":
            outcome.passed += 1
        elif status == "skipped":
            outcome.skipped += 1
            if known:
                outcome.violations.append(f"known upstream testcase was skipped instead of executed: {known['node_id']}")
            expected_reason = expected_case.get("expected_skip_reason") if expected_case else None
            actual_reason = skipped[0].attrib.get("message", "") if len(skipped) == 1 else ""
            if expected_reason is None:
                outcome.violations.append(f"JUnit testcase skip is not in the pinned skip inventory: {display_id}")
            elif actual_reason != expected_reason:
                outcome.violations.append(f"JUnit testcase skip reason differs from pinned evidence: {display_id}")
            elif (len(skipped) != 1
                  or set(skipped[0].attrib) not in ({"message"}, {"message", "type"})
                  or ("type" in skipped[0].attrib and skipped[0].attrib["type"] != "pytest.skip")
                  or not _skip_body_matches(skipped[0], expected_reason, tck_dir)):
                outcome.violations.append(f"JUnit testcase skip representation is not exact: {display_id}")
        elif status == "error":
            outcome.errors += 1
            outcome.violations.append(f"JUnit testcase errored (errors are never excepted): {display_id}")
        else:
            outcome.failed += 1
            text = "\n".join(_failure_text(item) for item in failures)
            if not known:
                outcome.unknown_failures.append(display_id)
                continue
            requirements = set(REQUIREMENT_ID.findall(text))
            if (
                len(failures) != 1
                or set(failures[0].attrib) != {"message"}
                or requirements != {known["requirement_id"]}
                or failures[0].attrib.get("message") != known["failure_signature"]
                or not _failure_body_matches(failures[0], known)
            ):
                outcome.unknown_failures.append(display_id)
                outcome.violations.append(f"known testcase failed for an unapproved reason: {known['node_id']}")
                continue
            outcome.accepted_known_failures.append(known["node_id"])

    missing_known = set(cases) - known_seen
    for identity in sorted(missing_known):
        outcome.violations.append(f"expected known testcase did not execute: {cases[identity]['node_id']}")
    missing_inventory = set(test_case_inventory) - inventory_seen
    for identity in sorted(missing_inventory):
        outcome.violations.append(f"expected pinned MUST testcase did not execute: {identity[0]}::{identity[1]}")
    if outcome.skipped > expected_skipped:
        outcome.violations.append(
            f"JUnit skipped testcase count exceeds the pinned eligible skip set: maximum {expected_skipped}, found {outcome.skipped}"
        )

    suites = list(root.iter("testsuite"))
    if not suites:
        outcome.violations.append("JUnit report contains no testsuite summary")
    for suite in suites:
        suite_cases = list(suite.iter("testcase"))
        suite_counts = {
            "tests": len(suite_cases),
            "failures": sum(len(case.findall("failure")) for case in suite_cases),
            "errors": sum(len(case.findall("error")) for case in suite_cases),
            "skipped": sum(len(case.findall("skipped")) for case in suite_cases),
        }
        for attr, actual in suite_counts.items():
            raw = suite.attrib.get(attr)
            if raw is None:
                outcome.violations.append(f"JUnit testsuite is missing aggregate {attr!r} count")
                continue
            try:
                reported = int(raw)
            except ValueError:
                outcome.violations.append(f"JUnit testsuite {attr!r} count is not an integer")
                continue
            if reported != actual:
                outcome.violations.append(f"JUnit testsuite {attr!r} count {reported} does not match testcase count {actual}")

    aggregate_attrs = {
        "tests": outcome.total,
        "failures": outcome.failed,
        "errors": outcome.errors,
        "skipped": outcome.skipped,
    }
    for attr, actual in aggregate_attrs.items():
        raw = root.attrib.get(attr)
        if raw is None:
            continue
        try:
            reported = int(raw)
        except ValueError:
            outcome.violations.append(f"JUnit aggregate {attr!r} count is not an integer")
            continue
        if reported != actual:
            outcome.violations.append(f"JUnit aggregate {attr!r} count {reported} does not match testcase count {actual}")

    expected_exit = 1 if outcome.failed or outcome.errors else 0
    if raw_exit_code != expected_exit:
        outcome.violations.append(
            f"raw TCK exit code {raw_exit_code} does not match JUnit result (expected {expected_exit})"
        )
    return outcome, policy


def format_summary(outcome: Outcome, policy: dict[str, Any], tck_sha: str) -> str:
    accepted_known = len(outcome.accepted_known_failures)
    if outcome.accepted and accepted_known:
        classification = "PASS_WITH_KNOWN_UPSTREAM_TCK_EXCEPTIONS"
    elif outcome.accepted:
        classification = "PASS_ALL_PINNED_MUST_SCENARIOS"
    else:
        classification = "FAIL"
    raw = (
        f"{outcome.passed} passed, {outcome.failed} failed, {outcome.skipped} skipped, "
        f"{outcome.errors} errors ({outcome.total} testcases in JUnit)"
    )
    lines = [
        "## A2A MUST POLICY RESULT",
        "",
        f"Pinned TCK: `{tck_sha}`",
        f"Raw TCK JUnit result: {raw}",
        f"Known expected upstream failures: {accepted_known}",
        f"Unknown failures: {len(outcome.unknown_failures)}",
        "Reviewed upstream issues: " + ", ".join(
            issue.get("url", "unavailable")
            for issue in policy.get("upstream_issues", [])
            if isinstance(issue, dict)
        ),
        f"Classification: `{classification}`",
        "",
        "Product conformance claims: do not claim `100% A2A conformant`.",
    ]
    if accepted_known:
        lines.extend([
            "",
            "The raw TCK failures below remain visible and are accepted only as exact, reviewed upstream TCK exceptions. This result is not a claim of 100% conformance.",
        ])
        case_by_node = {
            case.get("node_id"): case
            for case in policy.get("known_failures", [])
            if isinstance(case, dict)
        }
        for node_id in outcome.accepted_known_failures:
            case = case_by_node.get(node_id, {})
            lines.append(
                f"- `{node_id}` — {case.get('classification', 'unavailable')}; "
                f"{case.get('upstream_issue', 'upstream issue unavailable')}"
            )
    if outcome.unknown_failures:
        lines.extend(["", "Unapproved failures:", *[f"- `{item}`" for item in outcome.unknown_failures]])
    if outcome.violations:
        lines.extend(["", "Policy violations:", *[f"- {item}" for item in outcome.violations]])
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--junit", required=True, type=Path)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--tck-dir", required=True, type=Path)
    parser.add_argument("--tck-sha", required=True)
    parser.add_argument("--raw-exit-code", required=True, type=int)
    parser.add_argument("--started-at", required=True, type=float)
    parser.add_argument("--summary-path", type=Path)
    args = parser.parse_args(argv)

    outcome, policy = evaluate_report(
        junit_path=args.junit,
        policy_path=args.policy,
        tck_dir=args.tck_dir,
        tck_sha=args.tck_sha,
        raw_exit_code=args.raw_exit_code,
        started_at=args.started_at,
    )
    summary = format_summary(outcome, policy, args.tck_sha)
    print(summary, end="")
    if args.summary_path:
        try:
            with args.summary_path.open("a", encoding="utf-8") as handle:
                handle.write(summary)
        except OSError as error:
            outcome.violations.append(f"could not write GitHub Step Summary: {error}")
            print(f"A2A policy error: {error}", file=sys.stderr)
    if outcome.violations:
        for violation in outcome.violations:
            print(f"A2A policy error: {violation}", file=sys.stderr)
    return 0 if outcome.accepted else 1


if __name__ == "__main__":
    raise SystemExit(main())
