"""The baseline bundle repackager changes JSON bytes only, never model artifacts."""

import hashlib
import json
from pathlib import Path

from model.artifacts.bundle import (
    ARCHITECTURE_FILES,
    MANIFEST_FILENAME,
    build_bundle_manifest,
    canonical_json_bytes,
    json_lf_bytes,
    sha256_file,
    verify_bundle,
    write_json_lf,
)
from model.architecture.base import BasePredictor
from model.data.feature_engineering import FEATURE_NAMES, FEATURE_SCHEMA_VERSION
from scripts.repackage_serving_bundles import BUNDLE_DIRECTORIES, repackage_existing_bundles
from scripts.verify_serving_artifacts import verify_serving_artifacts


GIT_SHA = "a" * 40
TRAINED_AT = "2026-09-24T12:00:00+00:00"
LINEAGE = {
    "generator": "fixture-generator",
    "generation_parameters": {"seed": 9, "rows": 60},
    "split_identity": {
        name: hashlib.sha256(name.encode("ascii")).hexdigest()
        for name in ("train_indices_sha256", "validation_indices_sha256", "test_indices_sha256")
    },
}


def _write_legacy_crlf_bundle(bundle_dir: Path, architecture: str) -> tuple[dict, dict[str, str]]:
    bundle_dir.mkdir(parents=True)
    files = ARCHITECTURE_FILES[architecture]
    bundle_id = f"{architecture.lower()}-legacy-crlf"
    model_version = "4.0.0"
    data_hash = hashlib.sha256(architecture.encode("utf-8")).hexdigest()
    report = {"evaluation_run_id": f"{architecture}-eval", "metrics": {"accuracy": 0.875}}
    metadata = {
        "model_version": model_version,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "target_classes": list(BasePredictor.TARGET_CLASSES),
        "training_data_hash": data_hash,
        "training_code_git_sha": GIT_SHA,
        "training_timestamp": TRAINED_AT,
        "dataset_lineage": LINEAGE,
    }
    binary_hashes = {}
    for role, filename in files.items():
        path = bundle_dir / filename
        if role == "metadata":
            payload = json_lf_bytes(metadata)
        elif role == "evaluation_report":
            payload = json_lf_bytes(report)
        else:
            payload = f"fixture-binary:{architecture}:{role}".encode("ascii")
            binary_hashes[filename] = hashlib.sha256(payload).hexdigest()
        path.write_bytes(payload.replace(b"\n", b"\r\n") if filename.endswith(".json") else payload)

    manifest = build_bundle_manifest(
        bundle_dir,
        bundle_id=bundle_id,
        architecture=architecture,
        model_version=model_version,
        feature_schema_version=FEATURE_SCHEMA_VERSION,
        feature_names=list(FEATURE_NAMES),
        target_classes=list(BasePredictor.TARGET_CLASSES),
        training_data_hash=data_hash,
        training_code_git_sha=GIT_SHA,
        training_timestamp=TRAINED_AT,
        dataset_lineage=LINEAGE,
        python_version="3.12-test",
        framework_versions={"fixture": "1"},
        evaluation_report_id=report["evaluation_run_id"],
        evaluation_report_sha256=sha256_file(bundle_dir / files["evaluation_report"]),
    )
    write_json_lf(bundle_dir / MANIFEST_FILENAME, manifest)
    (bundle_dir / MANIFEST_FILENAME).write_bytes(
        (bundle_dir / MANIFEST_FILENAME).read_bytes().replace(b"\n", b"\r\n")
    )
    return {"metadata": metadata, "report": report, "manifest": manifest}, binary_hashes


