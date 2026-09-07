"""
WealthGenie Open-Weight LLM Platform - Rate Limiter
Implements sliding-window token bucket rate limiter for LLM generation requests per tenant.
"""

import logging
import time
from typing import Dict

logger = logging.getLogger("wealthgenie.llm.ops.rate_limiter")


class TokenBucketRateLimiter:
    """
    Per-tenant token bucket rate limiter.
    Each tenant gets `max_tokens` capacity that refills at `refill_rate_per_second`.
    """

    def __init__(
        self,
        max_tokens: int = 100,
        refill_rate_per_second: float = 10.0,
    ):
        self.max_tokens = max_tokens
        self.refill_rate = refill_rate_per_second
        self._buckets: Dict[str, Dict[str, float]] = {}

    def _get_or_create_bucket(self, tenant_id: str) -> Dict[str, float]:
        if tenant_id not in self._buckets:
            self._buckets[tenant_id] = {
                "tokens": float(self.max_tokens),
                "last_refill": time.monotonic(),
            }
        return self._buckets[tenant_id]

    def _refill(self, bucket: Dict[str, float]) -> None:
        now = time.monotonic()
        elapsed = now - bucket["last_refill"]
        refill_amount = elapsed * self.refill_rate
        bucket["tokens"] = min(float(self.max_tokens), bucket["tokens"] + refill_amount)
        bucket["last_refill"] = now

    def allow_request(self, tenant_id: str = "default", cost: int = 1) -> bool:
        """
        Returns True if the request is allowed under the rate limit.
        Deducts `cost` tokens from the tenant's bucket.
        """
        bucket = self._get_or_create_bucket(tenant_id)
        self._refill(bucket)

        if bucket["tokens"] >= cost:
            bucket["tokens"] -= cost
            return True

        logger.warning(f"Rate limit exceeded for tenant '{tenant_id}'. Available: {bucket['tokens']:.1f}, required: {cost}")
        return False

    def get_remaining(self, tenant_id: str = "default") -> float:
        """Returns remaining token capacity for a tenant."""
        bucket = self._get_or_create_bucket(tenant_id)
        self._refill(bucket)
        return round(bucket["tokens"], 2)

    def get_status(self) -> Dict[str, Dict[str, float]]:
        """Returns current bucket status for all tenants."""
        status = {}
        for tid, bucket in self._buckets.items():
            self._refill(bucket)
            status[tid] = {
                "remaining_tokens": round(bucket["tokens"], 2),
                "max_tokens": self.max_tokens,
                "refill_rate_per_second": self.refill_rate,
            }
        return status


# Module-level singleton
llm_rate_limiter = TokenBucketRateLimiter()
