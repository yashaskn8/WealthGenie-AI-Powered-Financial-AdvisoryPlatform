"""Canonical model-bundle manifest construction and pre-load verification.

The manifest hash is intended to be anchored by a trusted registry record or a
checked-in baseline manifest.  A bundle's self-reported hashes alone are not a
trust root.  Callers must pass ``expected_manifest_sha256`` before any model
member is deserialized.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Mapping


BUNDLE_SCHEMA_VERSION = 1
MANIFEST_FILENAME = "bundle.manifest.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")

ARCHITECTURE_FILES = {
    "RandomForest": {
        "model": "model.pkl",
        "label_encoder": "label_encoder.pkl",
        "metadata": "metadata.json",
        "evaluation_report": "evaluation_report.json",
    },
    "PyTorch_MLP": {
        "weights": "mlp_model.pt",
        "scaler": "scaler.pkl",
        "metadata": "pytorch_metadata.json",
        "evaluation_report": "evaluation_report.json",
    },
    "FT_Transformer": {
        "weights": "ft_transformer.pt",
        "scaler": "scaler.pkl",
        "metadata": "ft_transformer_metadata.json",
        "evaluation_report": "evaluation_report.json",
    },
}

REQUIRED_FIELDS = {
    "bundle_schema_version",
    "bundle_id",
    "architecture",
    "model_version",
    "feature_schema_version",
    "feature_names",
    "target_classes",
    "training_data_hash",
    "training_code_git_sha",
    "training_timestamp",
    "dataset_lineage",
    "python_version",
    "framework_versions",
    "artifact_files",
    "evaluation_report_id",
    "evaluation_report_sha256",
    "bundle_manifest_sha256",
    "serving_qualified",
}


class ArtifactBundleError(ValueError):
    """A model bundle is incomplete, inconsistent, or fails integrity checks."""


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def canonical_json_bytes(value: Any) -> bytes:
    """Return compact canonical JSON bytes used for manifest trust digests."""
    return _canonical_json(value)


def json_lf_bytes(value: Any) -> bytes:
    """Serialize bundle JSON deterministically with UTF-8 and literal LF bytes.

    These files are hashed before source-control normalization.  Writing the
    encoded bytes (rather than using a platform text stream) keeps the recorded
    member size and digest identical on Windows and POSIX.
    """
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def write_json_lf(path: Path, value: Any) -> None:
    """Write deterministic UTF-8 JSON using LF bytes without newline translation."""
    Path(path).write_bytes(json_lf_bytes(value))


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ArtifactBundleError(f"{field} must be a non-empty string")
    return value


def _require_sha256(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ArtifactBundleError(f"{field} must be a lowercase SHA-256 hex digest")
    return value


def _validate_timestamp(value: Any) -> str:
    timestamp = _require_string(value, "training_timestamp")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ArtifactBundleError("training_timestamp must be ISO-8601") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ArtifactBundleError("training_timestamp must include an explicit timezone")
    return timestamp


def _manifest_payload(manifest: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in manifest.items() if key != "bundle_manifest_sha256"}


def _validate_manifest(manifest: Any) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ArtifactBundleError("bundle manifest must be a JSON object")
    missing = REQUIRED_FIELDS - set(manifest)
    unknown = set(manifest) - REQUIRED_FIELDS
    if missing:
        raise ArtifactBundleError(f"bundle manifest missing fields: {', '.join(sorted(missing))}")
    if unknown:
        raise ArtifactBundleError(f"bundle manifest has unknown fields: {', '.join(sorted(unknown))}")
    if manifest["bundle_schema_version"] != BUNDLE_SCHEMA_VERSION:
        raise ArtifactBundleError("unsupported bundle schema version")
    if not isinstance(manifest["serving_qualified"], bool):
        raise ArtifactBundleError("serving_qualified must be a boolean")

    architecture = _require_string(manifest["architecture"], "architecture")
    if architecture not in ARCHITECTURE_FILES:
        raise ArtifactBundleError(f"unsupported model architecture: {architecture}")
    for field in (
        "bundle_id",
        "model_version",
        "feature_schema_version",
        "python_version",
        "evaluation_report_id",
    ):
        _require_string(manifest[field], field)

    _require_sha256(manifest["training_data_hash"], "training_data_hash")
    _require_sha256(manifest["evaluation_report_sha256"], "evaluation_report_sha256")
    _require_sha256(manifest["bundle_manifest_sha256"], "bundle_manifest_sha256")
    git_sha = manifest["training_code_git_sha"]
    if manifest["serving_qualified"]:
        git_sha = _require_string(git_sha, "training_code_git_sha")
        if not GIT_SHA_RE.fullmatch(git_sha):
            raise ArtifactBundleError("training_code_git_sha must be a concrete 40-character Git SHA")
    elif git_sha is not None and not GIT_SHA_RE.fullmatch(str(git_sha)):
        raise ArtifactBundleError("unqualified training Git SHA must be null or a concrete SHA")
    _validate_timestamp(manifest["training_timestamp"])

    for field in ("feature_names", "target_classes"):
        values = manifest[field]
        if not isinstance(values, list) or not values or any(not isinstance(item, str) or not item for item in values):
            raise ArtifactBundleError(f"{field} must be a non-empty list of strings")
        if len(values) != len(set(values)):
            raise ArtifactBundleError(f"{field} must not contain duplicates")

    lineage = manifest["dataset_lineage"]
    if not isinstance(lineage, dict) or not lineage:
        raise ArtifactBundleError("dataset_lineage must be a non-empty object")
    for field in ("generator", "generation_parameters", "split_identity"):
        if field not in lineage:
            raise ArtifactBundleError(f"dataset_lineage.{field} is required")
    if not isinstance(lineage["generation_parameters"], dict) or not isinstance(lineage["split_identity"], dict):
        raise ArtifactBundleError("dataset_lineage parameters and split identity must be objects")
    for split in ("train_indices_sha256", "validation_indices_sha256", "test_indices_sha256"):
        _require_sha256(lineage["split_identity"].get(split), f"dataset_lineage.split_identity.{split}")

    frameworks = manifest["framework_versions"]
    if not isinstance(frameworks, dict) or not frameworks:
        raise ArtifactBundleError("framework_versions must be a non-empty object")
    for key, value in frameworks.items():
        _require_string(key, "framework_versions key")
        _require_string(value, f"framework_versions.{key}")

    files = manifest["artifact_files"]
    if not isinstance(files, list):
        raise ArtifactBundleError("artifact_files must be a list")
    expected_roles = ARCHITECTURE_FILES[architecture]
    if len(files) != len(expected_roles):
        raise ArtifactBundleError("artifact_files does not contain the exact architecture bundle members")
    seen_roles: set[str] = set()
    seen_names: set[str] = set()
    for entry in files:
        if not isinstance(entry, dict) or set(entry) != {"role", "filename", "sha256", "size_bytes"}:
            raise ArtifactBundleError("each artifact_files entry must contain role, filename, sha256, size_bytes only")
        role = _require_string(entry["role"], "artifact role")
        filename = _require_string(entry["filename"], "artifact filename")
        path = PurePosixPath(filename)
        if path.is_absolute() or len(path.parts) != 1 or path.name in {".", ".."}:
            raise ArtifactBundleError("artifact filenames must be safe bundle-local basenames")
        if role in seen_roles or filename in seen_names:
            raise ArtifactBundleError("artifact roles and filenames must be unique")
        if role not in expected_roles or filename != expected_roles[role]:
            raise ArtifactBundleError(f"unexpected {architecture} bundle member: {role}/{filename}")
        seen_roles.add(role)
        seen_names.add(filename)
        _require_sha256(entry["sha256"], f"artifact_files.{role}.sha256")
        if not isinstance(entry["size_bytes"], int) or isinstance(entry["size_bytes"], bool) or entry["size_bytes"] <= 0:
            raise ArtifactBundleError(f"artifact_files.{role}.size_bytes must be a positive integer")
    if seen_roles != set(expected_roles):
        raise ArtifactBundleError("bundle is missing one or more required architecture roles")

    return manifest


def build_bundle_manifest(
    bundle_dir: Path,
    *,
    bundle_id: str,
    architecture: str,
    model_version: str,
    feature_schema_version: str,
    feature_names: list[str],
    target_classes: list[str],
    training_data_hash: str,
    training_code_git_sha: str | None,
    training_timestamp: str,
    dataset_lineage: Mapping[str, Any],
    python_version: str,
    framework_versions: Mapping[str, str],
    evaluation_report_id: str,
    evaluation_report_sha256: str,
    serving_qualified: bool = True,
) -> dict[str, Any]:
    """Build deterministic metadata from canonical architecture member files."""
    root = Path(bundle_dir).resolve(strict=True)
    if architecture not in ARCHITECTURE_FILES:
        raise ArtifactBundleError(f"unsupported model architecture: {architecture}")
    if serving_qualified and not GIT_SHA_RE.fullmatch(str(training_code_git_sha or "")):
        raise ArtifactBundleError("training_code_git_sha must be a concrete 40-character Git SHA")
    if not serving_qualified and training_code_git_sha is not None and not GIT_SHA_RE.fullmatch(training_code_git_sha):
        raise ArtifactBundleError("unqualified training Git SHA must be null or a concrete SHA")
    _require_sha256(training_data_hash, "training_data_hash")
    _require_sha256(evaluation_report_sha256, "evaluation_report_sha256")
    _validate_timestamp(training_timestamp)
    files = []
    for role, filename in sorted(ARCHITECTURE_FILES[architecture].items()):
        artifact_path = root / filename
        if not artifact_path.is_file() or artifact_path.is_symlink():
            raise ArtifactBundleError(f"required bundle member is missing or unsafe: {filename}")
        files.append({
            "role": role,
            "filename": filename,
            "sha256": sha256_file(artifact_path),
            "size_bytes": artifact_path.stat().st_size,
        })
    report_member = root / ARCHITECTURE_FILES[architecture]["evaluation_report"]
    if sha256_file(report_member) != evaluation_report_sha256:
        raise ArtifactBundleError("evaluation report member does not match evaluation_report_sha256")

    manifest = {
        "bundle_schema_version": BUNDLE_SCHEMA_VERSION,
        "bundle_id": bundle_id,
        "architecture": architecture,
        "model_version": model_version,
        "feature_schema_version": feature_schema_version,
        "feature_names": list(feature_names),
        "target_classes": list(target_classes),
        "training_data_hash": training_data_hash,
        "training_code_git_sha": training_code_git_sha,
        "training_timestamp": training_timestamp,
        "dataset_lineage": dict(dataset_lineage),
        "python_version": python_version,
        "framework_versions": dict(framework_versions),
        "artifact_files": files,
        "evaluation_report_id": evaluation_report_id,
        "evaluation_report_sha256": evaluation_report_sha256,
        "bundle_manifest_sha256": "0" * 64,
        "serving_qualified": serving_qualified,
    }
    # Validate the complete schema before deriving its own canonical digest.
    _validate_manifest(manifest)
    _verify_metadata_consistency(manifest, root / ARCHITECTURE_FILES[architecture]["metadata"])
    manifest["bundle_manifest_sha256"] = _sha256_bytes(_canonical_json(_manifest_payload(manifest)))
    return _validate_manifest(manifest)


def verify_bundle(
    bundle_dir: Path,
    expected_manifest_sha256: str,
    *,
    require_serving_qualified: bool = True,
) -> dict[str, Any]:
    """Verify manifest and every member; perform no deserialization here.

    ``expected_manifest_sha256`` is mandatory and must come from a trust root
    outside the bundle itself (for example the registry's immutable bundle
    record).  The returned map contains verified member paths only.
    """
    expected = _require_sha256(expected_manifest_sha256, "expected_manifest_sha256")
    root = Path(bundle_dir).resolve(strict=True)
    manifest_path = root / MANIFEST_FILENAME
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ArtifactBundleError("trusted bundle manifest is missing or unsafe")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactBundleError("bundle manifest is not valid UTF-8 JSON") from exc
    manifest = _validate_manifest(manifest)
    if require_serving_qualified and not manifest["serving_qualified"]:
        raise ArtifactBundleError("artifact bundle is integrity-verified but not serving-qualified")

    computed_manifest_hash = _sha256_bytes(_canonical_json(_manifest_payload(manifest)))
    if computed_manifest_hash != manifest["bundle_manifest_sha256"]:
        raise ArtifactBundleError("bundle manifest self-hash mismatch")
    if computed_manifest_hash != expected:
        raise ArtifactBundleError("bundle manifest does not match the trusted expected hash")

    verified_paths: dict[str, Path] = {}
    for entry in manifest["artifact_files"]:
        path = root / entry["filename"]
        if path.is_symlink() or not path.is_file():
            raise ArtifactBundleError(f"bundle member is missing or unsafe: {entry['filename']}")
        resolved = path.resolve(strict=True)
        if resolved.parent != root:
            raise ArtifactBundleError(f"bundle member escapes bundle root: {entry['filename']}")
        if path.stat().st_size != entry["size_bytes"]:
            raise ArtifactBundleError(f"bundle member size mismatch: {entry['filename']}")
        if sha256_file(path) != entry["sha256"]:
            raise ArtifactBundleError(f"bundle member hash mismatch: {entry['filename']}")
        verified_paths[entry["role"]] = resolved

    directory_entries = list(root.iterdir())
    if any(path.is_dir() or path.is_symlink() for path in directory_entries):
        raise ArtifactBundleError("bundle directory may contain only regular manifested files")
    actual_members = {path.name for path in directory_entries if path.is_file()}
    expected_members = {entry["filename"] for entry in manifest["artifact_files"]} | {MANIFEST_FILENAME}
    if actual_members != expected_members:
        raise ArtifactBundleError("bundle directory contains missing or unmanifested files")

    report_path = verified_paths["evaluation_report"]
    if sha256_file(report_path) != manifest["evaluation_report_sha256"]:
        raise ArtifactBundleError("evaluation report hash differs from bundle manifest")

    _verify_metadata_consistency(manifest, verified_paths["metadata"])
    return {"manifest": manifest, "manifest_sha256": computed_manifest_hash, "members": verified_paths}


def materialize_verified_bundle(verified_bundle: Mapping[str, Any]) -> Path:
    """Copy already-verified members into a private immutable temp directory.

    The copy is re-hashed while writing so mutation of the source directory
    between verification and deserialization cannot substitute executable
    pickle bytes. Callers must only deserialize from the returned directory.
    """
    manifest = _validate_manifest(dict(verified_bundle.get("manifest", {})))
    source_members = verified_bundle.get("members")
    if not isinstance(source_members, Mapping):
        raise ArtifactBundleError("verified bundle members are missing")
    expected_hash = verified_bundle.get("manifest_sha256")
    if expected_hash != _sha256_bytes(_canonical_json(_manifest_payload(manifest))):
        raise ArtifactBundleError("verified bundle manifest identity changed")

    target_root = Path(tempfile.mkdtemp(prefix="wealthgenie-verified-bundle-")).resolve(strict=True)
    try:
        for entry in manifest["artifact_files"]:
            source = Path(source_members.get(entry["role"], ""))
            if not source.is_file() or source.is_symlink():
                raise ArtifactBundleError(f"verified bundle member disappeared: {entry['role']}")
            target = target_root / entry["filename"]
            digest = hashlib.sha256()
            size = 0
            with source.open("rb") as src, target.open("xb") as dst:
                while block := src.read(1024 * 1024):
                    digest.update(block)
                    size += len(block)
                    dst.write(block)
            if digest.hexdigest() != entry["sha256"] or size != entry["size_bytes"]:
                raise ArtifactBundleError(f"bundle member changed during verified copy: {entry['role']}")
        manifest_path = target_root / MANIFEST_FILENAME
        write_json_lf(manifest_path, manifest)
        manifest_path.chmod(0o400)
        for path in target_root.iterdir():
            if path != manifest_path:
                path.chmod(0o400)
        target_root.chmod(0o500)
        return target_root
    except Exception:
        shutil.rmtree(target_root, ignore_errors=True)
        raise


def _verify_metadata_consistency(manifest: Mapping[str, Any], metadata_path: Path) -> None:
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ArtifactBundleError("bundle metadata member is not valid UTF-8 JSON") from exc
    if not isinstance(metadata, dict):
        raise ArtifactBundleError("bundle metadata member must be a JSON object")

    model_version = metadata.get("model_version", metadata.get("version"))
    if model_version != manifest["model_version"]:
        raise ArtifactBundleError("bundle model version differs from its metadata member")
    if metadata.get("feature_schema_version") != manifest["feature_schema_version"]:
        raise ArtifactBundleError("bundle feature schema differs from its metadata member")
    if metadata.get("feature_names") != manifest["feature_names"]:
        raise ArtifactBundleError("bundle feature order differs from its metadata member")

    metadata_classes = metadata.get("target_classes")
    if metadata_classes is None and isinstance(metadata.get("dataset_lineage"), dict):
        metadata_classes = metadata["dataset_lineage"].get("target_classes")
    if metadata_classes != manifest["target_classes"]:
        raise ArtifactBundleError("bundle target class mapping differs from its metadata member")

    metadata_data_hash = metadata.get("training_data_hash")
    if metadata_data_hash != manifest["training_data_hash"]:
        raise ArtifactBundleError("bundle training data hash differs from its metadata member")
    metadata_git_sha = metadata.get("training_code_git_sha", metadata.get("git_commit_hash"))
    if metadata_git_sha != manifest["training_code_git_sha"]:
        raise ArtifactBundleError("bundle training Git SHA is missing or inconsistent")
    if manifest["serving_qualified"] and not GIT_SHA_RE.fullmatch(str(metadata_git_sha or "")):
        raise ArtifactBundleError("serving-qualified bundle has no concrete training Git SHA")
    metadata_timestamp = metadata.get("training_timestamp", metadata.get("trained_at"))
    if metadata_timestamp != manifest["training_timestamp"]:
        raise ArtifactBundleError("bundle training timestamp differs from its metadata member")

    metadata_lineage = metadata.get("dataset_lineage")
    if metadata_lineage != manifest["dataset_lineage"]:
        raise ArtifactBundleError("bundle dataset lineage differs from its metadata member")
