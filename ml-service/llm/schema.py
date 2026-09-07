"""
WealthGenie Open-Weight LLM Platform - Data Models & Schemas
Defines structured request/response objects, metadata, quantization enums, and provider types.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class LLMProviderType(str, Enum):
    HUGGINGFACE = "huggingface"
    API = "api"
    LOCAL = "local"
    MOCK = "mock"


class QuantizationType(str, Enum):
    FP32 = "float32"
    FP16 = "float16"
    BF16 = "bfloat16"
    INT8 = "int8"
    INT4 = "int4"


class LLMMetadata(BaseModel):
    """Metadata describing a loaded LLM instance."""
    model_config = ConfigDict(protected_namespaces=())
    model_name: str = Field(..., description="Name or identifier of the LLM")
    provider: LLMProviderType = Field(..., description="Provider type backend")
    quantization: QuantizationType = Field(QuantizationType.FP16, description="Quantization mode")
    device: str = Field("cpu", description="Execution device (cpu, cuda, mps)")
    context_window: int = Field(2048, description="Maximum context length in tokens")
    version: str = Field("1.0.0", description="Model or adapter version string")
    loaded_at: str = Field(..., description="Timestamp when model was loaded into memory")
    parameters_count: Optional[str] = Field("Unknown", description="Model parameter scale (e.g. 0.5B, 1.1B, 7B)")


class LLMGenerateRequest(BaseModel):
    """Request payload for text generation with the LLM platform."""
    prompt: str = Field(..., min_length=1, description="User prompt or context query")
    system_prompt: Optional[str] = Field(
        "You are WealthGenie AI, a certified financial advisor assistant. Provide clear, accurate, and grounded financial advice.",
        description="System prompt instructions",
    )
    max_new_tokens: int = Field(512, ge=1, le=4096, description="Maximum new tokens to generate")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Sampling temperature")
    top_p: float = Field(0.9, ge=0.0, le=1.0, description="Nucleus sampling probability")
    top_k: int = Field(50, ge=0, description="Top-k sampling threshold")
    stop_sequences: Optional[List[str]] = Field(None, description="Stop token sequences")
    stream: bool = Field(False, description="Stream output response tokens")
    tenant_id: str = Field("default", description="Tenant isolation scope")


class LLMGenerateResponse(BaseModel):
    """Structured response payload returned by the LLM platform."""
    model_config = ConfigDict(protected_namespaces=())
    text: str = Field(..., description="Generated completion text")
    finish_reason: str = Field("stop", description="Reason for generation termination (stop, length)")
    prompt_tokens: int = Field(0, description="Estimated prompt token count")
    completion_tokens: int = Field(0, description="Generated completion token count")
    latency_ms: float = Field(0.0, description="Total generation latency in milliseconds")
    model_name: str = Field(..., description="Model identifier used for generation")
    provider: str = Field(..., description="Provider backend used for generation")


class ChatMessage(BaseModel):
    """Represents a single chat turn in a multi-turn conversation."""
    role: str = Field(..., description="Message role (system, user, assistant)")
    content: str = Field(..., description="Message content text")
