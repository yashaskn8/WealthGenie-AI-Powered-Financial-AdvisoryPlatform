"""
WealthGenie ML Microservice - PyTorch Pipeline Test Suite
Tests PyTorch preprocessing, dataset loading, MLP network forward pass, training, evaluation, and FastAPI endpoints.
"""

import numpy as np
import pytest
import torch

from model.config import (
    PyTorchModelConfig,
    TrainingConfig,
    ArtifactPaths,
    set_random_seed,
)
from model.data.preprocessing import FeaturePreprocessor, prepare_synthetic_training_data
from model.data.dataset import FinancialDataset, create_data_loaders
from model.architecture.model import FinancialMLP
from model.training.train_pytorch import train_pytorch_model
from model.serving.inference import PyTorchInferenceEngine
from model.data.feature_engineering import FEATURE_NAMES

N_FEATURES = len(FEATURE_NAMES)


@pytest.fixture
def sample_data():
    set_random_seed(42)
    return prepare_synthetic_training_data(num_samples=600, seed=42)


@pytest.fixture
def tmp_artifact_paths(tmp_path):
    return ArtifactPaths(
        model_weights=tmp_path / "mlp_model.pt",
        scaler_path=tmp_path / "scaler.pkl",
        label_encoder_path=tmp_path / "label_encoder.pkl",
        metadata_path=tmp_path / "pytorch_metadata.json",
        metrics_path=tmp_path / "training_history.json",
    )


def test_feature_preprocessor(sample_data, tmp_path):
    X, _ = sample_data
    preprocessor = FeaturePreprocessor()

    X_scaled = preprocessor.fit_transform(X)
    assert X_scaled.shape == X.shape
    assert np.allclose(X_scaled.mean(axis=0), 0.0, atol=1e-1)

    scaler_file = tmp_path / "scaler.pkl"
    preprocessor.save(scaler_file)
    assert scaler_file.exists()

    loaded_preprocessor = FeaturePreprocessor()
    loaded_preprocessor.load(scaler_file)
    X_retransformed = loaded_preprocessor.transform(X)
    assert np.allclose(X_scaled, X_retransformed)


def test_financial_dataset_and_dataloaders(sample_data):
    X, y = sample_data
    dataset = FinancialDataset(X, y)
    assert len(dataset) == 600

    x_tensor, y_tensor = dataset[0]
    assert isinstance(x_tensor, torch.Tensor)
    assert isinstance(y_tensor, torch.Tensor)
    assert x_tensor.shape == (N_FEATURES,)

    preprocessor = FeaturePreprocessor()
    config = TrainingConfig(batch_size=32, test_split=0.2, val_split=0.2)
    train_loader, val_loader, test_loader, fitted_pre = create_data_loaders(
        X, y, preprocessor, config
    )

    assert len(train_loader.dataset) > 0
    assert len(val_loader.dataset) > 0
    assert len(test_loader.dataset) == 120


def test_financial_mlp_architecture():
    config = PyTorchModelConfig(input_dim=N_FEATURES, hidden_dims=[32, 16], output_dim=6)
    model = FinancialMLP(config)
    
    batch_x = torch.randn(8, N_FEATURES)
    logits = model(batch_x)
    assert logits.shape == (8, 6)

    probs = model.predict_proba(batch_x)
    assert probs.shape == (8, 6)
    assert torch.allclose(probs.sum(dim=1), torch.ones(8), atol=1e-5)


def test_train_pytorch_model_loop(sample_data, tmp_artifact_paths):
    X, y = sample_data
    model_config = PyTorchModelConfig(input_dim=N_FEATURES, hidden_dims=[32, 16], output_dim=6)
    training_config = TrainingConfig(epochs=5, batch_size=32, patience=3)

    results = train_pytorch_model(
        model_config=model_config,
        training_config=training_config,
        paths=tmp_artifact_paths,
        X=X,
        y=y,
    )

    assert tmp_artifact_paths.model_weights.exists()
    assert tmp_artifact_paths.scaler_path.exists()
    assert tmp_artifact_paths.metadata_path.exists()
    assert len(results["history"]["train_loss"]) == 5


def test_pytorch_inference_engine(sample_data, tmp_artifact_paths):
    X, y = sample_data
    train_pytorch_model(
        model_config=PyTorchModelConfig(input_dim=N_FEATURES, hidden_dims=[32, 16], output_dim=6),
        training_config=TrainingConfig(epochs=3, batch_size=32),
        paths=tmp_artifact_paths,
        X=X,
        y=y,
    )

    engine = PyTorchInferenceEngine(paths=tmp_artifact_paths)
    engine.load_artifacts()
    assert engine.is_loaded

    single_x = X[:1]
    res = engine.predict(single_x)
    assert res["model_used"] == "PyTorch_FinancialMLP"
    assert res["primary"] in engine.TARGET_CLASSES
    assert len(res["confidence_scores"]) == 6
