"""
WealthGenie ML Microservice - Modular Model Registry
Centralized registry for dynamic model registration, lookup, and unified multi-model inference execution.
Integrates in-memory inference predictors with persistent version registries (MongoDB / SQLite) via store_factory.
"""

import logging
import threading
from pathlib import Path
from typing import Dict, List, Any, Optional
from model.architecture.base import BasePredictor

logger = logging.getLogger("wealthgenie.model_registry")


class ModelRegistry:
    """Registry managing in-memory model predictors and bridging to persistent version registry."""

    def __init__(self, version_registry=None):
        self._registry: Dict[str, BasePredictor] = {}
        self._version_registry = version_registry
        self._lock = threading.RLock()

    def set_version_registry(self, version_registry) -> None:
        """Attaches the persistent version registry store."""
        self._version_registry = version_registry
        logger.info(f"Attached version registry ({type(version_registry).__name__}) to ModelRegistry.")

    def get_version_registry(self):
        """Returns the persistent version registry store if attached."""
        return self._version_registry

    def register(self, name: str, predictor: BasePredictor) -> None:
        """Registers a model predictor instance under a unique identifier key."""
        key = name.lower().strip()
        with self._lock:
            self._registry[key] = predictor
        logger.info(f"Registered model predictor '{name}' in ModelRegistry.")

    def replace_aliases(self, names: List[str], predictor: BasePredictor) -> None:
        """Atomically publish a fully preloaded predictor under its serving aliases."""
        with self._lock:
            for name in names:
                self._registry[name.lower().strip()] = predictor

    def get(self, name: str) -> Optional[BasePredictor]:
        """Retrieves a registered model predictor by key."""
        key = name.lower().strip()
        with self._lock:
            return self._registry.get(key)

    def list_models(self) -> List[Dict[str, Any]]:
        """Returns metadata for all currently registered in-memory models."""
        models_info = []
        for key, predictor in self._registry.items():
            models_info.append({
                "key": key,
                "model_name": predictor.model_name,
                "is_loaded": predictor.is_loaded,
            })
        return models_info

    def get_loaded_predictors(self) -> Dict[str, BasePredictor]:
        """Returns a dict of all currently loaded predictors."""
        with self._lock:
            return {key: pred for key, pred in self._registry.items() if pred.is_loaded}

    def list_versions(self, architecture: Optional[str] = None) -> List[Dict[str, Any]]:
        """Queries persistent version registry for all registered model versions."""
        if self._version_registry is None:
            return []
        return self._version_registry.list_versions(architecture)

    def get_active_model(self, architecture: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Queries persistent version registry for the active model version."""
        if self._version_registry is None:
            return None
        return self._version_registry.get_active_model(architecture)

    def reload_active_model(self, architecture: str) -> Optional[BasePredictor]:
        """
        Reconciles the active immutable bundle from the configured ArtifactStore.
        """
        if self._version_registry is None:
            logger.warning("Cannot reload active model: no version registry attached.")
            return None
        aliases = {
            "randomforest": "RandomForest", "random_forest": "RandomForest", "rf": "RandomForest",
            "mlp": "PyTorch_MLP", "pytorch": "PyTorch_MLP", "pytorch_mlp": "PyTorch_MLP",
            "ft_transformer": "FT_Transformer", "fttransformer": "FT_Transformer", "ft-transformer": "FT_Transformer",
        }
        canonical = aliases.get(architecture.lower().strip())
        if canonical is None:
            logger.warning("Cannot reload unsupported model architecture '%s'.", architecture)
            return None
        try:
            from model.serving.control_plane import ensure_active_model_loaded
            return ensure_active_model_loaded(canonical)
        except Exception as exc:
            logger.error("Shared active bundle reconciliation failed: %s", type(exc).__name__)
            return None


# Global singleton registry instance
registry = ModelRegistry()
