"""Chronological expanding-window splits with an untouched final holdout."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from sklearn.preprocessing import StandardScaler


@dataclass(frozen=True)
class WalkForwardFold:
    fold: int
    train_start: int
    train_end: int
    validation_start: int
    validation_end: int
    embargo_sessions: int

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


@dataclass(frozen=True)
class ChronologicalEvaluationPlan:
    folds: tuple[WalkForwardFold, ...]
    holdout_start: int
    holdout_end: int
    supervised_purge_sessions: int
    rationale: str


def expanding_walk_forward_plan(
    row_count: int,
    *,
    minimum_train_sessions: int = 504,
    validation_sessions: int = 126,
    holdout_sessions: int = 252,
    supervised_purge_sessions: int = 0,
) -> ChronologicalEvaluationPlan:
    if min(row_count, minimum_train_sessions, validation_sessions, holdout_sessions) <= 0:
        raise ValueError("Split sizes must be positive.")
    if supervised_purge_sessions < 0:
        raise ValueError("supervised_purge_sessions cannot be negative.")
    holdout_start = row_count - holdout_sessions
    if holdout_start < minimum_train_sessions + validation_sessions:
        raise ValueError("INSUFFICIENT_ROWS_FOR_WALK_FORWARD_AND_HOLDOUT")
    folds: list[WalkForwardFold] = []
    validation_start = minimum_train_sessions
    while validation_start + validation_sessions <= holdout_start:
        train_end = validation_start - supervised_purge_sessions
        if train_end <= 0:
            raise ValueError("Purge removes the complete training window.")
        folds.append(WalkForwardFold(
            fold=len(folds) + 1,
            train_start=0,
            train_end=train_end,
            validation_start=validation_start,
            validation_end=validation_start + validation_sessions,
            embargo_sessions=supervised_purge_sessions,
        ))
        validation_start += validation_sessions
    if not folds:
        raise ValueError("NO_COMPLETE_WALK_FORWARD_FOLDS")
    return ChronologicalEvaluationPlan(
        folds=tuple(folds),
        holdout_start=holdout_start,
        holdout_end=row_count,
        supervised_purge_sessions=supervised_purge_sessions,
        rationale=(
            "Expanding windows preserve temporal order and increasing information. "
            "The final 252 sessions are isolated before state-count selection."
        ),
    )


def fit_training_scaler(features: np.ndarray, fold: WalkForwardFold) -> tuple[StandardScaler, np.ndarray, np.ndarray]:
    train = np.asarray(features[fold.train_start:fold.train_end], dtype=float)
    validation = np.asarray(features[fold.validation_start:fold.validation_end], dtype=float)
    if not len(train) or not len(validation):
        raise ValueError("EMPTY_WALK_FORWARD_SLICE")
    scaler = StandardScaler().fit(train)
    return scaler, scaler.transform(train), scaler.transform(validation)
