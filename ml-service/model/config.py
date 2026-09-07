"""
WealthGenie ML Microservice - PyTorch Configuration Module
Centralized hyperparameter and system configuration for PyTorch model training and inference.
"""

from pathlib import Path
from typing import List
from pydantic import BaseModel, Field
import torch


BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(__file__).resolve().parent
SAVED_MODELS_DIR = MODEL_DIR / "saved_models"
DATA_DIR = BASE_DIR / "data"

# Ensure saved models directory exists
SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)


class PyTorchModelConfig(BaseModel):
    """Configuration for PyTorch Multi-Layer Perceptron architecture."""
    input_dim: int = Field(19, description="Number of recommendation-features-4.0.0 inputs")
    hidden_dims: List[int] = Field([64, 32], description="Hidden layer dimensions")
    output_dim: int = Field(6, description="Number of target output classes")
    dropout_rate: float = Field(0.2, ge=0.0, le=0.8, description="Dropout rate")
    use_batch_norm: bool = Field(True, description="Whether to include BatchNorm layers")
    activation: str = Field("relu", description="Activation function type ('relu', 'gelu', 'leaky_relu')")


class TrainingConfig(BaseModel):
    """Configuration for PyTorch training pipeline."""
    batch_size: int = Field(64, ge=8, le=512, description="Batch size for DataLoader")
    epochs: int = Field(100, ge=1, le=1000, description="Maximum number of training epochs")
    learning_rate: float = Field(0.001, gt=0.0, le=0.1, description="Initial learning rate")
    weight_decay: float = Field(1e-4, ge=0.0, description="L2 regularization weight decay")
    patience: int = Field(15, ge=3, description="Early stopping patience in epochs")
    random_seed: int = Field(42, description="Random seed for reproducibility")
    val_split: float = Field(0.15, ge=0.05, le=0.3, description="Validation split ratio")
    test_split: float = Field(0.15, ge=0.05, le=0.3, description="Test split ratio")
    lr_scheduler_factor: float = Field(0.5, gt=0.0, lt=1.0, description="Factor by which to reduce LR on plateau")
    lr_scheduler_patience: int = Field(5, ge=1, description="Number of epochs with no improvement after which LR is reduced")
    min_lr: float = Field(1e-6, description="Minimum learning rate threshold")


class ArtifactPaths(BaseModel):
    """File paths for saving and loading PyTorch model artifacts."""
    model_config = {"protected_namespaces": ()}
    model_weights: Path = Field(SAVED_MODELS_DIR / "mlp_model.pt", description="Saved PyTorch weights")
    scaler_path: Path = Field(SAVED_MODELS_DIR / "scaler.pkl", description="Saved StandardScaler artifact")
    label_encoder_path: Path = Field(SAVED_MODELS_DIR / "label_encoder.pkl", description="Saved LabelEncoder artifact")
    metadata_path: Path = Field(SAVED_MODELS_DIR / "pytorch_metadata.json", description="Training and evaluation metadata")
    metrics_path: Path = Field(SAVED_MODELS_DIR / "training_history.json", description="Training metrics per epoch")


def get_device() -> torch.device:
    """Returns CUDA device if available, otherwise CPU."""
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def set_random_seed(seed: int = 42) -> None:
    """Sets deterministic random seeds across PyTorch, NumPy, and Python built-ins."""
    import random
    import numpy as np

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
