"""
run_governance_check.py — End-to-end MLOps governance script (Phase 5, Part C)

Loads the active model from the registry, runs drift check against a provided
new-data batch, and produces a structured, actionable report.

Usage:
  python -m scripts.run_governance_check --new-data path/to/new_batch.csv
  python -m scripts.run_governance_check --new-data path/to/new_batch.csv --architecture RandomForest

What to do when this fires:
  1. PASS  → No action needed. Model distribution matches training data.
  2. WARN  → Review the flagged features. If business context explains the shift
             (e.g., seasonal income changes), document and continue. If unexpected,
             schedule a retraining evaluation.
  3. FAIL  → Significant distribution shift detected.
             a) Inspect the drifted features listed in the report.
             b) Gather a representative labeled dataset from the new distribution.
             c) Retrain the model and evaluate with `rigor_evaluator.py`.
             d) Register the new version: `python -m scripts.register_model ...`
             e) If the new version underperforms, rollback:
                `python -m scripts.rollback --to-version <prior_version_id>`
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
from model.registry.registry_store import ModelRegistry
from model.registry.drift_detection import run_drift_check
from model.data.feature_engineering import FEATURE_NAMES

MODEL_FEATURES = FEATURE_NAMES


def main():
    parser = argparse.ArgumentParser(
        description="Run end-to-end governance check: registry + drift detection."
    )
    parser.add_argument("--new-data", type=str, required=True,
                        help="Path to new data batch CSV for drift checking")
    parser.add_argument("--architecture", type=str, default=None,
                        help="Architecture to check (default: most recent active)")
    parser.add_argument("--db-path", type=str, default=None)
    parser.add_argument("--output", type=str, default=None,
                        help="Path to save governance report JSON")
    args = parser.parse_args()

    new_data_path = Path(args.new_data)
    if not new_data_path.exists():
        print(f"ERROR: New data file not found: {new_data_path}")
        sys.exit(1)

    db_path = Path(args.db_path) if args.db_path else None
    registry = ModelRegistry(db_path=db_path)

    try:
        # 1. Load active model from registry
        active = registry.get_active_model(architecture=args.architecture)
        if active is None:
            print("ERROR: No active model found in registry.")
            print("  Register and activate a model first:")
            print("  python -m scripts.register_model --checkpoint <path> --metrics <path> --set-active")
            sys.exit(1)

        print(f"Active model: {active['model_architecture']} (version {active['version_id'][:12]}...)")

        # 2. Verify artifact integrity
        integrity = registry.verify_artifact_integrity(active["version_id"])
        if integrity["integrity"] != "VERIFIED":
            print(f"[!] ARTIFACT INTEGRITY CHECK: {integrity['integrity']}")
            print(f"  {integrity.get('message', 'Hash mismatch detected.')}")
            print("  Action: Investigate artifact corruption before proceeding.")

        # 3. Load reference distributions from registry
        ref_dists = active.get("reference_distributions")
        if ref_dists is None:
            print("ERROR: No reference distributions stored for active model.")
            print("  Re-register the model with distribution data.")
            sys.exit(1)

        # 4. Load new data and run drift check
        new_data = pd.read_csv(new_data_path)
        missing = set(MODEL_FEATURES) - set(new_data.columns)
        unexpected = set(new_data.columns) - set(MODEL_FEATURES)
        if missing or unexpected:
            print(
                f"ERROR: New-data feature contract mismatch: missing={sorted(missing)}, "
                f"unexpected={sorted(unexpected)}"
            )
            sys.exit(1)
        drift_report = run_drift_check(ref_dists, new_data, MODEL_FEATURES)

        # 5. Build governance report
        governance_report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "active_model": {
                "version_id": active["version_id"],
                "architecture": active["model_architecture"],
                "artifact_path": active["artifact_path"],
                "artifact_integrity": integrity["integrity"],
            },
            "model_metrics": active.get("metrics", {}),
            "drift_check": drift_report,
            "recommendation": _build_recommendation(drift_report),
        }

        # 6. Output
        report_json = json.dumps(governance_report, indent=2, default=str)

        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(report_json)
            print(f"\nGovernance report saved to: {output_path}")
        else:
            print("\n" + report_json)

        # 7. Print summary
        verdict = drift_report["overall_verdict"]
        symbol = {"PASS": "[PASS]", "WARN": "[WARN]", "FAIL": "[FAIL]"}
        print(f"\n{symbol.get(verdict, '?')} Overall Drift Verdict: {verdict}")

        if drift_report["drifted_features"]:
            print(f"  Significantly drifted features: {', '.join(drift_report['drifted_features'])}")
        if drift_report["warned_features"]:
            print(f"  Moderately drifted features: {', '.join(drift_report['warned_features'])}")

        if verdict == "FAIL":
            print("\n  ACTION REQUIRED:")
            print("  1. Inspect the drifted features listed above")
            print("  2. Gather representative labeled data from the new distribution")
            print("  3. Retrain: python -m model.training.train_pipeline")
            print("  4. Evaluate: python -m model.evaluation.rigor_evaluator")
            print("  5. Register: python -m scripts.register_model --checkpoint <path> --metrics <path> --set-active")
            print("  6. If underperforming: python -m scripts.rollback --to-version <prior_id>")

    finally:
        registry.close()


def _build_recommendation(drift_report: dict) -> dict:
    """Build structured recommendation based on drift verdict."""
    verdict = drift_report["overall_verdict"]

    if verdict == "PASS":
        return {
            "action": "NONE",
            "message": "No significant distribution drift detected. Model is operating within expected data distributions.",
            "urgency": "LOW",
        }
    elif verdict == "WARN":
        return {
            "action": "REVIEW",
            "message": (
                f"Moderate drift detected in {len(drift_report['warned_features'])} feature(s). "
                "Review whether the shift is expected (seasonal, business-driven) or indicates "
                "emerging distribution change requiring retraining."
            ),
            "urgency": "MEDIUM",
            "features_to_review": drift_report["warned_features"],
        }
    else:  # FAIL
        return {
            "action": "RETRAIN_RECOMMENDED",
            "message": (
                f"Significant drift in {len(drift_report['drifted_features'])} feature(s). "
                "Model predictions may be unreliable on this data distribution. "
                "Retrain with representative data from the new distribution."
            ),
            "urgency": "HIGH",
            "drifted_features": drift_report["drifted_features"],
        }


if __name__ == "__main__":
    main()
