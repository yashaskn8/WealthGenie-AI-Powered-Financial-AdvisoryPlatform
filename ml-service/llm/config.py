"""
WealthGenie Open-Weight LLM Platform - Central Configuration
Defines hyperparameters, default models, device selection, quantization preferences, and pathing.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any
from pydantic import BaseModel, ConfigDict, Field
from model.config import BASE_DIR

LLM_DIR = BASE_DIR / "llm"
LLM_STORAGE_DIR = BASE_DIR / "reports" / "llm_store"
LLM_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def auto_detect_device() -> str:
    """Detects available hardware acceleration device (CUDA, MPS, or CPU)."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


class LLMConfig(BaseModel):
    """Centralized configuration for Open-Weight LLM infrastructure."""
    model_config = ConfigDict(protected_namespaces=())
    default_provider: str = Field("huggingface", description="Default active provider: mock, huggingface, api, or local")
    model_id: str = Field("Qwen/Qwen2.5-0.5B-Instruct", description="Default Hugging Face model identifier or local checkpoint path")
    device: str = Field(default_factory=auto_detect_device, description="Hardware device target: auto, cuda, cpu, mps")
    quantization: str = Field("float16", description="Quantization mode: float32, float16, bfloat16, int8, int4")
    max_new_tokens: int = Field(512, ge=1, le=4096, description="Default max new generation tokens")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Default generation temperature")
    top_p: float = Field(0.9, ge=0.0, le=1.0, description="Default top-p nucleus sampling parameter")
    context_window: int = Field(2048, ge=256, le=32768, description="Maximum sequence context window size")
    cache_dir: Path = Field(LLM_STORAGE_DIR / "cache", description="Local checkpoint and model weights cache path")

    @classmethod
    def from_env(cls) -> "LLMConfig":
        """Loads LLM configuration with environment variable overrides (prefixed with LLM_)."""
        overrides: Dict[str, Any] = {}
        if "LLM_DEFAULT_PROVIDER" in os.environ:
            overrides["default_provider"] = os.environ["LLM_DEFAULT_PROVIDER"]
        if "LLM_MODEL_ID" in os.environ:
            overrides["model_id"] = os.environ["LLM_MODEL_ID"]
        if "LLM_DEVICE" in os.environ:
            overrides["device"] = os.environ["LLM_DEVICE"]
        if "LLM_QUANTIZATION" in os.environ:
            overrides["quantization"] = os.environ["LLM_QUANTIZATION"]
        if "LLM_MAX_NEW_TOKENS" in os.environ:
            overrides["max_new_tokens"] = int(os.environ["LLM_MAX_NEW_TOKENS"])
        if "LLM_TEMPERATURE" in os.environ:
            overrides["temperature"] = float(os.environ["LLM_TEMPERATURE"])
        return cls(**overrides)

    @classmethod
    def from_json(cls, json_path: Path) -> "LLMConfig":
        """Loads configuration from a JSON file."""
        if not json_path.exists():
            raise FileNotFoundError(f"LLM Configuration file '{json_path}' not found.")
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "cache_dir" in data:
            data["cache_dir"] = Path(data["cache_dir"])
        return cls(**data)

    def to_dict(self) -> Dict[str, Any]:
        """Exports configuration dictionary."""
        d = self.model_dump()
        d["cache_dir"] = str(self.cache_dir)
        return d
