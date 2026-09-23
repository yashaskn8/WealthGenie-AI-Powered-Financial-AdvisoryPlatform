"""Fail-closed validation for sharded checkpoint indexes before Transformers loads them."""

import json
import os
import stat
from pathlib import Path, PureWindowsPath

MAX_CHECKPOINT_INDEX_BYTES = 16 * 1024 * 1024


def _inside(base: Path, candidate: Path) -> bool:
    try:
        return os.path.commonpath((str(base), str(candidate))) == str(base)
    except ValueError:
        return False


def _is_huggingface_blob_symlink(root: Path, candidate: Path) -> bool:
    """Permit only file links from a Hub snapshot into its sibling blob store."""
    if not candidate.is_symlink():
        return True
    expected_blob_dir = root.parent.parent / "blobs" if (
        root.parent.name == "snapshots" and root.parent.parent.name.startswith("models--")
    ) else None
    try:
        target = candidate.resolve(strict=True)
        blob_dir = expected_blob_dir.resolve(strict=True) if expected_blob_dir else None
    except OSError as exc:
        raise ValueError("Checkpoint symlink target cannot be verified") from exc
    if blob_dir is None or not _inside(blob_dir, target):
        raise ValueError("Checkpoint symlink does not target the Hugging Face repository blob store")
    return True


def _validate_shard_name(root: Path, shard_name: object) -> Path:
    if not isinstance(shard_name, str) or not shard_name or "\x00" in shard_name:
        raise ValueError("Checkpoint index contains an invalid shard path")
    if "\\" in shard_name or PureWindowsPath(shard_name).drive or PureWindowsPath(shard_name).is_absolute():
        raise ValueError("Checkpoint index contains a non-portable or absolute shard path")
    if os.path.isabs(shard_name):
        raise ValueError("Checkpoint index contains an absolute shard path")

    normalized = os.path.normpath(shard_name)
    candidate = Path(os.path.abspath(os.path.join(root, normalized)))
    if not _inside(root, candidate):
        raise ValueError("Checkpoint index shard path escapes the checkpoint directory")

    parts = Path(normalized).parts
    for index, _component in enumerate(parts[:-1]):
        parent = root.joinpath(*parts[:index + 1])
        if parent.is_symlink():
            raise ValueError("Checkpoint index shard path traverses a symlinked directory")

    if candidate.exists() or candidate.is_symlink():
        try:
            metadata = candidate.stat()
        except OSError as exc:
            raise ValueError("Checkpoint shard cannot be inspected safely") from exc
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("Checkpoint shard is not a regular file")

        # Hugging Face Hub snapshots intentionally symlink individual files to the
        # repository's blob store. Permit only that known file-level cache layout.
        _is_huggingface_blob_symlink(root, candidate)

    return candidate


def validate_checkpoint_shard_indexes(model_directory: str | Path) -> None:
    """Reject traversal and special-file shard references before model loading."""
    root = Path(model_directory).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Model checkpoint path must be a directory")

    for index_path in sorted(root.rglob("*.index.json")):
        if index_path.is_symlink():
            _is_huggingface_blob_symlink(root, index_path)
        try:
            index_metadata = index_path.stat()
        except OSError as exc:
            raise ValueError("Checkpoint index cannot be inspected safely") from exc
        if not stat.S_ISREG(index_metadata.st_mode) or index_metadata.st_size > MAX_CHECKPOINT_INDEX_BYTES:
            raise ValueError("Checkpoint index is not a bounded regular file")

        try:
            with index_path.open("r", encoding="utf-8") as index_file:
                document = json.load(index_file)
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("Checkpoint index is malformed or unreadable") from exc

        weight_map = document.get("weight_map") if isinstance(document, dict) else None
        if not isinstance(weight_map, dict):
            raise ValueError("Checkpoint index is missing its weight map")
        for shard_name in weight_map.values():
            _validate_shard_name(root, shard_name)
