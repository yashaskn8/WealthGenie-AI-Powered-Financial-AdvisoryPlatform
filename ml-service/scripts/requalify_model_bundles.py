"""Reproducibly retrain the three non-authoritative serving model bundles.

This is an explicit offline/operator command. It is never run by application
startup. Outputs are first built and verified in a temporary directory, then
copied into the repository only when every architecture is serving-qualified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from model.architecture.base import BasePredictor  # noqa: E402
from model.architecture.ft_transformer import FTTransformerConfig  # noqa: E402
from model.artifacts.bundle import MANIFEST_FILENAME, sha256_file, verify_bundle  # noqa: E402
from model.config import ArtifactPaths, PyTorchModelConfig, TrainingConfig  # noqa: E402
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION  # noqa: E402
from model.data.preprocessing import (  # noqa: E402
    compute_dataset_hash_from_arrays,
    get_dataset_generation_params,
    prepare_synthetic_training_data,
    regenerate_synthetic_dataset_and_hash,
)
from model.training.lineage import current_training_git_sha  # noqa: E402
from model.training.train_pytorch import train_ft_transformer_model, train_pytorch_model  # noqa: E402
from model.training.train_rf import train_random_forest_model  # noqa: E402
from scripts.verify_serving_artifacts import verify_serving_artifacts  # noqa: E402


_ARCHITECTURE_DIRECTORIES = {
    "RandomForest": "random_forest",
    "PyTorch_MLP": "pytorch_mlp",
    "FT_Transformer": "ft_transformer",
}
TRUST_ANCHOR_FILENAME = "trusted_bundle_hashes.json"


def _current_head(repository_root: Path) -> str:
    result = subprocess.run(
        ["git", "-c", f"safe.directory={repository_root.as_posix()}", "rev-parse", "HEAD"],
        cwd=repository_root,
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    return result.stdout.strip().lower()


def _write_trusted_anchors(bundle_root: Path, bundle_records: dict[str, dict[str, str]]) -> None:
    expected_architectures = set(_ARCHITECTURE_DIRECTORIES)
    if set(bundle_records) != expected_architectures:
        raise RuntimeError("trusted anchor set must cover each supported architecture exactly once")
    payload: dict[str, Any] = {
        "anchor_schema_version": 1,
        "bundles": {
            architecture: {
                "bundle_id": record["bundle_id"],
                "bundle_manifest_sha256": record["bundle_manifest_sha256"],
            }
            for architecture, record in sorted(bundle_records.items())
        },
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    payload["anchor_sha256"] = hashlib.sha256(canonical).hexdigest()
    anchor_path = bundle_root / TRUST_ANCHOR_FILENAME
    anchor_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def requalify_models(*, num_samples: int = 2000, seed: int = 42) -> dict[str, Any]:
    repository_root = ML_SERVICE_ROOT.parent
    source_sha = _current_head(repository_root)
    if current_training_git_sha() != source_sha:
        raise RuntimeError("training sources are dirty or do not match HEAD; refusing serving-qualified retraining")
    published_bundle_root = ML_SERVICE_ROOT / "model" / "bundles"
    if published_bundle_root.exists():
        raise FileExistsError(f"refusing to overwrite existing model bundle store: {published_bundle_root}")

    X, y = prepare_synthetic_training_data(num_samples=num_samples, seed=seed)
    data_hash = compute_dataset_hash_from_arrays(X, y)
    reproduced_X, reproduced_y, reproduced_hash = regenerate_synthetic_dataset_and_hash(
        get_dataset_generation_params(num_samples=num_samples, seed=seed)
    )
    if reproduced_hash != data_hash or not (reproduced_X == X).all() or not (reproduced_y == y).all():
        raise RuntimeError("independent synthetic dataset reproduction did not match the shared training arrays")
    classes = list(BasePredictor.TARGET_CLASSES)
    if len(FEATURE_NAMES) != X.shape[1] or len(classes) != len(set(classes)):
        raise RuntimeError("canonical feature or target-class contract is inconsistent")

    records: dict[str, dict[str, str]] = {}
    evaluations: dict[str, dict[str, Any]] = {}
    shared_split_identity: dict[str, Any] | None = None
    with tempfile.TemporaryDirectory(prefix="wealthgenie-phase3-requalification-") as temp_name:
        temp_root = Path(temp_name)
        bundle_root = temp_root / "model" / "bundles"
        rf_dir = bundle_root / "random_forest"
        mlp_dir = bundle_root / "pytorch_mlp"
        ft_dir = bundle_root / "ft_transformer"

        _, _, rf_metadata = train_random_forest_model(
            num_samples=num_samples,
            seed=seed,
            model_dir=rf_dir,
            X=X,
            y_indices=y,
        )

        mlp_history = temp_root / "history" / "mlp_training_history.json"
        mlp_history.parent.mkdir(parents=True, exist_ok=True)
        mlp_paths = ArtifactPaths(
            model_weights=mlp_dir / "mlp_model.pt",
            scaler_path=mlp_dir / "scaler.pkl",
            label_encoder_path=temp_root / "unused-mlp-label-encoder.pkl",
            metadata_path=mlp_dir / "pytorch_metadata.json",
            metrics_path=mlp_history,
        )
        mlp_result = train_pytorch_model(
            model_config=PyTorchModelConfig(),
            training_config=TrainingConfig(random_seed=seed),
            paths=mlp_paths,
            X=X,
            y=y,
            bundle_dir=mlp_dir,
            diagnostics_dir=temp_root / "diagnostics",
            experiment_dir=temp_root / "experiments",
        )

        ft_result = train_ft_transformer_model(
            config=FTTransformerConfig(),
            training_config=TrainingConfig(random_seed=seed),
            save_path=ft_dir / "ft_transformer.pt",
            scaler_path=ft_dir / "scaler.pkl",
            X=X,
            y=y,
            bundle_dir=ft_dir,
        )

        outputs = {
            "RandomForest": (rf_dir, rf_metadata),
            "PyTorch_MLP": (mlp_dir, mlp_result["metadata"]),
            "FT_Transformer": (ft_dir, ft_result["metadata"]),
        }
        for architecture, (directory, metadata) in outputs.items():
            if metadata.get("training_data_hash") != data_hash:
                raise RuntimeError(f"{architecture} metadata does not match the reproduced shared dataset hash")
            if metadata.get("training_code_git_sha") != source_sha or metadata.get("serving_qualified") is not True:
                raise RuntimeError(f"{architecture} is missing verified training-source provenance")
            manifest_path = directory / MANIFEST_FILENAME
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("training_data_hash") != data_hash or manifest.get("training_code_git_sha") != source_sha:
                raise RuntimeError(f"{architecture} manifest provenance differs from the training run")
            split_identity = manifest["dataset_lineage"]["split_identity"]
            if shared_split_identity is None:
                shared_split_identity = split_identity
            elif split_identity != shared_split_identity:
                raise RuntimeError(f"{architecture} used a different split contract from the shared dataset")
            evaluation = json.loads((directory / "evaluation_report.json").read_text(encoding="utf-8"))
            if (
                evaluation.get("architecture") != architecture
                or evaluation.get("training_data_hash") != data_hash
                or evaluation.get("split_identity") != shared_split_identity
                or evaluation.get("training_code_git_sha") != source_sha
            ):
                raise RuntimeError(f"{architecture} evaluation evidence does not match the trained bundle lineage")
            evaluations[architecture] = {
                "evaluation_run_id": evaluation["evaluation_run_id"],
                "training_metrics": evaluation["training_metrics"],
                "validation_metrics": evaluation["validation_metrics"],
                "test_metrics": evaluation["test_metrics"],
            }
            verified = verify_bundle(directory, manifest["bundle_manifest_sha256"], require_serving_qualified=True)
            records[architecture] = {
                "bundle_id": verified["manifest"]["bundle_id"],
                "bundle_manifest_sha256": verified["manifest_sha256"],
            }

        if _current_head(repository_root) != source_sha or current_training_git_sha() != source_sha:
            raise RuntimeError("training source revision changed during model requalification")

        _write_trusted_anchors(bundle_root, records)
        verified_temp = verify_serving_artifacts(temp_root)
        if len(verified_temp) != len(_ARCHITECTURE_DIRECTORIES):
            raise RuntimeError("temporary bundle set did not verify completely")

        model_root = ML_SERVICE_ROOT / "model"
        stage_root = Path(tempfile.mkdtemp(prefix=".phase3-bundle-publish-", dir=model_root))
        try:
            staged_bundle_root = stage_root / "bundles"
            shutil.copytree(bundle_root, staged_bundle_root)
            if published_bundle_root.exists():
                raise FileExistsError(f"model bundle store appeared during publish: {published_bundle_root}")
            os.rename(staged_bundle_root, published_bundle_root)
        finally:
            shutil.rmtree(stage_root, ignore_errors=True)

    verified_paths = verify_serving_artifacts(ML_SERVICE_ROOT)
    return {
        "training_code_git_sha": source_sha,
        "training_data_hash": data_hash,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "target_classes": classes,
        "sample_count": int(len(y)),
        "seed": seed,
        "split_identity": shared_split_identity,
        "evaluations": evaluations,
        "verified_bundles": records,
        "verified_paths": verified_paths,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.samples < 600:
        parser.error("--samples must be at least 600 to preserve stratified train/validation/test class coverage")
    try:
        result = requalify_models(num_samples=args.samples, seed=args.seed)
    except Exception as exc:
        print(f"Model requalification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
