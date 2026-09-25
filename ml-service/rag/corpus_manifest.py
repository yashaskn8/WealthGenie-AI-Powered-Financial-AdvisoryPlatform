"""Strict machine-readable trust root for globally trusted RAG documents."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Mapping
from urllib.parse import urlparse


MANIFEST_FILENAME = "manifest.json"
MANIFEST_SCHEMA = "wealthgenie-rag-corpus-1.0.0"
ALLOWED_AUTHORITIES = {
    "incometax.gov.in",
    "indiabudget.gov.in",
    "sebi.gov.in",
    "rbi.org.in",
    "dicgc.org.in",
    "pib.gov.in",
    "egazette.gov.in",
}
_TOP_LEVEL_FIELDS = {"corpus_schema_version", "documents", "manifest_sha256"}
_DOCUMENT_FIELDS = {
    "document_key",
    "local_filename",
    "content_sha256",
    "official_source_url",
    "supporting_official_sources",
    "publishing_authority",
    "jurisdiction",
    "trust_tier",
    "publication_date",
    "effective_from",
    "effective_to",
    "retrieved_at",
    "document_version",
    "supported_topics",
    "excluded_topics",
    "supersedes",
    "corpus_schema_version",
}


class CorpusManifestError(ValueError):
    """Corpus manifest or its local content cannot establish trusted evidence."""


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def canonical_text_sha256(path: Path) -> str:
    """Hash normalized UTF-8 text, matching DocumentLoader's newline behavior."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise CorpusManifestError(f"trusted corpus text cannot be read as UTF-8: {path.name}") from exc
    return canonical_text_sha256_from_text(text)


def canonical_text_sha256_from_text(text: str) -> str:
    """Hash UTF-8 text using the same canonicalization as a loaded corpus file."""
    if not isinstance(text, str) or "\x00" in text:
        raise CorpusManifestError("trusted corpus text must be valid text without NUL bytes")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_corpus_manifest(manifest_path: Path, corpus_dir: Path | None = None) -> dict[str, Any]:
    manifest_path = Path(manifest_path).resolve(strict=True)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CorpusManifestError("corpus manifest must be valid UTF-8 JSON") from exc
    if not isinstance(manifest, dict) or set(manifest) != _TOP_LEVEL_FIELDS:
        raise CorpusManifestError("corpus manifest has missing or unknown top-level fields")
    if manifest["corpus_schema_version"] != MANIFEST_SCHEMA:
        raise CorpusManifestError("unsupported corpus schema version")
    entries = manifest["documents"]
    if not isinstance(entries, list):
        raise CorpusManifestError("corpus documents must be a list")

    entries_by_key: set[str] = set()
    filenames: set[str] = set()
    for entry in entries:
        _validate_document_entry(entry)
        if entry["document_key"] in entries_by_key or entry["local_filename"] in filenames:
            raise CorpusManifestError("document keys and local filenames must be unique")
        entries_by_key.add(entry["document_key"])
        filenames.add(entry["local_filename"])

    supplied_hash = manifest["manifest_sha256"]
    payload = {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    actual_hash = hashlib.sha256(canonical_json(payload)).hexdigest()
    if supplied_hash != actual_hash:
        raise CorpusManifestError("corpus manifest self-hash mismatch")

    if corpus_dir is not None:
        root = Path(corpus_dir).resolve(strict=True)
        if root != manifest_path.parent:
            raise CorpusManifestError("corpus manifest must live in its corpus directory")
        for entry in entries:
            content_path = root / entry["local_filename"]
            if content_path.is_symlink() or not content_path.is_file() or content_path.resolve().parent != root:
                raise CorpusManifestError(f"trusted corpus member is missing or unsafe: {entry['local_filename']}")
            if canonical_text_sha256(content_path) != entry["content_sha256"]:
                raise CorpusManifestError(f"trusted corpus content hash mismatch: {entry['local_filename']}")

    return manifest


def current_documents(manifest: Mapping[str, Any], as_of: date | None = None) -> list[dict[str, Any]]:
    today = as_of or date.today()
    result = []
    for entry in manifest["documents"]:
        start = date.fromisoformat(entry["effective_from"])
        end = date.fromisoformat(entry["effective_to"]) if entry["effective_to"] else None
        if start <= today and (end is None or today <= end):
            result.append(entry)
    return result


def _validate_document_entry(entry: Any) -> None:
    if not isinstance(entry, dict) or set(entry) != _DOCUMENT_FIELDS:
        raise CorpusManifestError("corpus entry has missing or unknown fields")
    string_fields = (
        "document_key",
        "local_filename",
        "content_sha256",
        "official_source_url",
        "publishing_authority",
        "jurisdiction",
        "trust_tier",
        "publication_date",
        "effective_from",
        "document_version",
        "corpus_schema_version",
    )
    if any(not isinstance(entry[field], str) or not entry[field].strip() for field in string_fields):
        raise CorpusManifestError("trusted corpus identity, authority, and legal dates are required")
    if entry["corpus_schema_version"] != MANIFEST_SCHEMA or entry["jurisdiction"] != "IN":
        raise CorpusManifestError("trusted corpus entry has an unsupported schema or jurisdiction")
    if entry["trust_tier"] != "government_official":
        raise CorpusManifestError("global trusted corpus entries must use the approved official tier")
    if len(entry["content_sha256"]) != 64 or any(char not in "0123456789abcdef" for char in entry["content_sha256"]):
        raise CorpusManifestError("content_sha256 must be a lowercase SHA-256 digest")
    filename = entry["local_filename"]
    path = PurePosixPath(filename)
    if path.is_absolute() or len(path.parts) != 1 or filename in {".", ".."}:
        raise CorpusManifestError("local_filename must be a safe corpus-local basename")
    _validate_date(entry["publication_date"], "publication_date")
    _validate_date(entry["effective_from"], "effective_from")
    if entry["effective_to"] is not None:
        _validate_date(entry["effective_to"], "effective_to")
        if entry["effective_to"] < entry["effective_from"]:
            raise CorpusManifestError("effective_to cannot precede effective_from")
    try:
        retrieved_at = datetime.fromisoformat(entry["retrieved_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise CorpusManifestError("retrieved_at must be timezone-aware ISO-8601") from exc
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise CorpusManifestError("retrieved_at must include a timezone")
    if not isinstance(entry["supporting_official_sources"], list):
        raise CorpusManifestError("supporting_official_sources must be a list")
    for field in ("supported_topics", "excluded_topics"):
        values = entry[field]
        if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
            raise CorpusManifestError(f"{field} must be a list of explicit non-empty topic strings")
    for url in [entry["official_source_url"], *entry["supporting_official_sources"]]:
        _validate_official_url(url)
    if not isinstance(entry["supersedes"], list) or any(not isinstance(value, str) for value in entry["supersedes"]):
        raise CorpusManifestError("supersedes must be a list of document keys")


def _validate_date(value: str, field: str) -> None:
    try:
        date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise CorpusManifestError(f"{field} must be an explicit ISO calendar date") from exc


def _validate_official_url(value: Any) -> None:
    if not isinstance(value, str):
        raise CorpusManifestError("official source URL must be a string")
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or not any(host == domain or host.endswith(f".{domain}") for domain in ALLOWED_AUTHORITIES)
    ):
        raise CorpusManifestError("trusted sources must use approved official HTTPS authorities")
