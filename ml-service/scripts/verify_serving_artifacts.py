"""Verify deployment model bundles before any executable artifact is loaded."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Mapping, Any

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from model.artifacts.bundle import ArtifactBundleError, verify_bundle  # noqa: E402


class ArtifactVerificationError(RuntimeError):
    """Raised when a deployment bundle is absent, untrusted, or incompatible."""


ANCHOR_FILENAME = "trusted_bundle_hashes.json"
_BUNDLES = {
    "RandomForest": "random_forest",
    "PyTorch_MLP": "pytorch_mlp",
    "FT_Transformer": "ft_transformer",
}
_SHA256_LENGTH = 64


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _read_trusted_anchors(root: Path) -> dict[str, dict[str, str]]:
    path = root / "model" / "bundles" / ANCHOR_FILENAME
    if path.is_symlink() or not path.is_file():
        raise ArtifactVerificationError("trusted bundle hash anchor file is missing or unsafe")
    try:
        anchors = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactVerificationError("trusted bundle hash anchor file is invalid JSON") from exc
    if not isinstance(anchors, dict) or set(anchors) != {"anchor_schema_version", "bundles", "anchor_sha256"}:
        raise ArtifactVerificationError("trusted bundle hash anchor schema is invalid")
    if anchors["anchor_schema_version"] != 1:
        raise ArtifactVerificationError("unsupported trusted bundle hash anchor schema")
    bundles = anchors["bundles"]
    if not isinstance(bundles, dict) or set(bundles) != set(_BUNDLES):
        raise ArtifactVerificationError("trusted bundle anchors must cover all architectures exactly once")
    digest = hashlib.sha256(_canonical_json({key: anchors[key] for key in ("anchor_schema_version", "bundles")})).hexdigest()
    supplied_digest = anchors["anchor_sha256"]
    if not isinstance(supplied_digest, str) or supplied_digest != digest:
        raise ArtifactVerificationError("trusted bundle hash anchor self-check failed")

    validated: dict[str, dict[str, str]] = {}
    for architecture, record in bundles.items():
        if not isinstance(record, dict) or set(record) != {"bundle_id", "bundle_manifest_sha256"}:
            raise ArtifactVerificationError(f"trusted bundle anchor for {architecture} is malformed")
        bundle_id = record["bundle_id"]
        manifest_hash = record["bundle_manifest_sha256"]
        if not isinstance(bundle_id, str) or not bundle_id.strip():
            raise ArtifactVerificationError(f"trusted bundle anchor for {architecture} has no bundle ID")
        if not isinstance(manifest_hash, str) or len(manifest_hash) != _SHA256_LENGTH or any(c not in "0123456789abcdef" for c in manifest_hash):
            raise ArtifactVerificationError(f"trusted bundle anchor for {architecture} has an invalid SHA-256")
        validated[architecture] = record
    return validated


def verify_serving_artifacts(
    root: Path = ML_SERVICE_ROOT,
    *,
    expected_bundle_hashes: Mapping[str, str] | None = None,
) -> list[str]:
    """Verify manifests and all bundle bytes; intentionally do not deserialize.

    The default trust root is a separately committed, strict anchor file under
    ``model/``. Tests may provide explicit expected hashes, but an empty or
    incomplete mapping never falls back to the bundle's self-reported hash.
    """
    root = Path(root).resolve()
    if expected_bundle_hashes is None:
        anchors = _read_trusted_anchors(root)
    else:
        if set(expected_bundle_hashes) != set(_BUNDLES):
            raise ArtifactVerificationError("explicit trusted bundle hashes must cover all architectures exactly once")
        anchors = {
            architecture: {
                "bundle_id": "",
                "bundle_manifest_sha256": expected_bundle_hashes[architecture],
            }
            for architecture in _BUNDLES
        }

    verified: list[str] = []
    for architecture, directory in _BUNDLES.items():
        anchor = anchors[architecture]
        expected_hash = anchor["bundle_manifest_sha256"]
        bundle_dir = root / "model" / "bundles" / directory
        try:
            bundle = verify_bundle(bundle_dir, expected_hash, require_serving_qualified=True)
        except (ArtifactBundleError, OSError, ValueError) as exc:
            raise ArtifactVerificationError(f"{architecture} serving bundle verification failed: {exc}") from exc
        if bundle["manifest"]["architecture"] != architecture:
            raise ArtifactVerificationError(f"{architecture} bundle declares a different architecture")
        expected_bundle_id = anchor["bundle_id"]
        if expected_bundle_id and bundle["manifest"]["bundle_id"] != expected_bundle_id:
            raise ArtifactVerificationError(f"{architecture} bundle ID differs from its trusted anchor")
        verified.append(f"model/bundles/{directory}/{bundle['manifest']['bundle_id']}")
    return verified


def main() -> int:
    try:
        bundles = verify_serving_artifacts()
    except ArtifactVerificationError as exc:
        print(f"Serving artifact verification failed: {exc}", file=sys.stderr)
        return 1
    for bundle in bundles:
        print(f"Verified serving bundle: {bundle}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
