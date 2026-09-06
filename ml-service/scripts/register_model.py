"""
register_model.py — CLI to register a v4 model checkpoint into the registry.

Reads the versioned v4 rigor report to populate honest policy-fidelity metrics.
Computes and stores reference distributions for drift monitoring.

Usage:
  python -m scripts.register_model \
    --checkpoint model/model.pkl \
    --architecture RandomForest \
    --metrics model/rigor_evaluation_report.json \
    --set-active
"""

import argparse
import json
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
from model.registry.registry_store import ModelRegistry
from model.registry.drift_detection import compute_reference_distributions
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.data.preprocessing import (
    compute_dataset_hash_from_arrays,
    prepare_synthetic_training_data,
)


MODEL_DIR = PROJECT_ROOT / "model"

MODEL_FEATURES = FEATURE_NAMES


def load_rigor_report(metrics_path: Path) -> dict:
    """Load and validate a frozen-architecture v4 rigor report."""
    with open(metrics_path, "r", encoding="utf-8") as f:
        report = json.load(f)
    audit = report.get("feature_contract_audit") or {}
    if (
        audit.get("feature_schema_version") != FEATURE_SCHEMA_VERSION
        or audit.get("feature_names") != FEATURE_NAMES
        or audit.get("finding") != "PASS"
    ):
        raise ValueError("Rigor report does not prove the ordered v4 feature allowlist")
    return report


def extract_architecture_metrics(rigor_report: dict, architecture: str) -> dict:
    """
    Extract the correct metrics for a given architecture.

    Legacy v3 multi-model and CFP figures are intentionally not imported: they
    were computed from unauthorized annual-income/debt features and cannot be
    evidence for a v4 candidate.
    """
    if architecture not in {"RandomForest", "PyTorch_MLP", "FT_Transformer"}:
        raise ValueError(f"Unsupported architecture: {architecture}")
    metric_reframe = rigor_report.get("metric_reframe") or {}
    metrics = {
        "feature_contract_audit": rigor_report["feature_contract_audit"],
        "formula_logic_overlap_audit": rigor_report.get("formula_logic_overlap_audit", {}),
        "noise_robustness": rigor_report.get("noise_robustness", {}),
        "metric_interpretation": "policy-approximation fidelity, not investment outcome accuracy",
    }
    if architecture == "RandomForest":
        fidelity = metric_reframe.get("policy_approximation_fidelity_random_forest")
        if fidelity is None:
            raise ValueError("Rigor report lacks RandomForest v4 policy-fidelity evidence")
        metrics["rule_approximation_fidelity"] = fidelity
    return metrics


def extract_hyperparameters(architecture: str) -> dict:
    """
    Load only hyperparameters accompanied by architecture-specific v4 metadata.
    """
    metadata_paths = {
        "RandomForest": MODEL_DIR / "metadata.json",
        "PyTorch_MLP": MODEL_DIR / "saved_models" / "pytorch_metadata.json",
        "FT_Transformer": MODEL_DIR / "saved_models" / "ft_transformer_metadata.json",
    }
    metadata_path = metadata_paths.get(architecture)
    if metadata_path is None or not metadata_path.exists():
        raise ValueError(f"Versioned metadata is missing for {architecture}")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or metadata.get("feature_names") != FEATURE_NAMES:
        raise ValueError(f"{architecture} metadata does not match the ordered v4 feature allowlist")
    hparams = dict(metadata.get("model_config") or {})
    for name in ("n_estimators", "max_depth", "epochs_completed", "best_val_loss"):
        if name in metadata:
            hparams[name] = metadata[name]
    return hparams


def main():
    parser = argparse.ArgumentParser(
        description="Register a model checkpoint into the WealthGenie ML registry."
    )
    parser.add_argument(
        "--checkpoint", type=str, required=True,
        help="Path to the serialized model file (e.g., model.pkl, ft_transformer.pt)"
    )
    parser.add_argument(
        "--architecture", type=str, required=True,
        choices=["RandomForest", "PyTorch_MLP", "FT_Transformer"],
        help="Model architecture identifier"
    )
    parser.add_argument(
        "--metrics", type=str, required=True,
        help="Path to the v4 rigor_evaluation_report.json"
    )
    parser.add_argument(
        "--set-active", action="store_true", default=False,
        help="Set this version as the active model for its architecture"
    )
    parser.add_argument(
        "--notes", type=str, default=None,
        help="Optional notes for this version"
    )
    parser.add_argument(
        "--db-path", type=str, default=None,
        help="Optional path to registry SQLite database"
    )

    args = parser.parse_args()

    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.is_absolute():
        checkpoint_path = PROJECT_ROOT / checkpoint_path
    metrics_path = Path(args.metrics)
    if not metrics_path.is_absolute():
        metrics_path = PROJECT_ROOT / metrics_path

    if not checkpoint_path.exists():
        print(f"ERROR: Checkpoint file not found: {checkpoint_path}")
        sys.exit(1)
    if not metrics_path.exists():
        print(f"ERROR: Metrics file not found: {metrics_path}")
        sys.exit(1)

    # Load rigor report and extract architecture-specific metrics
    rigor_report = load_rigor_report(metrics_path)
    metrics = extract_architecture_metrics(rigor_report, args.architecture)
    hyperparameters = extract_hyperparameters(args.architecture)

    # Validate versioned metadata and reproduce the same v4 feature contract
    # used by the trainer. A legacy CSV is never accepted as model lineage.
    metadata_path = MODEL_DIR / "metadata.json"
    training_timestamp = "unknown"
    if not metadata_path.exists():
        print(f"ERROR: Versioned metadata not found: {metadata_path}")
        sys.exit(1)
    with open(metadata_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    if meta.get("feature_schema_version") != FEATURE_SCHEMA_VERSION or meta.get("feature_names") != FEATURE_NAMES:
        print("ERROR: Refusing to register stale or incompatible feature metadata")
        sys.exit(1)
    lineage = meta.get("dataset_lineage") or {}
    sample_count = int(lineage.get("num_samples", 2_000))
    seed = int(lineage.get("seed", 42))
    reference_x, reference_y = prepare_synthetic_training_data(num_samples=sample_count, seed=seed)
    training_data_hash = compute_dataset_hash_from_arrays(reference_x, reference_y)
    if meta.get("training_data_hash") not in (None, training_data_hash):
        print("ERROR: Refusing to register artifact whose training-data hash cannot be reproduced")
        sys.exit(1)
    reference_distributions = compute_reference_distributions(
        pd.DataFrame(reference_x, columns=MODEL_FEATURES), MODEL_FEATURES
    )
    training_timestamp = meta.get("trained_at", training_timestamp)
    hyperparameters.update({
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": FEATURE_NAMES,
        "dataset_lineage": lineage,
    })

    # Register
    db_path = Path(args.db_path) if args.db_path else None
    registry = ModelRegistry(db_path=db_path)
    try:
        version_id = registry.register_model(
            model_architecture=args.architecture,
            artifact_path=checkpoint_path,
            training_data_hash=training_data_hash,
            training_timestamp=training_timestamp,
            hyperparameters=hyperparameters,
            metrics=metrics,
            reference_distributions=reference_distributions,
            notes=args.notes,
            set_active=args.set_active,
        )
        print(f"[OK] Registered {args.architecture} as version {version_id}")
        if args.set_active:
            print(f"  -> Set as ACTIVE model for {args.architecture}")
    finally:
        registry.close()


if __name__ == "__main__":
    main()
