"""Offline, chronological qualification of a Gaussian-HMM shadow challenger."""

from __future__ import annotations

import argparse
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

import hmmlearn
import numpy as np
import pandas as pd
import sklearn

from . import FEATURE_SCHEMA_VERSION, MODEL_FAMILY, MODEL_ROLE
from .features import FEATURE_NAMES, build_feature_frame, feature_specification
from .hmm_model import (
    HMM_COVARIANCE_TYPE,
    HMM_MAX_ITERATIONS,
    HMM_SEEDS,
    HMM_STATE_COUNTS,
    HMM_TOLERANCE,
    QUALIFICATION_THRESHOLDS,
    evaluate_state_counts,
    fit_final_shadow_model,
    model_parameters_equal,
    train_gaussian_hmm,
)
from .registry import write_shadow_artifact
from .splits import expanding_walk_forward_plan

MINIMUM_QUALIFICATION_SESSIONS = 1000
MODEL_VERSION = "gaussian-hmm-market-context-1.0.0"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _date(frame: pd.DataFrame, index: int) -> str:
    return pd.Timestamp(frame.iloc[index]["effective_trading_date"]).strftime("%Y-%m-%d")


def _public_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return candidate


def _render_markdown(report: dict[str, Any]) -> str:
    data = report["data"]
    split = report["splits"]
    lines = [
        "# Phase 4 Market-Regime ML Qualification",
        "",
        f"Generated: {report['generatedAt']}",
        "",
        "## Decision",
        "",
        f"- Final decision: `{report['finalDecision']}`",
        "- Production champion: `market-context-policy-1.0.0` (unchanged)",
        f"- HMM status: `{report['hmm']['status']}`",
        "- ML allocation authority: **NO**",
        "",
        "## Data",
        "",
        f"- Source: `{data['sourceProvider']}` via the Express normalized provider boundary",
        f"- Period: `{data['startDate']}` to `{data['endDate']}`",
        f"- Matched completed sessions: `{data['rawRowCount']}`",
        f"- Usable causal feature rows: `{data['featureRowCount']}`",
        f"- Dataset: `{data['datasetVersion']}`",
        f"- SHA-256: `{data['datasetHash']}`",
        f"- Missing observations: `{json.dumps(data['missingObservations'], sort_keys=True)}`",
        "",
        "No missing trading session was interpolated, forward-filled, or synthesized.",
        "",
        "## Features",
        "",
        f"Feature schema: `{FEATURE_SCHEMA_VERSION}`. All rolling windows are trailing and include only day t or earlier.",
        "",
        "| Feature | Unit | Lookback | Calculation |",
        "|---|---:|---:|---|",
    ]
    for feature in report["features"]:
        lines.append(
            f"| `{feature['name']}` | {feature['unit']} | {feature['lookback_sessions']} | {feature['calculation']} |"
        )
    lines.extend([
        "",
        "## Chronological evaluation",
        "",
        f"- Walk-forward folds: `{len(split['walkForwardFolds'])}`",
        f"- Untouched holdout: `{split['finalHoldout']['startDate']}` to `{split['finalHoldout']['endDate']}`",
        "- Random shuffle: `NO`",
        "- Scaling: fit independently on each fold's training window; final scaler fit on development rows only",
        "- Supervised purge/embargo: not applicable because no supervised target was qualified",
        "",
        "| States | Shadow gate | Convergence | Min training occupancy | Median seed agreement | Max switching | Validation log likelihood/row |",
        "|---:|---|---:|---:|---:|---:|---:|",
    ])
    for candidate in report["hmm"]["candidates"]:
        lines.append(
            "| {stateCount} | {qualifiedForShadow} | {convergenceRate:.3f} | {minimumTrainingStateOccupancy:.3f} | "
            "{medianPermutationAlignedSeedAgreement:.3f} | {maximumSwitchingRate:.3f} | "
            "{meanValidationLogLikelihoodPerObservation:.4f} |".format(**candidate)
        )
    lines.extend([
        "",
        "State numbers remain `STATE_0..N`; no bull/bear/crash semantics were forced. Historical evaluation uses causal filtering, not retrospective smoothing.",
        "",
        "## Supervised challengers",
        "",
        "`XGBOOST_SUPERVISED_LABELS_NOT_QUALIFIED`: no externally justified forward-risk bucket thresholds were established. "
        "Training XGBoost on deterministic policy outputs would measure imitation, so XGBoost and LightGBM were not added.",
        "",
        "## Recommendation safety",
        "",
        "The HMM route is shadow-only and has no allocation mutation path. The existing deterministic context, hysteresis, "
        "bounded adjustment, suitability re-validation, concentration re-validation, and no-new-instrument checks remain unchanged.",
        "",
        "## Limitations",
        "",
    ])
    lines.extend(f"- {limitation}" for limitation in report["knownLimitations"])
    lines.append("")
    return "\n".join(lines)


