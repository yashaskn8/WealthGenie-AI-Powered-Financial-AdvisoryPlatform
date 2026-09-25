"""Explicitly bootstrap trusted serving bundles into shared model state.

This controlled release operation is never called during application startup.
It verifies checked-in external bundle anchors, stores the complete artifacts
through the selected ArtifactStore, then atomically establishes initial active
records without replacing an existing active model.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Mapping

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from model.registry.mongo_registry_store import MongoModelRegistry  # noqa: E402
from scripts.verify_serving_artifacts import verify_trusted_serving_bundles  # noqa: E402
from store_factory import get_artifact_store_for_registry, get_model_registry  # noqa: E402


class TrustedBundleRegistrationError(RuntimeError):
    """A verified serving bundle cannot be safely registered or activated."""


def register_verified_bundles(
    registry: Any,
    verified_bundles: Mapping[str, Mapping[str, Any]],
    artifact_store: Any | None = None,
) -> dict[str, str]:
    """Idempotently activate only complete bundles returned by the verifier."""
    expected = {"RandomForest", "PyTorch_MLP", "FT_Transformer"}
    if set(verified_bundles) != expected:
        raise TrustedBundleRegistrationError("verified bundle set does not cover all serving architectures")
    if artifact_store is None:
        raise TrustedBundleRegistrationError("an ArtifactStore is required; local bundle paths are not registry identity")
    bootstrap = getattr(registry, "bootstrap_verified_bundles", None)
    if not callable(bootstrap):
        raise TrustedBundleRegistrationError("selected registry does not support atomic trusted-bundle bootstrap")
    records = bootstrap(dict(verified_bundles), artifact_store)
    return {architecture: record["version_id"] for architecture, record in records.items()}


def register_trusted_bundles(root: Path = ML_SERVICE_ROOT) -> dict[str, str]:
    """Verify all local trust anchors before initializing/writing Mongo state."""
    if os.environ.get("WEALTHGENIE_PHASE3_BOOTSTRAP", "").strip().lower() not in {"1", "true", "yes"}:
        raise TrustedBundleRegistrationError("set WEALTHGENIE_PHASE3_BOOTSTRAP=1 for this explicit release operation")

    verified = verify_trusted_serving_bundles(root)
    registry = get_model_registry()
    try:
        if os.environ.get("ENVIRONMENT", "local").strip().lower() in {"production", "prod"} and not isinstance(registry, MongoModelRegistry):
            raise TrustedBundleRegistrationError("production bootstrap requires MongoModelRegistry and shared GridFS")
        artifact_store = get_artifact_store_for_registry(registry)
        return register_verified_bundles(registry, verified, artifact_store)
    finally:
        registry.close()


def main() -> int:
    try:
        registered = register_trusted_bundles()
    except Exception as exc:
        print(f"Trusted serving bundle registration failed ({type(exc).__name__}): {exc}", file=sys.stderr)
        return 1
    for architecture, version_id in registered.items():
        print(f"Verified {architecture} serving bundle registered as active version {version_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
