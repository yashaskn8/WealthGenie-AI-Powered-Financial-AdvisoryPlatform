"""Helpers for truthful, reproducible model-training lineage."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Iterable


_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")


def resolve_training_git_sha(repo_root: Path, source_paths: Iterable[str]) -> str | None:
    """Return HEAD only when the declared training sources match that commit.

    Artifacts can still be produced in a dirty checkout for experimentation,
    but they are not serving-qualified. Unrelated dirty files do not affect the
    result; the caller must enumerate every source that can change training.
    """
    root = Path(repo_root).resolve()
    paths = tuple(sorted(set(source_paths)))
    if not paths or any(Path(path).is_absolute() or ".." in Path(path).parts for path in paths):
        return None

    safe_directory = root.as_posix()
    try:
        result = subprocess.run(
            ["git", "-c", f"safe.directory={safe_directory}", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        sha = result.stdout.strip().lower()
        if not _GIT_SHA.fullmatch(sha):
            return None
        dirty = subprocess.run(
            ["git", "-c", f"safe.directory={safe_directory}", "status", "--porcelain", "--", *paths],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if dirty.stdout.strip():
            return None
        return sha
    except (OSError, subprocess.SubprocessError):
        return None


def hash_split_indices(indices: Iterable[int]) -> str:
    """Hash an exact ordered split-index vector using canonical JSON."""
    values = [int(value) for value in indices]
    return hashlib.sha256(
        json.dumps(values, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    ).hexdigest()
