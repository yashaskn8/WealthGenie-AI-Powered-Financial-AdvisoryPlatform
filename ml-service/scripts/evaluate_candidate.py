"""Evaluate a registered SHADOW bundle and persist measured validation evidence."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from model.evaluation.candidate_evidence import evaluate_candidate_bundle
from store_factory import get_model_registry


def _committed_evaluator_sha() -> str:
    relative = [
        "ml-service/model/evaluation/candidate_evidence.py",
        "ml-service/scripts/evaluate_candidate.py",
    ]
    changed = subprocess.run(
        ["git", "-C", str(REPOSITORY_ROOT), "status", "--porcelain", "--", *relative],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if changed:
        raise RuntimeError("candidate evaluator must run from committed, clean source files")
    result = subprocess.run(
        ["git", "-C", str(REPOSITORY_ROOT), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version_id", help="registered candidate version in SHADOW state")
    args = parser.parse_args()
    store = get_model_registry()
    evidence = evaluate_candidate_bundle(
        version_store=store,
        version_id=args.version_id,
        evaluator_git_sha=_committed_evaluator_sha(),
    )
    print(json.dumps(evidence.get("report", evidence), sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