def test_existing_crlf_bundles_repackage_without_retraining_or_binary_changes(tmp_path):
    model_root = tmp_path / "model"
    bundle_root = model_root / "bundles"
    bundle_root.mkdir(parents=True)
    semantic_before = {}
    binary_hashes_before = {}
    trusted = {}

    for architecture, directory in BUNDLE_DIRECTORIES.items():
        semantic_before[architecture], binary_hashes_before[architecture] = _write_legacy_crlf_bundle(
            bundle_root / directory, architecture
        )
        manifest = semantic_before[architecture]["manifest"]
        trusted[architecture] = {
            "bundle_id": manifest["bundle_id"],
            "bundle_manifest_sha256": manifest["bundle_manifest_sha256"],
        }

    anchor_payload = {"anchor_schema_version": 1, "bundles": trusted}
    anchor = {
        **anchor_payload,
        "anchor_sha256": hashlib.sha256(canonical_json_bytes(anchor_payload)).hexdigest(),
    }
    write_json_lf(bundle_root / "trusted_bundle_hashes.json", anchor)
    (bundle_root / "trusted_bundle_hashes.json").write_bytes(
        (bundle_root / "trusted_bundle_hashes.json").read_bytes().replace(b"\n", b"\r\n")
    )

    summary = repackage_existing_bundles(bundle_root)
    assert set(summary) == set(BUNDLE_DIRECTORIES)
    assert all(
        summary[architecture]["old_manifest_sha256"] != summary[architecture]["bundle_manifest_sha256"]
        for architecture in BUNDLE_DIRECTORIES
    )
    assert verify_serving_artifacts(tmp_path) == [
        f"model/bundles/{BUNDLE_DIRECTORIES[architecture]}" for architecture in BUNDLE_DIRECTORIES
    ]

    for architecture, directory in BUNDLE_DIRECTORIES.items():
        bundle_dir = bundle_root / directory
        manifest_path = bundle_dir / MANIFEST_FILENAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert manifest["training_data_hash"] == semantic_before[architecture]["manifest"]["training_data_hash"]
        assert manifest["training_code_git_sha"] == GIT_SHA
        assert manifest["training_timestamp"] == TRAINED_AT
        assert json.loads((bundle_dir / ARCHITECTURE_FILES[architecture]["metadata"]).read_text(encoding="utf-8")) == semantic_before[architecture]["metadata"]
        assert json.loads((bundle_dir / ARCHITECTURE_FILES[architecture]["evaluation_report"]).read_text(encoding="utf-8")) == semantic_before[architecture]["report"]
        for json_path in bundle_dir.glob("*.json"):
            assert b"\r" not in json_path.read_bytes()
        for member in manifest["artifact_files"]:
            payload = (bundle_dir / member["filename"]).read_bytes()
            assert len(payload) == member["size_bytes"]
            assert hashlib.sha256(payload).hexdigest() == member["sha256"]
            if member["filename"] in binary_hashes_before[architecture]:
                assert hashlib.sha256(payload).hexdigest() == binary_hashes_before[architecture][member["filename"]]
        verify_bundle(bundle_dir, manifest["bundle_manifest_sha256"])


def test_checked_in_serving_bundles_have_lf_json_and_exact_member_hashes():
    ml_service_root = Path(__file__).resolve().parents[1]
    bundle_root = ml_service_root / "model" / "bundles"
    verified_paths = verify_serving_artifacts(ml_service_root)
    assert len(verified_paths) == len(BUNDLE_DIRECTORIES)

    for directory in BUNDLE_DIRECTORIES.values():
        bundle_dir = bundle_root / directory
        manifest = json.loads((bundle_dir / MANIFEST_FILENAME).read_text(encoding="utf-8"))
        for json_path in bundle_dir.glob("*.json"):
            payload = json_path.read_bytes()
            assert b"\r" not in payload
            assert payload == json_lf_bytes(json.loads(payload.decode("utf-8")))
        for member in manifest["artifact_files"]:
            payload = (bundle_dir / member["filename"]).read_bytes()
            assert len(payload) == member["size_bytes"]
            assert hashlib.sha256(payload).hexdigest() == member["sha256"]
