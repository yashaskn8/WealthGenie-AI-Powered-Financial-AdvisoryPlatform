"""
WealthGenie ML Microservice - Neural Network Architecture Module
Configurable Multi-Layer Perceptron (MLP) for investment suitability classification.
"""

from typing import List
import torch
import torch.nn as nn
import torch.nn.functional as F

from model.config import PyTorchModelConfig


class FinancialMLP(nn.Module):
    """
    Production-grade Multi-Layer Perceptron (MLP) for investor suitability classification.
    
    Architecture Sequence:
        Input Layer -> [Linear -> BatchNorm1d -> Activation -> Dropout]*N -> Linear Output
    """

    def __init__(self, config: PyTorchModelConfig):
        super(FinancialMLP, self).__init__()
        self.config = config

        layers: List[nn.Module] = []
        in_dim = config.input_dim

        # Choose activation function
        if config.activation.lower() == "gelu":
            act_cls = nn.GELU
        elif config.activation.lower() == "leaky_relu":
            act_cls = nn.LeakyReLU
        else:
            act_cls = nn.ReLU

        # Build hidden layer sequence dynamically
        for hidden_dim in config.hidden_dims:
            layers.append(nn.Linear(in_dim, hidden_dim))
            if config.use_batch_norm:
                layers.append(nn.BatchNorm1d(hidden_dim))
            layers.append(act_cls())
            if config.dropout_rate > 0.0:
                layers.append(nn.Dropout(p=config.dropout_rate))
            in_dim = hidden_dim

        # Final classification head
        layers.append(nn.Linear(in_dim, config.output_dim))

        self.network = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass returning raw logits.
        Shape: (batch_size, output_dim)
        """
        return self.network(x)

    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass returning normalized class probability distribution via Softmax.
        Shape: (batch_size, output_dim)
        """
        logits = self.forward(x)
        return F.softmax(logits, dim=-1)

    def get_feature_importance_hook_compatible(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass signature for Captum / IntegratedGradients compatibility.
        """
        return self.predict_proba(x)
