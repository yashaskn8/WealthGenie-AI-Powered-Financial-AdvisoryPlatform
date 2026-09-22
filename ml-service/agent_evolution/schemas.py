"""Strict optimizer-side schemas. Holdout and private user data never enter this module."""

from dataclasses import dataclass, field
from typing import Any

HARD_BUDGETS = {
    'max_generations': 3,
    'max_candidates': 12,
    'max_reflection_calls': 12,
    'max_metric_calls': 1000,
    'max_sandbox_runs': 20,
    'max_sandbox_minutes': 60,
    'max_total_tokens': 15000,
}

PRIVATE_KEYS = frozenset({
    'email', 'phone', 'userId', 'user_id', 'income', 'monthlyTakeHome',
    'bankAccount', 'password', 'jwt', 'token', 'rawProfile', 'profile',
    'holdout', 'answerKey',
})


def _normalized_key(key: Any) -> str:
    return ''.join(character for character in str(key) if character.isalnum()).lower()


PRIVATE_KEY_FRAGMENTS = frozenset({
    'email', 'phone', 'income', 'monthlytakehome', 'monthlyincome', 'salary',
    'bankaccount', 'password', 'jwt', 'token', 'rawprofile', 'profile',
    'userid', 'holdout', 'answerkey', 'secret', 'privatekey',
})


@dataclass(frozen=True)
class EvolutionBudget:
    max_generations: int = 3
    max_candidates: int = 12
    max_reflection_calls: int = 12
    max_metric_calls: int = 1000
    max_sandbox_runs: int = 20
    max_sandbox_minutes: int = 60
    max_total_tokens: int = 15000

    def __post_init__(self) -> None:
        for name, maximum in HARD_BUDGETS.items():
            value = getattr(self, name)
            if not isinstance(value, int) or value < 0 or value > maximum:
                raise ValueError(f'{name} exceeds its immutable hard maximum')


@dataclass(frozen=True)
class SanitizedTrajectory:
    trajectory_id: str
    events: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    failure_codes: tuple[str, ...] = field(default_factory=tuple)
    feedback: str = ''


def _assert_private_free(value: Any, path: str = 'root') -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = _normalized_key(key)
            if str(key) in PRIVATE_KEYS or normalized in PRIVATE_KEY_FRAGMENTS:
                raise ValueError(f'private or sealed field rejected at {path}.{key}')
            _assert_private_free(child, f'{path}.{key}')
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _assert_private_free(child, f'{path}[{index}]')


def validate_optimizer_dataset(dataset: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(dataset, list):
        raise TypeError('optimizer dataset must be a list')
    _assert_private_free(dataset)
    if any(item.get('partition') == 'holdout' for item in dataset):
        raise ValueError('holdout rows are sealed from GEPA')
    return dataset
