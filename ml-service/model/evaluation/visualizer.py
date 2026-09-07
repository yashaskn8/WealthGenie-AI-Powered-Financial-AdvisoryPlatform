"""
WealthGenie ML Microservice - Publication-Quality Training Visualizer
Generates and saves figures for loss/accuracy curves, confusion matrices, and feature importance.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for headless server execution
import matplotlib.pyplot as plt

from model.config import BASE_DIR

PLOTS_DIR = BASE_DIR / "reports" / "plots"
PLOTS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("wealthgenie.visualizer")


def plot_training_curves(history: Dict[str, List[float]], save_path: Optional[Path] = None) -> Path:
    """Generates publication-quality loss and accuracy curves per epoch."""
    if save_path is None:
        save_path = PLOTS_DIR / "training_curves.png"
    save_path.parent.mkdir(parents=True, exist_ok=True)

    epochs = range(1, len(history.get("train_loss", [])) + 1)
    if not epochs:
        logger.warning("Empty training history provided; skipping curve plot.")
        return save_path

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    fig.suptitle("Model Training & Validation Performance", fontsize=14, fontweight="bold")

    # Loss subplot
    ax1.plot(epochs, history["train_loss"], label="Train Loss", color="#1f77b4", linewidth=2)
    if "val_loss" in history:
        ax1.plot(epochs, history["val_loss"], label="Val Loss", color="#ff7f0e", linewidth=2, linestyle="--")
    ax1.set_title("Cross-Entropy Loss")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Accuracy subplot
    if "train_acc" in history:
        ax2.plot(epochs, history["train_acc"], label="Train Acc", color="#2ca02c", linewidth=2)
    if "val_acc" in history:
        ax2.plot(epochs, history["val_acc"], label="Val Acc", color="#d62728", linewidth=2, linestyle="--")
    ax2.set_title("Classification Accuracy")
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Accuracy")
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(save_path, dpi=300, bbox_inches="tight")
    plt.close()

    logger.info(f"Training curves saved to {save_path}")
    return save_path


def plot_confusion_matrix(matrix: List[List[int]], classes: List[str], save_path: Optional[Path] = None) -> Path:
    """Generates publication-quality Confusion Matrix heatmap."""
    if save_path is None:
        save_path = PLOTS_DIR / "confusion_matrix.png"
    save_path.parent.mkdir(parents=True, exist_ok=True)

    cm = np.array(matrix)
    # Truncate labels to match actual matrix dimensions (test datasets may have fewer classes)
    n_classes = cm.shape[0]
    display_classes = classes[:n_classes] if len(classes) >= n_classes else classes
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)

    ax.set(
        xticks=np.arange(cm.shape[1]),
        yticks=np.arange(cm.shape[0]),
        xticklabels=display_classes,
        yticklabels=display_classes,
        title="Confusion Matrix",
        ylabel="True Class",
        xlabel="Predicted Class",
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")

    # Loop over data dimensions and create text annotations
    fmt = "d"
    thresh = cm.max() / 2.0 if cm.max() > 0 else 1.0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(
                j, i, format(cm[i, j], fmt),
                ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black",
                fontweight="bold"
            )

    plt.tight_layout()
    plt.savefig(save_path, dpi=300, bbox_inches="tight")
    plt.close()

    logger.info(f"Confusion matrix plot saved to {save_path}")
    return save_path
