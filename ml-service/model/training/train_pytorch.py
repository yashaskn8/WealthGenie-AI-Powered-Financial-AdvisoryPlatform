"""
WealthGenie ML Microservice - Advanced PyTorch Trainer
Includes Pre-Training Data Validation Gate, Gradient Clipping, Automatic Mixed Precision (AMP),
Experiment Tracking, and Publication Visualizations.
"""

import json
import hashlib
import logging
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import sklearn
import joblib

from model.architecture.base import BasePredictor
from model.artifacts.bundle import MANIFEST_FILENAME, build_bundle_manifest, sha256_file
from model.config import (
    PyTorchModelConfig,
    TrainingConfig,
    ArtifactPaths,
    get_device,
    set_random_seed,
)
from model.data.data_validator import PreTrainingDataValidator
from model.data.dataset import create_data_loaders
from model.evaluation.evaluate import evaluate_pytorch_model
from model.evaluation.experiments import ExperimentTracker
from model.architecture.ft_transformer import FTTransformer, FTTransformerConfig
from model.architecture.model import FinancialMLP
from model.data.preprocessing import FeaturePreprocessor, prepare_synthetic_training_data
from model.evaluation.visualizer import plot_training_curves, plot_confusion_matrix
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from model.training.lineage import build_dataset_lineage, current_training_git_sha

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("wealthgenie.pytorch_trainer")


class EarlyStopping:
    """Monitors validation loss and signals early stopping when no improvement occurs within patience epochs."""

    def __init__(self, patience: int = 15, min_delta: float = 1e-4):
        self.patience = patience
        self.min_delta = min_delta
        self.counter = 0
        self.best_loss = float("inf")
        self.early_stop = False

    def __call__(self, val_loss: float) -> bool:
        if val_loss < self.best_loss - self.min_delta:
            self.best_loss = val_loss
            self.counter = 0
        else:
            self.counter += 1
            if self.counter >= self.patience:
                self.early_stop = True
        return self.early_stop


