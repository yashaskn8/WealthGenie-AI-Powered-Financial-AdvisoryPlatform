"""
WealthGenie Open-Weight LLM Platform - API Provider Abstraction
Executes generation calls against external API LLM endpoints with complete payload normalization.
"""

from typing import Generator

from llm.providers.base import BaseLLMProvider
from llm.schema import (
    LLMGenerateRequest,
    LLMGenerateResponse,
    LLMMetadata,
    LLMProviderType,
    QuantizationType,
)

class APILLMProvider(BaseLLMProvider):
    """Unavailable placeholder until an authenticated API transport is implemented."""

    def __init__(self, api_endpoint: str = "https://api.wealthgenie.ai/v1/chat", model_name: str = "wealthgenie-api-v1"):
        self.api_endpoint = api_endpoint
        self.model_name = model_name

    def generate(self, request: LLMGenerateRequest) -> LLMGenerateResponse:
        del request
        raise RuntimeError("API LLM transport is not configured; no response was generated.")

    def generate_stream(self, request: LLMGenerateRequest) -> Generator[str, None, None]:
        del request
        raise RuntimeError("API LLM transport is not configured; no response was generated.")

    def get_metadata(self) -> LLMMetadata:
        return LLMMetadata(
            model_name=self.model_name,
            provider=LLMProviderType.API,
            quantization=QuantizationType.FP16,
            device="cloud_api",
            context_window=4096,
            version="1.0.0-api",
            loaded_at="unavailable",
            parameters_count="Cloud",
        )

    def is_healthy(self) -> bool:
        return False
