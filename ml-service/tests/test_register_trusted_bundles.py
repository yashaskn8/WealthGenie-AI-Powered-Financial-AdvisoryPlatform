"""Tests for explicit, trusted CI bootstrap of Mongo-backed model state."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from model.registry.mongo_registry_store import ModelActivationConflict
from scripts import register_trusted_bundles as registration


ARCHITECTURES = {
    "RandomForest": "model",
    "PyTorch_MLP": "weights",
    "FT_Transformer": "weights",
}


def _verified_fixture(tmp_path: Path) -> dict:
    verified = {}
    for index, (architecture, artifact_role) in enumerate(ARCHITECTURES.items(), start=1):
        bundle_dir = tmp_path / architecture
        bundle_dir.mkdir()
        artifact_path = bundle_dir / f"{artifact_role}.bin"
        artifact_path.write_bytes(f"fixture-artifact-{architecture}".encode())
        artifact_hash = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
        manifest_hash = f"{index:064x}"
        manifest = {
            "architecture": architecture,
            "bundle_id": f"trusted-{architecture}-bundle",
            "bundle_manifest_sha256": manifest_hash,
            "model_version": "4.0.0",
            "feature_schema_version": "recommendation-features-4.0.0",
            "feature_names": ["age", "monthly_savings"],
            "target_classes": ["FD", "Equity_MF"],
            "training_data_hash": f"{index + 10:064x}",
            "training_timestamp": "2026-09-25T12:00:00+00:00",
            "evaluation_report_id": f"eval-{architecture}",
            "evaluation_report_sha256": f"{index + 20:064x}",
            "artifact_files": [{"role": artifact_role, "sha256": artifact_hash}],
        }
        verified[architecture] = {
            "bundle_dir": bundle_dir,
            "manifest": manifest,
            "manifest_sha256": manifest_hash,
            "members": {artifact_role: artifact_path},
        }
    return verified


class _ArtifactStoreFixture:
    def __init__(self):
        self.put_calls = []

    def put_bundle(self, bundle_dir, expected_manifest_sha256):
        self.put_calls.append((Path(bundle_dir), expected_manifest_sha256))
        return {"bundle_id": Path(bundle_dir).name, "bundle_manifest_sha256": expected_manifest_sha256}


class _RegistryFixture:
    def __init__(self):
        self.versions: dict[str, list[dict]] = {architecture: [] for architecture in ARCHITECTURES}
        self.bootstrap_calls = []

    def get_active_model(self, architecture):
        return next((row for row in self.versions[architecture] if row["is_active"]), None)

    def list_versions(self, architecture):
        return list(self.versions[architecture])

    def bootstrap_verified_bundles(self, bundles, artifact_store):
        self.bootstrap_calls.append(bundles)
        for architecture, bundle in bundles.items():
            manifest = bundle["manifest"]
            artifact_store.put_bundle(bundle["bundle_dir"], bundle["manifest_sha256"])
            existing = [row for row in self.versions[architecture] if row.get("bundle_id") == manifest["bundle_id"]]
            if len(existing) > 1:
                raise registration.TrustedBundleRegistrationError("multiple registry records claim bundle")
            active = self.get_active_model(architecture)
            if active and (active.get("bundle_id") != manifest["bundle_id"] or active.get("bundle_manifest_sha256") != bundle["manifest_sha256"]):
                raise ModelActivationConflict(f"refusing to replace existing active {architecture} model")
        records = {}
        for architecture, bundle in bundles.items():
            manifest = bundle["manifest"]
            active = self.get_active_model(architecture)
            if active:
                records[architecture] = active
                continue
            row = {
                "version_id": f"version-{len(self.versions[architecture]) + 1}",
                "bundle_id": manifest["bundle_id"],
                "bundle_manifest_sha256": bundle["manifest_sha256"],
                "training_data_hash": manifest["training_data_hash"],
                "artifact_store_id": manifest["bundle_id"],
                "is_active": True,
            }
            self.versions[architecture].append(row)
            records[architecture] = row
        return records


def test_registration_uses_verified_anchor_metadata_and_is_idempotent(tmp_path):
    verified = _verified_fixture(tmp_path)
    registry = _RegistryFixture()
    artifact_store = _ArtifactStoreFixture()

    first = registration.register_verified_bundles(registry, verified, artifact_store)
    second = registration.register_verified_bundles(registry, verified, artifact_store)

    assert first == second
    assert len(registry.bootstrap_calls) == 2
    assert len(artifact_store.put_calls) == 2 * len(ARCHITECTURES)
    for architecture, bundle in verified.items():
        active = registry.get_active_model(architecture)
        assert active["bundle_id"] == bundle["manifest"]["bundle_id"]
        assert active["bundle_manifest_sha256"] == bundle["manifest_sha256"]
        assert active["artifact_store_id"] == bundle["manifest"]["bundle_id"]
        assert active["training_data_hash"] == bundle["manifest"]["training_data_hash"]
        assert len(registry.versions[architecture]) == 1


def test_registration_refuses_to_replace_any_different_active_model_before_writing(tmp_path):
    verified = _verified_fixture(tmp_path)
    registry = _RegistryFixture()
    artifact_store = _ArtifactStoreFixture()
    registry.versions["FT_Transformer"].append({
        "version_id": "operator-model",
        "bundle_id": "operator-selected-bundle",
        "is_active": True,
    })

    with pytest.raises(ModelActivationConflict, match="refusing to replace"):
        registration.register_verified_bundles(registry, verified, artifact_store)

    assert len(registry.bootstrap_calls) == 1
    assert all(not registry.get_active_model(architecture) for architecture in ("RandomForest", "PyTorch_MLP"))


def test_registration_rejects_duplicate_records_for_one_trusted_bundle(tmp_path):
    verified = _verified_fixture(tmp_path)
    registry = _RegistryFixture()
    artifact_store = _ArtifactStoreFixture()
    registration.register_verified_bundles(registry, verified, artifact_store)
    registry.versions["RandomForest"].append(dict(registry.versions["RandomForest"][0]))
    calls_before = len(registry.bootstrap_calls)

    with pytest.raises(registration.TrustedBundleRegistrationError, match="multiple registry records"):
        registration.register_verified_bundles(registry, verified, artifact_store)

    assert len(registry.bootstrap_calls) == calls_before + 1


def test_bundle_verification_happens_before_mongo_registry_initialization(monkeypatch, tmp_path):
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("ML_STATE_BACKEND", "mongodb")
    monkeypatch.setenv("MONGODB_URI", "mongodb://example/wealthgenie")
    monkeypatch.setenv("WEALTHGENIE_PHASE3_BOOTSTRAP", "1")

    def reject_bundle(_root):
        raise registration.TrustedBundleRegistrationError("untrusted fixture")

    monkeypatch.setattr(registration, "verify_trusted_serving_bundles", reject_bundle)
    monkeypatch.setattr(
        registration,
        "get_model_registry",
        lambda: pytest.fail("Mongo must not be initialized before trusted bundle verification"),
    )

    with pytest.raises(registration.TrustedBundleRegistrationError, match="untrusted fixture"):
        registration.register_trusted_bundles(tmp_path)


def test_bootstrap_requires_explicit_release_gate(monkeypatch, tmp_path):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ML_STATE_BACKEND", "mongodb")
    monkeypatch.setenv("MONGODB_URI", "mongodb://example/wealthgenie")

    monkeypatch.delenv("WEALTHGENIE_PHASE3_BOOTSTRAP", raising=False)
    with pytest.raises(registration.TrustedBundleRegistrationError, match="explicit release operation"):
        registration.register_trusted_bundles(tmp_path)
