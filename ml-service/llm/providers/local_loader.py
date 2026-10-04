"""
WealthGenie Open-Weight LLM Platform - Local Model Loader
Handles inspection, device binding, quantization setup, and local model weight initialization.
"""

import logging
from pathlib import Path
from typing import Optional
from llm.config import auto_detect_device
from llm.providers.base import BaseLLMProvider
from llm.providers.huggingface_provider import HuggingFaceLLMProvider
from llm.providers.mock_provider import MockLLMProvider

logger = logging.getLogger("wealthgenie.llm.local_loader")


class LocalLLMLoader:
    """Utility class to inspect local model artifacts and instantiate hardware-optimized LLM providers."""

    @staticmethod
    def load_provider(
        provider_type: str = "mock",
        model_id: str = "Qwen/Qwen2.5-0.5B-Instruct",
        device: str = "auto",
        quantization: str = "float16",
        cache_dir: Optional[Path] = None,
    ) -> BaseLLMProvider:
        """Instantiates and returns the requested LLM provider backend."""
        target_device = auto_detect_device() if device == "auto" else device

        logger.info(f"LocalLLMLoader initializing provider '{provider_type}' on device '{target_device}'...")

        if provider_type in {"huggingface", "local"}:
            return HuggingFaceLLMProvider(
                model_id=model_id,
                device=target_device,
                quantization=quantization,
                cache_dir=cache_dir,
                load_weights=True,
            )
        if provider_type == "api":
            raise ValueError("API LLM provider is unavailable until an authenticated transport is configured.")
        if provider_type == "mock":
            return MockLLMProvider(model_name=model_id)
        raise ValueError(
            f"Unknown LLM provider type '{provider_type}'. "
            "Valid providers are: mock, huggingface, local."
        )
