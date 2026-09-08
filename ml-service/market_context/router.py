"""Authenticated internal route for shadow-only market-context observations."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from security import verify_api_key

from . import FEATURE_SCHEMA_VERSION
from .inference import infer_shadow_context, unavailable_shadow


class MarketContextShadowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    feature_schema_version: Literal[FEATURE_SCHEMA_VERSION] = Field(alias="featureSchemaVersion")
    dataset: dict[str, Any]


market_context_router = APIRouter(
    prefix="/market-context",
    tags=["market-context-shadow"],
    dependencies=[Depends(verify_api_key)],
)


def _registry_path() -> Path:
    configured = os.environ.get("MARKET_CONTEXT_SHADOW_REGISTRY_PATH", "").strip()
    return Path(configured) if configured else Path(__file__).parent / "artifacts" / "registry.json"


@market_context_router.post("/shadow")
def observe_market_context_shadow(request: MarketContextShadowRequest) -> dict[str, Any]:
    """Observe a numeric HMM state; this route has no allocation mutation path."""
    try:
        return infer_shadow_context(request.dataset, _registry_path())
    except Exception as exc:
        reason = str(exc) if str(exc).startswith(("MODEL_", "MARKET_", "INVALID_", "NON_FINITE")) else "MODEL_SHADOW_INFERENCE_FAILED"
        return unavailable_shadow(reason)
