"""Repackage existing serving bundles with canonical LF JSON; never trains models."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ML_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(ML_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_SERVICE_ROOT))

from model.artifacts.bundle import (  # noqa: E402
    ARCHITECTURE_FILES,
    MANIFEST_FILENAME,
    ArtifactBundleError,
    build_bundle_manifest,
    canonical_json_bytes,
    json_lf_bytes,
    sha256_file,
    verify_bundle,
    write_json_lf,
)
from scripts.verify_serving_artifacts import verify_serving_artifacts  # noqa: E402


BUNDLE_DIRECTORIES = {
    "RandomForest": "random_forest",
    "PyTorch_MLP": "pytorch_mlp",
    "FT_Transformer": "ft_transformer",
}
ANCHOR_FILENAME = "trusted_bundle_hashes.json"


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _load_trusted_anchor(bundle_root: Path) -> dict[str, dict[str, str]]:
    path = bundle_root / ANCHOR_FILENAME
    try:
        anchor = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactBundleError("existing trusted bundle anchor cannot be read") from exc
    if not isinstance(anchor, dict) or set(anchor) != {"anchor_schema_version", "bundles", "anchor_sha256"}:
        raise ArtifactBundleError("existing trusted bundle anchor has an invalid schema")
    if anchor["anchor_schema_version"] != 1 or set(anchor["bundles"] or {}) != set(BUNDLE_DIRECTORIES):
        raise ArtifactBundleError("existing trusted bundle anchor does not cover supported architectures")
    payload = {key: anchor[key] for key in ("anchor_schema_version", "bundles")}
    if anchor["anchor_sha256"] != _sha256_bytes(canonical_json_bytes(payload)):
        raise ArtifactBundleError("existing trusted bundle anchor hash is invalid")
    return anchor["bundles"]


def _read_canonical_source_json(path: Path) -> tuple[Any, bytes]:
    raw = path.read_bytes()
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactBundleError(f"bundle JSON is not valid UTF-8 JSON: {path.name}") from exc
    lf = json_lf_bytes(value)
    canonical_forms = (lf, lf[:-1], lf.replace(b"\n", b"\r\n"), lf[:-1].replace(b"\n", b"\r\n"))
    if raw not in canonical_forms:
        raise ArtifactBundleError(f"bundle JSON is not in the expected deterministic serialization: {path.name}")
    return value, raw


def _legacy_member_bytes(path: Path, entry: dict[str, Any]) -> bytes:
    """Verify old pre-normalization member digests while accepting CRLF->LF checkout."""
    if path.suffix.lower() != ".json":
        data = path.read_bytes()
        candidates = (data,)
    else:
        value, raw = _read_canonical_source_json(path)
        lf = json_lf_bytes(value)
        candidates = (raw, lf, lf[:-1], lf.replace(b"\n", b"\r\n"), lf[:-1].replace(b"\n", b"\r\n"))
    for candidate in candidates:
        if len(candidate) == entry["size_bytes"] and _sha256_bytes(candidate) == entry["sha256"]:
            return candidate
    raise ArtifactBundleError(f"source member does not match its old trusted hash/size: {entry['filename']}")


def _stage_existing_bundle(
    source: Path,
    legacy_stage: Path,
    normalized_stage: Path,
    architecture: str,
    trusted: dict[str, str],
) -> dict[str, Any]:
    source_manifest_path = source / MANIFEST_FILENAME
    manifest, _ = _read_canonical_source_json(source_manifest_path)
    if manifest.get("architecture") != architecture:
        raise ArtifactBundleError(f"bundle directory and architecture disagree: {architecture}")
    if manifest.get("bundle_id") != trusted.get("bundle_id"):
        raise ArtifactBundleError(f"{architecture} bundle ID differs from its trusted anchor")
    expected_manifest_hash = trusted.get("bundle_manifest_sha256")
    payload = {key: value for key, value in manifest.items() if key != "bundle_manifest_sha256"}
    if manifest.get("bundle_manifest_sha256") != expected_manifest_hash:
        raise ArtifactBundleError(f"{architecture} manifest differs from its trusted anchor")
    if _sha256_bytes(canonical_json_bytes(payload)) != expected_manifest_hash:
        raise ArtifactBundleError(f"{architecture} source manifest self-hash is invalid")

    legacy_stage.mkdir(parents=True)
    normalized_stage.mkdir(parents=True)
    for entry in manifest["artifact_files"]:
        source_member = source / entry["filename"]
        legacy_bytes = _legacy_member_bytes(source_member, entry)
        (legacy_stage / entry["filename"]).write_bytes(legacy_bytes)
    write_json_lf(legacy_stage / MANIFEST_FILENAME, manifest)
    verified = verify_bundle(legacy_stage, expected_manifest_hash, require_serving_qualified=True)

    for entry in manifest["artifact_files"]:
        member = verified["members"][entry["role"]]
        output = normalized_stage / entry["filename"]
        if output.suffix.lower() == ".json":
            write_json_lf(output, json.loads(member.read_text(encoding="utf-8")))
        else:
            output.write_bytes(member.read_bytes())

    normalized_manifest = build_bundle_manifest(
        normalized_stage,
        bundle_id=manifest["bundle_id"],
        architecture=architecture,
        model_version=manifest["model_version"],
        feature_schema_version=manifest["feature_schema_version"],
        feature_names=manifest["feature_names"],
        target_classes=manifest["target_classes"],
        training_data_hash=manifest["training_data_hash"],
        training_code_git_sha=manifest["training_code_git_sha"],
        training_timestamp=manifest["training_timestamp"],
        dataset_lineage=manifest["dataset_lineage"],
        python_version=manifest["python_version"],
        framework_versions=manifest["framework_versions"],
        evaluation_report_id=manifest["evaluation_report_id"],
        evaluation_report_sha256=sha256_file(normalized_stage / ARCHITECTURE_FILES[architecture]["evaluation_report"]),
        serving_qualified=manifest["serving_qualified"],
    )
    write_json_lf(normalized_stage / MANIFEST_FILENAME, normalized_manifest)
    verify_bundle(normalized_stage, normalized_manifest["bundle_manifest_sha256"], require_serving_qualified=True)
    return {
        "bundle_id": normalized_manifest["bundle_id"],
        "old_manifest_sha256": expected_manifest_hash,
        "bundle_manifest_sha256": normalized_manifest["bundle_manifest_sha256"],
        "training_data_hash": normalized_manifest["training_data_hash"],
        "training_code_git_sha": normalized_manifest["training_code_git_sha"],
        "evaluation_report_id": normalized_manifest["evaluation_report_id"],
        "evaluation_report_sha256": normalized_manifest["evaluation_report_sha256"],
    }


def repackage_existing_bundles(bundle_root: Path | None = None) -> dict[str, Any]:
    """Verify current trusted bundles, rewrite only their JSON, then refresh hashes."""
    bundle_root = Path(bundle_root or (ML_SERVICE_ROOT / "model" / "bundles")).resolve()
    trusted = _load_trusted_anchor(bundle_root)
    model_root = bundle_root.parent
    service_root = model_root.parent
    summaries: dict[str, Any] = {}
    publish_files: list[tuple[Path, Path]] = []

    with tempfile.TemporaryDirectory(prefix="wealthgenie-bundle-repackage-", dir=model_root) as temp_name:
        stage_service_root = Path(temp_name)
        stage_bundle_root = stage_service_root / "model" / "bundles"
        stage_bundle_root.mkdir(parents=True)
        for architecture, directory in BUNDLE_DIRECTORIES.items():
            source = bundle_root / directory
            legacy_stage = stage_bundle_root / f".{directory}-legacy-verify"
            normalized_stage = stage_bundle_root / directory
            summaries[architecture] = _stage_existing_bundle(
                source, legacy_stage, normalized_stage, architecture, trusted[architecture]
            )
            for temp_path in sorted(
                normalized_stage.iterdir(),
                key=lambda path: (path.name == MANIFEST_FILENAME, path.name),
            ):
                if temp_path.suffix.lower() == ".json":
                    publish_files.append((temp_path, source / temp_path.name))

        anchor_payload = {
            "anchor_schema_version": 1,
            "bundles": {
                architecture: {
                    "bundle_id": summaries[architecture]["bundle_id"],
                    "bundle_manifest_sha256": summaries[architecture]["bundle_manifest_sha256"],
                }
                for architecture in sorted(BUNDLE_DIRECTORIES)
            },
        }
        anchor = {
            **anchor_payload,
            "anchor_sha256": _sha256_bytes(canonical_json_bytes(anchor_payload)),
        }
        staged_anchor = stage_bundle_root / ANCHOR_FILENAME
        write_json_lf(staged_anchor, anchor)
        verify_serving_artifacts(stage_service_root)
        publish_files.append((staged_anchor, bundle_root / ANCHOR_FILENAME))

        # Replace only JSON files. Executable model/scaler/encoder bytes never
        # leave their existing paths and are never deserialized by this tool.
        for staged, destination in publish_files:
            payload = staged.read_bytes()
            if destination.is_file() and destination.read_bytes() == payload:
                continue
            descriptor, temp_path = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
            try:
                with os.fdopen(descriptor, "wb") as output:
                    output.write(payload)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temp_path, destination)
            except Exception:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass
                raise

    verify_serving_artifacts(service_root)
    return summaries


def main() -> int:
    try:
        result = repackage_existing_bundles()
    except Exception as exc:
        print(f"Serving bundle repackaging failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
