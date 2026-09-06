"""
WealthGenie ML Microservice - FT-Transformer Test Suite
Tests FeatureTokenizer, FTTransformer forward pass, logits shape, probability distribution, and training pipeline.
"""

import pytest
import torch
import numpy as np

from model.architecture.ft_transformer import FTTransformer, FTTransformerConfig, FeatureTokenizer
from model.training.train_pytorch import train_ft_transformer_model
from model.data.preprocessing import prepare_synthetic_training_data
from model.config import TrainingConfig
from model.data.feature_engineering import FEATURE_NAMES

N_FEATURES = len(FEATURE_NAMES)


def test_feature_tokenizer():
    tokenizer = FeatureTokenizer(num_features=N_FEATURES, d_token=32)
    x = torch.randn(8, N_FEATURES)
    tokens = tokenizer(x)
    assert tokens.shape == (8, N_FEATURES, 32)


def test_ft_transformer_forward_and_predict_proba():
    config = FTTransformerConfig(input_dim=N_FEATURES, d_token=32, n_blocks=2, n_heads=4, output_dim=6)
    model = FTTransformer(config)

    x = torch.randn(4, N_FEATURES)
    logits = model(x)
    assert logits.shape == (4, 6)

    probs = model.predict_proba(x)
    assert probs.shape == (4, 6)
    assert torch.allclose(probs.sum(dim=1), torch.ones(4), atol=1e-4)


def test_train_ft_transformer_model(tmp_path):
    X, y = prepare_synthetic_training_data(num_samples=600, seed=42)
    config = FTTransformerConfig(input_dim=N_FEATURES, d_token=16, n_blocks=1, n_heads=2, output_dim=6)
    t_config = TrainingConfig(epochs=2, batch_size=32)

    weights_file = tmp_path / "ft_transformer.pt"
    scaler_file = tmp_path / "scaler.pkl"

    res = train_ft_transformer_model(
        config=config,
        training_config=t_config,
        save_path=weights_file,
        scaler_path=scaler_file,
        X=X,
        y=y,
    )

    assert weights_file.exists()
    assert scaler_file.exists()
    assert "metrics" in res