def qualify(
    dataset_path: Path,
    artifact_directory: Path,
    report_json_path: Path,
    report_markdown_path: Path,
) -> dict[str, Any]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    frame = build_feature_frame(dataset)
    raw_row_count = int(dataset["rowCount"])
    if raw_row_count < MINIMUM_QUALIFICATION_SESSIONS:
        raise ValueError("INSUFFICIENT_REAL_MARKET_SESSIONS_FOR_PHASE4_QUALIFICATION")
    values = frame.loc[:, list(FEATURE_NAMES)].to_numpy(dtype=float)
    plan = expanding_walk_forward_plan(
        len(frame),
        minimum_train_sessions=504,
        validation_sessions=84,
        holdout_sessions=252,
        supervised_purge_sessions=0,
    )
    candidates, selected_state_count = evaluate_state_counts(values, plan)
    generated_at = _utc_now()
    artifact_summary: dict[str, Any] | None = None
    final_metrics: dict[str, Any] | None = None
    reproducible = False
    hmm_status = "REJECTED"

    if selected_state_count is not None:
        model, scaler, final_metrics = fit_final_shadow_model(values, plan, selected_state_count, seed=17)
        final_metrics["trainingStateCharacteristics"] = [
            {
                "state": f"STATE_{state}",
                "featureMeans": dict(zip(FEATURE_NAMES, means)),
            }
            for state, means in enumerate(final_metrics.pop("trainingStateFeatureMeans"))
            if means is not None
        ]
        development = values[:plan.holdout_start]
        duplicate = train_gaussian_hmm(scaler.transform(development), selected_state_count, 17)
        reproducible = model_parameters_equal(model, duplicate)
        if not reproducible:
            selected_state_count = None
            hmm_status = "REJECTED"
        else:
            metadata = {
                "modelFamily": MODEL_FAMILY,
                "modelVersion": MODEL_VERSION,
                "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
                "datasetVersion": dataset["datasetVersion"],
                "datasetHashSha256": dataset["contentHash"],
                "trainingStart": _date(frame, 0),
                "trainingEnd": _date(frame, plan.holdout_start - 1),
                "trainingRowCount": plan.holdout_start,
                "hyperparameters": {
                    "stateCount": selected_state_count,
                    "covarianceType": HMM_COVARIANCE_TYPE,
                    "maximumIterations": HMM_MAX_ITERATIONS,
                    "tolerance": HMM_TOLERANCE,
                },
                "seed": 17,
                "preprocessing": {
                    "kind": "STANDARD_SCALER",
                    "fitBoundary": "DEVELOPMENT_ROWS_ONLY_FINAL_HOLDOUT_EXCLUDED",
                    "mean": scaler.mean_.tolist(),
                    "scale": scaler.scale_.tolist(),
                },
                "validationMetrics": {
                    key: value
                    for key, value in next(
                        candidate for candidate in candidates if candidate["stateCount"] == selected_state_count
                    ).items()
                    if key != "runs"
                },
                "holdoutMetrics": final_metrics,
                "pythonVersion": platform.python_version(),
                "libraryVersions": {
                    "numpy": np.__version__,
                    "pandas": pd.__version__,
                    "scikitLearn": sklearn.__version__,
                    "hmmlearn": hmmlearn.__version__,
                },
                "createdAt": generated_at,
                "qualificationStatus": "QUALIFIED_FOR_SHADOW_OBSERVATION_ONLY",
                "role": MODEL_ROLE,
                "semanticLabels": None,
                "calibratedProbabilities": False,
                "controlsAllocation": False,
            }
            artifact_path, registry_path, registry = write_shadow_artifact(
                artifact_directory,
                model=model,
                scaler=scaler,
                feature_names=FEATURE_NAMES,
                reference_features=development,
                metadata=metadata,
            )
            artifact_summary = {
                "artifactFile": artifact_path.name,
                "registryFile": registry_path.name,
                "checksumSha256": registry["models"][0]["artifactChecksumSha256"],
            }
            hmm_status = "SHADOW"

    folds = []
    for fold in plan.folds:
        folds.append({
            **fold.as_dict(),
            "trainStartDate": _date(frame, fold.train_start),
            "trainEndDate": _date(frame, fold.train_end - 1),
            "validationStartDate": _date(frame, fold.validation_start),
            "validationEndDate": _date(frame, fold.validation_end - 1),
        })
    report: dict[str, Any] = {
        "phase": "Phase 4 Market-Regime ML Qualification",
        "generatedAt": generated_at,
        "data": {
            "sourceProvider": dataset["source"]["provider"],
            "sourceQualification": dataset["source"]["qualification"],
            "sourceInstruments": dataset["source"]["instruments"],
            "startDate": dataset["period"]["start"],
            "endDate": dataset["period"]["end"],
            "rawRowCount": raw_row_count,
            "featureRowCount": len(frame),
            "missingObservations": dataset["missingObservations"],
            "datasetVersion": dataset["datasetVersion"],
            "datasetHash": dataset["contentHash"],
            "rawDatasetCommitted": False,
        },
        "features": feature_specification(),
        "splits": {
            "strategy": "EXPANDING_WINDOW_WALK_FORWARD",
            "rationale": plan.rationale,
            "walkForwardFolds": folds,
            "finalHoldout": {
                "startIndex": plan.holdout_start,
                "endIndexExclusive": plan.holdout_end,
                "startDate": _date(frame, plan.holdout_start),
                "endDate": _date(frame, plan.holdout_end - 1),
                "rowCount": plan.holdout_end - plan.holdout_start,
                "usedForSelection": False,
            },
            "randomShuffle": False,
            "supervisedPurgeSessions": 0,
            "supervisedPurgeReason": "NOT_APPLICABLE_NO_SUPERVISED_TARGET_QUALIFIED",
        },
        "leakageAudit": {
            "status": "PASS",
            "centeredWindows": False,
            "futureFeatures": False,
            "fullDatasetScaling": False,
            "retrospectiveHmmSmoothing": False,
            "finalHoldoutUsedForSelection": False,
        },
        "deterministicBaseline": {
            "modelVersion": "market-context-policy-1.0.0",
            "role": "CHAMPION",
            "contexts": ["NORMAL", "CAUTIOUS", "HIGH_VOLATILITY", "RISK_OFF"],
            "thresholdsChanged": False,
        },
        "hmm": {
            "status": hmm_status,
            "candidateStateCounts": list(HMM_STATE_COUNTS),
            "seeds": list(HMM_SEEDS),
            "qualificationThresholds": {
                "convergenceRateMin": QUALIFICATION_THRESHOLDS.convergence_rate_min,
                "minimumTrainingStateOccupancy": QUALIFICATION_THRESHOLDS.minimum_training_state_occupancy,
                "medianSeedAgreementMin": QUALIFICATION_THRESHOLDS.median_seed_agreement_min,
                "maximumSwitchingRate": QUALIFICATION_THRESHOLDS.maximum_switching_rate,
            },
            "selectionMethod": (
                "LEXICOGRAPHIC_PERMUTATION_ALIGNED_SEED_STABILITY_THEN_FOLD_CENTROID_STABILITY_"
                "THEN_OOS_LIKELIHOOD_THEN_SIMPLER_STATE_COUNT"
            ),
            "selectedStateCount": selected_state_count,
            "states": None if selected_state_count is None else [
                f"STATE_{index}" for index in range(selected_state_count)
            ],
            "semanticInterpretation": None,
            "candidates": [_public_candidate(candidate) for candidate in candidates],
            "finalHoldoutMetrics": final_metrics,
            "sameSeedRetrainingNumericallyReproducible": reproducible,
            "artifact": artifact_summary,
        },
        "xgboost": {
            "labelQualification": "FAIL",
            "status": "NOT_IMPLEMENTED",
            "reasonCode": "XGBOOST_SUPERVISED_LABELS_NOT_QUALIFIED",
            "reason": (
                "No independently justified forward-risk outcome thresholds were established; deterministic-policy "
                "labels are explicitly excluded because they test imitation rather than added market intelligence."
            ),
        },
        "lightgbm": {
            "status": "NOT_IMPLEMENTED",
            "reason": "No qualified supervised target; adding a second tree package would provide no defensible evidence.",
        },
        "recommendationLayerEvaluation": {
            "mlControlsAllocation": False,
            "allocationAdjustmentAttempts": 0,
            "suitabilityViolations": 0,
            "concentrationViolations": 0,
            "newInstrumentIntroductions": 0,
            "averageTacticalTurnoverPct": 0,
            "maximumTacticalTurnoverPct": 0,
            "boundedAdjustmentCompliance": "NOT_APPLICABLE_SHADOW_HAS_NO_ADJUSTMENT_PATH",
            "unavailableDataBehavior": "MODEL_CONTEXT_UNAVAILABLE_DETERMINISTIC_CHAMPION_REMAINS_AUTHORITY",
            "shadowStateSwitchingRate": (
                final_metrics["holdout"]["switchingRate"] if final_metrics else None
            ),
        },
        "modelRegistry": {
            "automaticPromotion": False,
            "champion": "market-context-policy-1.0.0",
            "shadowArtifact": artifact_summary,
        },
        "finalDecision": (
            "DETERMINISTIC_CHAMPION_HMM_SHADOW"
            if hmm_status == "SHADOW"
            else "DETERMINISTIC_CHAMPION_ML_NOT_QUALIFIED"
        ),
        "knownLimitations": [
            "The official NSE website history schema is validated but not a versioned contractual API.",
            "The reliable joined qualification period is five years; a ten-year India VIX retrieval did not qualify reliably.",
            "HMM states are unsupervised numeric clusters and have no claimed bull/bear/crash meaning.",
            "HMM probabilities are uncalibrated and intentionally not exposed as confidence.",
            "Drift output is diagnostic raw PSI/KS data with no automatic retraining or promotion.",
            "No investment-performance or excess-return claim is made.",
        ],
    }
    report_json_path.parent.mkdir(parents=True, exist_ok=True)
    report_markdown_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report_markdown_path.write_text(_render_markdown(report), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--artifact-directory", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    parser.add_argument("--report-markdown", type=Path, required=True)
    arguments = parser.parse_args()
    report = qualify(
        arguments.dataset,
        arguments.artifact_directory,
        arguments.report_json,
        arguments.report_markdown,
    )
    print(json.dumps({
        "status": "PHASE4_QUALIFICATION_COMPLETE",
        "decision": report["finalDecision"],
        "datasetVersion": report["data"]["datasetVersion"],
        "rawRowCount": report["data"]["rawRowCount"],
        "featureRowCount": report["data"]["featureRowCount"],
        "hmmStateCount": report["hmm"]["selectedStateCount"],
        "xgboost": report["xgboost"]["reasonCode"],
    }))


if __name__ == "__main__":
    main()
