"""
WealthGenie ML Microservice - FT-Transformer Architecture Module
Feature Tokenizer Transformer (FT-Transformer) for state-of-the-art tabular deep learning.
Reference: Gorishniy et al., "Revisiting Deep Learning Models for Tabular Data" (NeurIPS 2021).
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from pydantic import BaseModel, Field


class ReGLU(nn.Module):
    """
    ReGLU Activation Module (Gorishniy et al., NeurIPS 2021).
    Splits input in half along last dimension, GELU-gates first half with second half.
    """
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        a, b = x.chunk(2, dim=-1)
        return F.gelu(a) * b


class FTTransformerConfig(BaseModel):
    """Configuration hyperparameters for FT-Transformer architecture."""
    input_dim: int = Field(19, description="Number of recommendation-features-4.0.0 inputs")
    d_token: int = Field(32, description="Token embedding dimension")
    n_blocks: int = Field(3, description="Number of Transformer Encoder blocks")
    n_heads: int = Field(4, description="Number of attention heads per block")
    d_ffn_factor: float = Field(2.0, description="FFN hidden dimension multiplier")
    attention_dropout: float = Field(0.1, description="Attention dropout rate")
    ffn_dropout: float = Field(0.1, description="FFN dropout rate")
    residual_dropout: float = Field(0.0, description="Residual connection dropout rate")
    output_dim: int = Field(6, description="Number of target output classes")
    activation: str = Field("gelu", description="FFN activation: 'reglu' or 'gelu'")


class FeatureTokenizer(nn.Module):
    """
    Transforms numerical features X in R^(B x K) into a sequence of token embeddings E in R^(B x K x d).
    Each feature x_i gets its own linear transformation: e_i = x_i * W_i + b_i.
    """

    def __init__(self, num_features: int, d_token: int):
        super(FeatureTokenizer, self).__init__()
        self.num_features = num_features
        self.d_token = d_token

        # Feature-wise weight and bias parameters
        self.weight = nn.Parameter(torch.empty(num_features, d_token))
        self.bias = nn.Parameter(torch.empty(num_features, d_token))
        
        # Initialize parameters
        nn.init.kaiming_uniform_(self.weight, a=1.0)
        nn.init.uniform_(self.bias, -0.1, 0.1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (B, K)
        Returns: (B, K, d_token)
        """
        # x.unsqueeze(-1) shape: (B, K, 1)
        # self.weight shape: (K, d_token)
        # Broadcasting: (B, K, 1) * (K, d_token) -> (B, K, d_token)
        return x.unsqueeze(-1) * self.weight + self.bias


class FTTransformer(nn.Module):
    """
    FT-Transformer Model: Feature Tokenizer + [CLS] token + Transformer Encoder + Linear Head.
    """

    def __init__(self, config: FTTransformerConfig = FTTransformerConfig()):
        super(FTTransformer, self).__init__()
        self.config = config

        # 1. Feature Tokenizer
        self.tokenizer = FeatureTokenizer(config.input_dim, config.d_token)

        # 2. Trainable [CLS] token embedding (1, 1, d_token)
        self.cls_token = nn.Parameter(torch.empty(1, 1, config.d_token))
        nn.init.uniform_(self.cls_token, -0.1, 0.1)

        # 3. Transformer Encoder Blocks
        d_ffn = int(config.d_token * config.d_ffn_factor)
        act_key = config.activation.lower() if isinstance(config.activation, str) else "reglu"

        if act_key == "reglu":
            activation_fn = ReGLU()
            dim_feedforward = d_ffn * 2
        else:
            activation_fn = "gelu"
            dim_feedforward = d_ffn

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=config.d_token,
            nhead=config.n_heads,
            dim_feedforward=dim_feedforward,
            dropout=config.ffn_dropout,
            activation=activation_fn,
            batch_first=True,
            norm_first=True,
        )
        if act_key == "reglu":
            encoder_layer.linear2 = nn.Linear(d_ffn, config.d_token)

        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=config.n_blocks)

        # 4. Final Head on [CLS] token
        self.head = nn.Sequential(
            nn.LayerNorm(config.d_token),
            nn.ReLU(),
            nn.Dropout(config.residual_dropout),
            nn.Linear(config.d_token, config.output_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass returning raw logits (B, output_dim).
        """
        batch_size = x.size(0)

        # Tokenize features -> (B, K, d_token)
        tokens = self.tokenizer(x)

        # Expand [CLS] token -> (B, 1, d_token)
        cls_tokens = self.cls_token.expand(batch_size, -1, -1)

        # Prepend [CLS] token -> (B, K+1, d_token)
        x_tokens = torch.cat([cls_tokens, tokens], dim=1)

        # Pass through Transformer Encoder
        enc_out = self.transformer(x_tokens)

        # Extract [CLS] token output (B, d_token)
        cls_out = enc_out[:, 0, :]

        # Classification Head -> (B, output_dim)
        logits = self.head(cls_out)
        return logits

    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass returning probability distribution matrix (B, output_dim).
        """
        logits = self.forward(x)
        return F.softmax(logits, dim=-1)
