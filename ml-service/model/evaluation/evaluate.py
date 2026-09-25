"""
WealthGenie ML Microservice - Model Evaluation & Benchmarking Platform
Computes comprehensive classification metrics, MCC, Balanced Accuracy, Top-k Accuracy, and Throughput.
"""

import time
from typing import Dict, Any, List
import numpy as np
import torch
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    matthews_corrcoef,
    precision_recall_fscore_support,
    confusion_matrix,
    classification_report,
)

from model.config import get_device
from model.data.preprocessing import FeaturePreprocessor


def compute_top_k_accuracy(y_true: np.ndarray, y_proba: np.ndarray, k: int = 2) -> float:
    """Computes Top-k accuracy score (proportion of samples where true label is in top k predictions)."""
    top_k_preds = np.argsort(y_proba, axis=1)[:, -k:]
    correct = [y_true[i] in top_k_preds[i] for i in range(len(y_true))]
    return float(np.mean(correct))


def evaluate_model_predictions(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_proba: np.ndarray,
    model_name: str,
    latency_ms: float,
    classes: List[str] = None
) -> Dict[str, Any]:
    """
    Computes a complete battery of evaluation metrics for any model.
    """
    if classes is None:
        classes = ["Equity_MF", "ELSS", "ETF", "Debt_MF", "FD", "RBI_Bond"]

    acc = float(accuracy_score(y_true, y_pred))
    bal_acc = float(balanced_accuracy_score(y_true, y_pred))
    mcc = float(matthews_corrcoef(y_true, y_pred))
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="weighted", zero_division=0
    )

    top2_acc = compute_top_k_accuracy(y_true, y_proba, k=2) if y_proba is not None else acc
    top3_acc = compute_top_k_accuracy(y_true, y_proba, k=3) if y_proba is not None else acc

    conf_matrix = confusion_matrix(y_true, y_pred).tolist()
    report = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
    throughput_qps = (1000.0 / latency_ms) if latency_ms > 0 else 0.0

    return {
        "model_name": model_name,
        "accuracy": round(acc, 4),
        "balanced_accuracy": round(bal_acc, 4),
        "matthews_corrcoef": round(mcc, 4),
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1_score": round(float(f1), 4),
        "top_2_accuracy": round(top2_acc, 4),
        "top_3_accuracy": round(top3_acc, 4),
        "avg_latency_ms": round(latency_ms, 3),
        "throughput_queries_per_sec": round(throughput_qps, 1),
        "confusion_matrix": conf_matrix,
        "classification_report": report,
    }


def evaluate_pytorch_model(
    model: torch.nn.Module,
    test_loader: torch.utils.data.DataLoader,
    device: torch.device = None,
    classes: List[str] = None,
    model_name: str = "PyTorch_FinancialMLP",
) -> Dict[str, Any]:
    """
    Evaluates a PyTorch neural network model on a DataLoader test set.
    """
    if device is None:
        device = get_device()

    model.eval()
    model.to(device)

    all_preds = []
    all_targets = []
    all_probas = []
    latencies = []

    with torch.no_grad():
        for inputs, targets in test_loader:
            inputs = inputs.to(device)
            start_time = time.perf_counter()
            probs = model.predict_proba(inputs)
            latency_ms = (time.perf_counter() - start_time) * 1000.0 / inputs.size(0)
            latencies.append(latency_ms)

            preds = torch.argmax(probs, dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_targets.extend(targets.numpy())
            all_probas.extend(probs.cpu().numpy())

    all_preds = np.array(all_preds)
    all_targets = np.array(all_targets)
    all_probas = np.array(all_probas)
    avg_latency = float(np.mean(latencies))

    return evaluate_model_predictions(
        all_targets, all_preds, all_probas, model_name, avg_latency, classes
    )


def compare_models(
    rf_model: Any,
    pytorch_model: torch.nn.Module,
    preprocessor: FeaturePreprocessor,
    X_test: np.ndarray,
    y_test: np.ndarray,
    device: torch.device = None
) -> Dict[str, Any]:
    """Side-by-side benchmarking of Random Forest vs PyTorch MLP."""
    if device is None:
        device = get_device()

    rf_start = time.perf_counter()
    rf_preds = rf_model.predict(X_test)
    rf_latency_ms = (time.perf_counter() - rf_start) * 1000.0 / len(X_test)
    rf_acc = float(accuracy_score(y_test, rf_preds))

    X_test_scaled = preprocessor.transform(X_test)
    X_tensor = torch.tensor(X_test_scaled, dtype=torch.float32, device=device)
    pytorch_model.eval()
    pytorch_model.to(device)
    with torch.no_grad():
        pt_start = time.perf_counter()
        pt_logits = pytorch_model(X_tensor)
        pt_preds = torch.argmax(pt_logits, dim=1).cpu().numpy()
        pt_latency_ms = (time.perf_counter() - pt_start) * 1000.0 / len(X_test)

    pt_acc = float(accuracy_score(y_test, pt_preds))

    return {
        "random_forest": {"accuracy": round(rf_acc, 4), "latency_ms": round(rf_latency_ms, 4)},
        "pytorch_mlp": {"accuracy": round(pt_acc, 4), "latency_ms": round(pt_latency_ms, 4)},
    }
