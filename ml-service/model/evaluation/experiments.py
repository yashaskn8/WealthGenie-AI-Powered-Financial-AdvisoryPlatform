"""
WealthGenie ML Microservice - Experiment Tracker Module
Logs training runs, hyperparameters, metrics, loss curves, and model checksums into structured JSON.
"""

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

from model.config import BASE_DIR

REPORTS_DIR = BASE_DIR / "reports"
EXPERIMENTS_DIR = REPORTS_DIR / "experiments"
EXPERIMENTS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("wealthgenie.experiment_tracker")


class ExperimentTracker:
    """Logs and persists structured experiment metadata for every training run."""

    def __init__(self, experiments_dir: Path = EXPERIMENTS_DIR):
        self.experiments_dir = experiments_dir
        self.experiments_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def compute_file_sha256(filepath: Path) -> str:
        """Computes SHA256 hash checksum of a model file for auditable reproducibility."""
        if not filepath.exists():
            return "none"
        sha256_hash = hashlib.sha256()
        with open(filepath, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    def log_experiment(
        self,
        model_name: str,
        model_type: str,
        hyperparameters: Dict[str, Any],
        dataset_stats: Dict[str, Any],
        metrics: Dict[str, Any],
        history: Dict[str, Any],
        model_artifact_path: Optional[Path] = None,
        git_commit_hash: Optional[str] = None,
    ) -> Path:
        """
        Persists a complete experiment run as a JSON record in experiments_dir.
        Returns the saved experiment file path.
        """
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        exp_id = f"exp_{model_name.lower()}_{timestamp_str}"
        exp_file = self.experiments_dir / f"{exp_id}.json"

        checksum = self.compute_file_sha256(model_artifact_path) if model_artifact_path else "none"

        record = {
            "experiment_id": exp_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "model_name": model_name,
            "model_type": model_type,
            "git_commit_hash": git_commit_hash,
            "model_checksum_sha256": checksum,
            "hyperparameters": hyperparameters,
            "dataset_statistics": dataset_stats,
            "evaluation_metrics": metrics,
            "training_history": history,
        }

        with open(exp_file, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2)

        logger.info(f"Experiment log saved successfully to {exp_file}")
        return exp_file

    def list_experiments(self) -> List[Dict[str, Any]]:
        """Returns summaries of all logged experiments."""
        logs = []
        for p in sorted(self.experiments_dir.glob("exp_*.json"), reverse=True):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logs.append({
                    "experiment_id": data.get("experiment_id"),
                    "timestamp": data.get("timestamp_utc"),
                    "model_name": data.get("model_name"),
                    "accuracy": data.get("evaluation_metrics", {}).get("accuracy"),
                    "f1_score": data.get("evaluation_metrics", {}).get("f1_score"),
                    "file_path": str(p),
                })
            except Exception as e:
                logger.warning(f"Could not parse experiment log {p}: {e}")
        return logs
