"""
WealthGenie ML Microservice - PyTorch Pipeline Test Suite
Tests PyTorch preprocessing, dataset loading, MLP network forward pass, training, evaluation, and FastAPI endpoints.
"""

import numpy as np
import pytest
import torch
from torch.utils.data import DataLoader, TensorDataset

from model.config import (
    PyTorchModelConfig,
    TrainingConfig,
    ArtifactPaths,
    set_random_seed,
)
from model.data.preprocessing import FeaturePreprocessor, prepare_synthetic_training_data
from model.data.dataset import FinancialDataset, create_data_loaders, create_stratified_split_indices
from model.architecture.model import FinancialMLP
from model.training.train_pytorch import train_pytorch_model
from model.serving.inference import PyTorchInferenceEngine
from model.data.feature_engineering import FEATURE_NAMES
from model.evaluation.evaluate import evaluate_pytorch_model

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
    split_a = create_stratified_split_indices(y, config)
    split_b = create_stratified_split_indices(y, config)
    assert all(np.array_equal(a, b) for a, b in zip(split_a, split_b))
    assert len(set(np.concatenate(split_a).tolist())) == len(y)
    assert set(np.concatenate(split_a).tolist()) == set(range(len(y)))

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


@pytest.mark.parametrize(
    ("model_name", "expected_name"),
    [("PyTorch_FinancialMLP", "PyTorch_FinancialMLP"), ("FT_Transformer", "FT_Transformer")],
)
def test_pytorch_evaluation_report_uses_actual_architecture(model_name, expected_name):
    class FixedProbabilityModel(torch.nn.Module):
        def predict_proba(self, inputs):
            return torch.nn.functional.one_hot(
                inputs[:, 0].long(),
                num_classes=6,
            ).float()

    inputs = torch.zeros((6, N_FEATURES), dtype=torch.float32)
    inputs[:, 0] = torch.arange(6, dtype=torch.float32)
    targets = torch.arange(6, dtype=torch.long)
    loader = DataLoader(TensorDataset(inputs, targets), batch_size=3)

    result = evaluate_pytorch_model(
        FixedProbabilityModel(), loader, classes=[f"class-{index}" for index in range(6)], model_name=model_name
    )

    assert result["model_name"] == expected_name


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
    assert results["metadata"]["training_data_hash"] == results["dataset_hash"]
    assert results["metadata"]["dataset_lineage"]["split_identity"] == results["dataset_lineage"]["split_identity"]
    assert set(("training_metrics", "validation_metrics", "test_metrics")) <= set(results["evaluation_report"])
    assert len(results["history"]["train_loss"]) == 5


def test_pytorch_inference_engine(sample_data, tmp_artifact_paths, unqualified_bundle_factory):
    X, y = sample_data
    train_pytorch_model(
        model_config=PyTorchModelConfig(input_dim=N_FEATURES, hidden_dims=[32, 16], output_dim=6),
        training_config=TrainingConfig(epochs=3, batch_size=32),
        paths=tmp_artifact_paths,
        X=X,
        y=y,
    )

    from model.artifacts.bundle import ArtifactBundleError

    engine = PyTorchInferenceEngine(paths=tmp_artifact_paths)
    with pytest.raises(ArtifactBundleError, match="registry-pinned bundle manifest hash"):
        PyTorchInferenceEngine(paths=tmp_artifact_paths).load_artifacts()
    bundle_dir, bundle_hash = unqualified_bundle_factory(
        "PyTorch_MLP",
        {
            "weights": tmp_artifact_paths.model_weights,
            "scaler": tmp_artifact_paths.scaler_path,
            "metadata": tmp_artifact_paths.metadata_path,
        },
        bundle_id="mlp-inference-test",
    )
    engine.load_artifacts(
        bundle_dir=bundle_dir,
        expected_bundle_hash=bundle_hash,
        version_id="test-mlp-inference",
        require_serving_qualified=False,
    )
    assert engine.is_loaded

    single_x = X[:1]
    res = engine.predict(single_x)
    assert res["model_used"] == "PyTorch_FinancialMLP"
    assert res["primary"] in engine.TARGET_CLASSES
    assert len(res["confidence_scores"]) == 6