def train_pytorch_model(
    model_config: PyTorchModelConfig = PyTorchModelConfig(),
    training_config: TrainingConfig = TrainingConfig(),
    paths: ArtifactPaths = ArtifactPaths(),
    X: Optional[np.ndarray] = None,
    y: Optional[np.ndarray] = None,
    max_grad_norm: float = 1.0,
    bundle_dir: Optional[Path] = None,
    diagnostics_dir: Optional[Path] = None,
    experiment_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Executes advanced training pipeline for PyTorch FinancialMLP.
    Includes Data Validation, Gradient Clipping, AMP, Visualizations, and Experiment Tracking.
    """
    set_random_seed(training_config.random_seed)
    device = get_device()
    logger.info(f"Initiating PyTorch training on device: {device}")

    # 1. Prepare synthetic dataset if X, y not provided
    if X is None or y is None:
        logger.info("Generating synthetic training dataset...")
        X, y = prepare_synthetic_training_data(num_samples=2000, seed=training_config.random_seed)
    X = np.asarray(X, dtype=np.float64)
    y = np.asarray(y, dtype=np.int64)
    data_hash, dataset_lineage, split_indices = build_dataset_lineage(
        X,
        y,
        seed=training_config.random_seed,
        config=training_config,
        target_classes=list(BasePredictor.TARGET_CLASSES),
    )

    # 2. Pre-Training Data Validation Gate
    validator = PreTrainingDataValidator()
    validator.validate(X, y)
    logger.info("Data Validation Gate Passed.")

    # 3. Create DataLoaders
    preprocessor = FeaturePreprocessor()
    train_loader, val_loader, test_loader, preprocessor = create_data_loaders(
        X, y, preprocessor, training_config
    )

    # 4. Instantiate Model, Loss, Optimizer, and LR Scheduler
    model = FinancialMLP(model_config).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(
        model.parameters(),
        lr=training_config.learning_rate,
        weight_decay=training_config.weight_decay,
    )
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="min",
        factor=training_config.lr_scheduler_factor,
        patience=training_config.lr_scheduler_patience,
        min_lr=training_config.min_lr,
    )
    early_stopping = EarlyStopping(patience=training_config.patience)
    scaler = torch.amp.GradScaler(device.type) if device.type == "cuda" else None

    history: Dict[str, List[float]] = {
        "train_loss": [],
        "val_loss": [],
        "train_acc": [],
        "val_acc": [],
        "learning_rates": [],
    }

    start_time = time.time()
    best_val_loss = float("inf")
    best_model_weights = None

    logger.info(f"Starting PyTorch MLP training for up to {training_config.epochs} epochs...")

    for epoch in range(1, training_config.epochs + 1):
        # ── Training Phase ──
        model.train()
        running_loss = 0.0
        correct_train = 0
        total_train = 0

        for inputs, targets in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad()

            if scaler is not None:
                with torch.amp.autocast(device_type=device.type):
                    outputs = model(inputs)
                    loss = criterion(outputs, targets)
                scaled_loss = scaler.scale(loss)
                if isinstance(scaled_loss, torch.Tensor):
                    scaled_loss.backward()
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=max_grad_norm)
                scaler.step(optimizer)
                scaler.update()
            else:
                outputs = model(inputs)
                loss = criterion(outputs, targets)

                # Loss anomaly check
                if torch.isnan(loss) or torch.isinf(loss):
                    raise ValueError(f"NaN/Inf loss anomaly detected at epoch {epoch}")

                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=max_grad_norm)
                optimizer.step()

            running_loss += loss.item() * inputs.size(0)
            _, predicted = torch.max(outputs, 1)
            total_train += targets.size(0)
            correct_train += (predicted == targets).sum().item()

        epoch_train_loss = running_loss / total_train
        epoch_train_acc = correct_train / total_train

        # ── Validation Phase ──
        model.eval()
        val_running_loss = 0.0
        correct_val = 0
        total_val = 0

        with torch.no_grad():
            for inputs, targets in val_loader:
                inputs, targets = inputs.to(device), targets.to(device)
                outputs = model(inputs)
                loss = criterion(outputs, targets)

                val_running_loss += loss.item() * inputs.size(0)
                _, predicted = torch.max(outputs, 1)
                total_val += targets.size(0)
                correct_val += (predicted == targets).sum().item()

        epoch_val_loss = val_running_loss / total_val
        epoch_val_acc = correct_val / total_val

        current_lr = optimizer.param_groups[0]["lr"]
        scheduler.step(epoch_val_loss)

        history["train_loss"].append(round(epoch_train_loss, 4))
        history["val_loss"].append(round(epoch_val_loss, 4))
        history["train_acc"].append(round(epoch_train_acc, 4))
        history["val_acc"].append(round(epoch_val_acc, 4))
        history["learning_rates"].append(current_lr)

        if epoch % 10 == 0 or epoch == 1:
            logger.info(
                f"Epoch {epoch:03d}/{training_config.epochs:03d} | "
                f"Train Loss: {epoch_train_loss:.4f} Acc: {epoch_train_acc:.4f} | "
                f"Val Loss: {epoch_val_loss:.4f} Acc: {epoch_val_acc:.4f} | LR: {current_lr:.6f}"
            )

        if epoch_val_loss < best_val_loss:
            best_val_loss = epoch_val_loss
            best_model_weights = {
                name: tensor.detach().cpu().clone()
                for name, tensor in model.state_dict().items()
            }

        if early_stopping(epoch_val_loss):
            logger.info(f"Early stopping triggered at epoch {epoch}")
            break

    elapsed_time = time.time() - start_time
    if best_model_weights is not None:
        model.load_state_dict(best_model_weights)

    # Evaluate the selected checkpoint on each declared, disjoint split.
    training_metrics = evaluate_pytorch_model(
        model, train_loader, device, classes=list(BasePredictor.TARGET_CLASSES)
    )
    validation_metrics = evaluate_pytorch_model(
        model, val_loader, device, classes=list(BasePredictor.TARGET_CLASSES)
    )
    eval_metrics = evaluate_pytorch_model(
        model, test_loader, device, classes=list(BasePredictor.TARGET_CLASSES)
    )

    # 6. Save Artifacts
    paths.model_weights.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), paths.model_weights)
    preprocessor.save(paths.scaler_path)

    training_timestamp = datetime.now(timezone.utc).isoformat()
    training_git_sha = current_training_git_sha()
    evaluation_id = f"mlp-{data_hash[:12]}-{hashlib.sha256(training_timestamp.encode()).hexdigest()[:12]}"
    framework_versions = {
        "numpy": np.__version__,
        "scikit-learn": sklearn.__version__,
        "torch": torch.__version__,
        "joblib": joblib.__version__,
    }
    split_identity = dataset_lineage["split_identity"]
    evaluation_report = {
        "evaluation_run_id": evaluation_id,
        "architecture": "PyTorch_MLP",
        "model_version": "4.0.0",
        "artifact_identity": {
            "weights_sha256": sha256_file(paths.model_weights),
            "scaler_sha256": sha256_file(paths.scaler_path),
        },
        "training_data_hash": data_hash,
        "split_identity": split_identity,
        "training_code_git_sha": training_git_sha,
        "evaluation_code_git_sha": training_git_sha,
        "metric_definitions": {
            "accuracy": "fraction of split examples matching the synthetic policy label",
            "balanced_accuracy": "unweighted mean recall across target classes",
            "f1_score": "support-weighted class-wise F1",
            "top_2_accuracy": "fraction with the synthetic policy label among the two highest probabilities",
        },
        "evaluation_methodology": "checkpoint selected by validation loss with early stopping; train and validation metrics are diagnostic; test partition is evaluated only after checkpoint selection",
        "model_config": model_config.model_dump(),
        "training_config": training_config.model_dump(),
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": eval_metrics,
        "evaluated_at": training_timestamp,
        "interpretation": "synthetic suitability-policy approximation fidelity; not investor outcomes or investment performance",
    }
    report_path = (Path(bundle_dir) if bundle_dir is not None else paths.metadata_path.parent) / "evaluation_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(evaluation_report, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )

    metadata = {
        "model_type": "PyTorch_FinancialMLP",
        "version": "4.0.0",
        "model_version": "4.0.0",
        "architecture": "PyTorch_MLP",
        "git_commit_hash": training_git_sha,
        "training_code_git_sha": training_git_sha,
        "serving_qualified": training_git_sha is not None,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "target_classes": list(BasePredictor.TARGET_CLASSES),
        "training_data_hash": data_hash,
        "dataset_lineage": dataset_lineage,
        "training_timestamp": training_timestamp,
        "trained_at": training_timestamp,
        "python_version": platform.python_version(),
        "framework_versions": framework_versions,
        "random_seed": training_config.random_seed,
        "evaluation_run_id": evaluation_id,
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": eval_metrics,
        "metric_interpretation": evaluation_report["interpretation"],
        "training_time_seconds": round(elapsed_time, 4),
        "epochs_completed": len(history["train_loss"]),
        "best_val_loss": round(best_val_loss, 4),
        "best_val_accuracy": round(max(history["val_acc"]), 4),
        "model_config": model_config.model_dump(),
        "training_config": training_config.model_dump(),
        "device_used": str(device),
    }

    with open(paths.metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, sort_keys=True, allow_nan=False)

    if bundle_dir is not None:
        bundle_root = Path(bundle_dir).resolve()
        expected_paths = (paths.model_weights.resolve(), paths.scaler_path.resolve(), paths.metadata_path.resolve(), report_path.resolve())
        if any(path.parent != bundle_root for path in expected_paths):
            raise ValueError("all MLP bundle members must be written directly in bundle_dir")
        manifest = build_bundle_manifest(
            bundle_root,
            bundle_id=f"mlp-{data_hash[:12]}-{(training_git_sha or 'unqualified')[:12]}",
            architecture="PyTorch_MLP",
            model_version="4.0.0",
            feature_schema_version=FEATURE_SCHEMA_VERSION,
            feature_names=list(FEATURE_NAMES),
            target_classes=list(BasePredictor.TARGET_CLASSES),
            training_data_hash=data_hash,
            training_code_git_sha=training_git_sha,
            training_timestamp=training_timestamp,
            dataset_lineage=dataset_lineage,
            python_version=platform.python_version(),
            framework_versions=framework_versions,
            evaluation_report_id=evaluation_id,
            evaluation_report_sha256=sha256_file(report_path),
            serving_qualified=training_git_sha is not None,
        )
        (bundle_root / MANIFEST_FILENAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n",
            encoding="utf-8",
        )

    with open(paths.metrics_path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

    # 7. Generate Visualizations
    plot_training_curves(
        history,
        save_path=(Path(diagnostics_dir) / "training_curves.png") if diagnostics_dir else None,
    )
    if "confusion_matrix" in eval_metrics:
        plot_confusion_matrix(
            eval_metrics["confusion_matrix"],
            metadata["target_classes"],
            save_path=(Path(diagnostics_dir) / "confusion_matrix.png") if diagnostics_dir else None,
        )

    # 8. Log Structured Experiment
    tracker = ExperimentTracker(experiments_dir=Path(experiment_dir)) if experiment_dir else ExperimentTracker()
    tracker.log_experiment(
        model_name="PyTorch_FinancialMLP",
        model_type="MultiLayerPerceptron",
        hyperparameters={**model_config.model_dump(), **training_config.model_dump()},
        dataset_stats={"num_samples": len(X), "num_features": X.shape[1]},
        metrics=eval_metrics,
        history=history,
        model_artifact_path=paths.model_weights,
        git_commit_hash=training_git_sha,
    )

    logger.info("PyTorch MLP training pipeline finished successfully.")
    return {
        "metadata": metadata,
        "metrics": eval_metrics,
        "history": history,
        "preprocessor": preprocessor,
        "model": model,
        "test_loader": test_loader,
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": eval_metrics,
        "dataset_hash": data_hash,
        "dataset_lineage": dataset_lineage,
        "split_indices": split_indices,
        "training_git_sha": training_git_sha,
        "evaluation_report": evaluation_report,
    }


def train_ft_transformer_model(
    config: FTTransformerConfig = FTTransformerConfig(),
    training_config: TrainingConfig = TrainingConfig(),
    save_path: Optional[Path] = None,
    scaler_path: Optional[Path] = None,
    X: Optional[np.ndarray] = None,
    y: Optional[np.ndarray] = None,
    bundle_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Executes training pipeline for the PyTorch FT-Transformer tabular neural network model.
    """
    set_random_seed(training_config.random_seed)
    device = get_device()

    base_dir = Path(bundle_dir) if bundle_dir is not None else Path(__file__).resolve().parent.parent / "saved_models"
    base_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_path or (base_dir / "ft_transformer.pt")
    scaler_path = scaler_path or (base_dir / "scaler.pkl")

    if X is None or y is None:
        X, y = prepare_synthetic_training_data(num_samples=2000, seed=training_config.random_seed)
    X = np.asarray(X, dtype=np.float64)
    y = np.asarray(y, dtype=np.int64)
    data_hash, dataset_lineage, split_indices = build_dataset_lineage(
        X,
        y,
        seed=training_config.random_seed,
        config=training_config,
        target_classes=list(BasePredictor.TARGET_CLASSES),
    )

    preprocessor = FeaturePreprocessor()
    train_loader, val_loader, test_loader, preprocessor = create_data_loaders(
        X, y, preprocessor, training_config
    )

    model = FTTransformer(config).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=training_config.learning_rate, weight_decay=1e-4)

    for epoch in range(1, training_config.epochs + 1):
        model.train()
        for inputs, targets in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

    model.eval()
    training_metrics = evaluate_pytorch_model(
        model, train_loader, device, classes=list(BasePredictor.TARGET_CLASSES)
    )
    validation_metrics = evaluate_pytorch_model(
        model, val_loader, device, classes=list(BasePredictor.TARGET_CLASSES)
    )
    eval_metrics = evaluate_pytorch_model(
        model, test_loader, device, classes=list(BasePredictor.TARGET_CLASSES)
    )

    save_path.parent.mkdir(parents=True, exist_ok=True)
    scaler_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), save_path)
    preprocessor.save(scaler_path)

    training_timestamp = datetime.now(timezone.utc).isoformat()
    training_git_sha = current_training_git_sha()
    evaluation_id = f"ft-{data_hash[:12]}-{hashlib.sha256(training_timestamp.encode()).hexdigest()[:12]}"
    framework_versions = {
        "numpy": np.__version__,
        "scikit-learn": sklearn.__version__,
        "torch": torch.__version__,
        "joblib": joblib.__version__,
    }
    ft_metadata_path = (Path(bundle_dir) if bundle_dir is not None else save_path.parent) / "ft_transformer_metadata.json"
    report_path = (Path(bundle_dir) if bundle_dir is not None else save_path.parent) / "evaluation_report.json"
    evaluation_report = {
        "evaluation_run_id": evaluation_id,
        "architecture": "FT_Transformer",
        "model_version": "4.0.0",
        "artifact_identity": {
            "weights_sha256": sha256_file(save_path),
            "scaler_sha256": sha256_file(scaler_path),
        },
        "training_data_hash": data_hash,
        "split_identity": dataset_lineage["split_identity"],
        "training_code_git_sha": training_git_sha,
        "evaluation_code_git_sha": training_git_sha,
        "metric_definitions": {
            "accuracy": "fraction of split examples matching the synthetic policy label",
            "balanced_accuracy": "unweighted mean recall across target classes",
            "f1_score": "support-weighted class-wise F1",
            "top_2_accuracy": "fraction with the synthetic policy label among the two highest probabilities",
        },
        "evaluation_methodology": "fixed configured epoch count trained only on the train partition; validation and test partitions are evaluated after training and are not used for model selection",
        "model_config": config.model_dump(),
        "training_config": training_config.model_dump(),
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": eval_metrics,
        "evaluated_at": training_timestamp,
        "interpretation": "synthetic suitability-policy approximation fidelity; not investor outcomes or investment performance",
    }
    report_path.write_text(
        json.dumps(evaluation_report, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    metadata = {
        "version": "4.0.0",
        "model_version": "4.0.0",
        "architecture": "FT_Transformer",
        "git_commit_hash": training_git_sha,
        "training_code_git_sha": training_git_sha,
        "serving_qualified": training_git_sha is not None,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "target_classes": list(BasePredictor.TARGET_CLASSES),
        "training_data_hash": data_hash,
        "dataset_lineage": dataset_lineage,
        "training_timestamp": training_timestamp,
        "trained_at": training_timestamp,
        "python_version": platform.python_version(),
        "framework_versions": framework_versions,
        "random_seed": training_config.random_seed,
        "evaluation_run_id": evaluation_id,
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": eval_metrics,
        "training_config": training_config.model_dump(),
        "model_config": config.model_dump(),
        "device_used": str(device),
        "metric_interpretation": evaluation_report["interpretation"],
    }
    ft_metadata_path.write_text(
        json.dumps(metadata, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )

    if bundle_dir is not None:
        bundle_root = Path(bundle_dir).resolve()
        expected_paths = (save_path.resolve(), scaler_path.resolve(), ft_metadata_path.resolve(), report_path.resolve())
        if any(path.parent != bundle_root for path in expected_paths):
            raise ValueError("all FT-Transformer bundle members must be written directly in bundle_dir")
        manifest = build_bundle_manifest(
            bundle_root,
            bundle_id=f"ft-{data_hash[:12]}-{(training_git_sha or 'unqualified')[:12]}",
            architecture="FT_Transformer",
            model_version="4.0.0",
            feature_schema_version=FEATURE_SCHEMA_VERSION,
            feature_names=list(FEATURE_NAMES),
            target_classes=list(BasePredictor.TARGET_CLASSES),
            training_data_hash=data_hash,
            training_code_git_sha=training_git_sha,
            training_timestamp=training_timestamp,
            dataset_lineage=dataset_lineage,
            python_version=platform.python_version(),
            framework_versions=framework_versions,
            evaluation_report_id=evaluation_id,
            evaluation_report_sha256=sha256_file(report_path),
            serving_qualified=training_git_sha is not None,
        )
        (bundle_root / MANIFEST_FILENAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n",
            encoding="utf-8",
        )

    logger.info("FT-Transformer trained successfully and saved to %s", save_path)
    return {
        "metrics": eval_metrics,
        "training_metrics": training_metrics,
        "validation_metrics": validation_metrics,
        "test_metrics": eval_metrics,
        "save_path": str(save_path),
        "metadata": metadata,
        "dataset_hash": data_hash,
        "dataset_lineage": dataset_lineage,
        "split_indices": split_indices,
        "training_git_sha": training_git_sha,
        "evaluation_report": evaluation_report,
    }


if __name__ == "__main__":
    train_pytorch_model()
    train_ft_transformer_model()
