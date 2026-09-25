"""Regression checks for training class order and measured bundle lineage."""

import json

from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score

from model.architecture.base import BasePredictor
from model.artifacts.bundle import MANIFEST_FILENAME, verify_bundle
from model.config import TrainingConfig
from model.data.dataset import create_stratified_split_indices
from model.data.preprocessing import prepare_synthetic_training_data
from model.serving.inference import RandomForestPredictor
from model.training.train_rf import train_random_forest_model


def test_random_forest_bundle_uses_declared_output_class_order_and_real_splits(tmp_path):
    features, labels = prepare_synthetic_training_data(num_samples=600, seed=42)
    model, encoder, metadata = train_random_forest_model(
        num_samples=600,
        seed=42,
        model_dir=tmp_path / "bundle",
        X=features,
        y_indices=labels,
    )

    assert encoder.inverse_transform(model.classes_).tolist() == BasePredictor.TARGET_CLASSES
    assert metadata["training_data_hash"]
    assert metadata["dataset_lineage"]["generation_parameters"]["seed"] == 42
    assert metadata["training_metrics"]["samples"] + metadata["validation_metrics"]["samples"] + metadata["test_metrics"]["samples"] == len(labels)
    _, validation_indices, test_indices = create_stratified_split_indices(labels, TrainingConfig(random_seed=42))
    for split_name, indices in (("validation_metrics", validation_indices), ("test_metrics", test_indices)):
        predictions = model.predict(features[indices])
        measured = metadata[split_name]
        assert measured["accuracy"] == accuracy_score(labels[indices], predictions)
        assert measured["balanced_accuracy"] == balanced_accuracy_score(labels[indices], predictions)
        assert measured["macro_f1"] == f1_score(labels[indices], predictions, average="macro", zero_division=0)
    report = json.loads((tmp_path / "bundle" / "evaluation_report.json").read_text(encoding="utf-8"))
    manifest = json.loads((tmp_path / "bundle" / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    assert report["training_data_hash"] == metadata["training_data_hash"]
    assert report["split_identity"] == metadata["dataset_lineage"]["split_identity"]
    assert manifest["artifact_files"]
    assert manifest["training_code_git_sha"] == metadata["training_code_git_sha"]

    bundle_path = tmp_path / "bundle"
    verified = verify_bundle(bundle_path, manifest["bundle_manifest_sha256"], require_serving_qualified=False)
    predictor = RandomForestPredictor()
    predictor.load_artifacts(
        bundle_dir=bundle_path,
        expected_bundle_hash=verified["manifest_sha256"],
        version_id="local-test",
        require_serving_qualified=False,
    )
    prediction = predictor.predict(features[:1])
    assert prediction["primary"] in BasePredictor.TARGET_CLASSES
    assert list(prediction["confidence_scores"]) == BasePredictor.TARGET_CLASSES
