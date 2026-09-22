"""Governed, offline-only GEPA integration for prompt/scaffold evolution."""

from .gepa_optimizer import DspyGepaOptimizer, GEPA_VERSION
from .schemas import EvolutionBudget, SanitizedTrajectory, validate_optimizer_dataset

__all__ = [
    'DspyGepaOptimizer',
    'GEPA_VERSION',
    'EvolutionBudget',
    'SanitizedTrajectory',
    'validate_optimizer_dataset',
]
