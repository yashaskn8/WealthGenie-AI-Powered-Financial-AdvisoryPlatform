"""Gaussian-HMM training and causal online filtering for shadow qualification."""

from __future__ import annotations

import itertools
import math
import warnings
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np
from hmmlearn.hmm import GaussianHMM
from scipy.special import logsumexp
from sklearn.preprocessing import StandardScaler

from .splits import ChronologicalEvaluationPlan, fit_training_scaler


HMM_SEEDS = (7, 17, 29)
HMM_STATE_COUNTS = (2, 3, 4)
HMM_COVARIANCE_TYPE = "diag"
HMM_MAX_ITERATIONS = 300
HMM_TOLERANCE = 1e-4


@dataclass(frozen=True)
class HmmQualificationThresholds:
    convergence_rate_min: float = 1.0
    minimum_training_state_occupancy: float = 0.01
    median_seed_agreement_min: float = 0.70
    maximum_switching_rate: float = 0.35


QUALIFICATION_THRESHOLDS = HmmQualificationThresholds()


def train_gaussian_hmm(values: np.ndarray, state_count: int, seed: int) -> GaussianHMM:
    matrix = np.asarray(values, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] <= state_count or not np.isfinite(matrix).all():
        raise ValueError("HMM_TRAINING_MATRIX_INVALID")
    model = GaussianHMM(
        n_components=state_count,
        covariance_type=HMM_COVARIANCE_TYPE,
        min_covar=1e-4,
        n_iter=HMM_MAX_ITERATIONS,
        tol=HMM_TOLERANCE,
        random_state=seed,
        implementation="log",
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model.fit(matrix)
    return model


def _diagonal_covariances(model: GaussianHMM) -> np.ndarray:
    covariances = np.asarray(getattr(model, "_covars_", model.covars_), dtype=float)
    if covariances.ndim == 3:
        covariances = np.diagonal(covariances, axis1=1, axis2=2)
    if covariances.shape != model.means_.shape or np.any(covariances <= 0):
        raise ValueError("HMM_COVARIANCE_INVALID")
    return covariances


def _emission_log_likelihood(model: GaussianHMM, values: np.ndarray) -> np.ndarray:
    matrix = np.asarray(values, dtype=float)
    means = np.asarray(model.means_, dtype=float)
    covariances = _diagonal_covariances(model)
    dimensions = means.shape[1]
    differences = matrix[:, np.newaxis, :] - means[np.newaxis, :, :]
    return -0.5 * (
        dimensions * math.log(2 * math.pi)
        + np.log(covariances).sum(axis=1)[np.newaxis, :]
        + ((differences**2) / covariances[np.newaxis, :, :]).sum(axis=2)
    )


def causal_filter_parameters(
    start_probabilities: np.ndarray,
    transition_matrix: np.ndarray,
    means: np.ndarray,
    diagonal_covariances: np.ndarray,
    values: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Return filtered p(state_t | x_1..x_t); never uses a future observation."""
    matrix = np.asarray(values, dtype=float)
    start = np.asarray(start_probabilities, dtype=float)
    transition = np.asarray(transition_matrix, dtype=float)
    means_array = np.asarray(means, dtype=float)
    covariance_array = np.asarray(diagonal_covariances, dtype=float)
    if matrix.ndim != 2 or not len(matrix) or not np.isfinite(matrix).all():
        raise ValueError("HMM_INFERENCE_MATRIX_INVALID")
    state_count, dimensions = means_array.shape
    if start.shape != (state_count,) or transition.shape != (state_count, state_count):
        raise ValueError("HMM_TRANSITION_SHAPE_INVALID")
    if covariance_array.shape != means_array.shape or matrix.shape[1] != dimensions:
        raise ValueError("HMM_FEATURE_SHAPE_INVALID")
    if np.any(start < 0) or np.any(transition < 0) or np.any(covariance_array <= 0):
        raise ValueError("HMM_PARAMETER_VALUE_INVALID")
    if not np.isclose(start.sum(), 1.0) or not np.allclose(transition.sum(axis=1), 1.0):
        raise ValueError("HMM_PROBABILITY_NORMALIZATION_INVALID")

    safe_start = np.log(np.clip(start, 1e-300, None))
    safe_transition = np.log(np.clip(transition, 1e-300, None))
    differences = matrix[:, np.newaxis, :] - means_array[np.newaxis, :, :]
    emissions = -0.5 * (
        dimensions * math.log(2 * math.pi)
        + np.log(covariance_array).sum(axis=1)[np.newaxis, :]
        + ((differences**2) / covariance_array[np.newaxis, :, :]).sum(axis=2)
    )
    filtered = np.empty((len(matrix), state_count), dtype=float)
    total_log_likelihood = 0.0
    log_alpha = safe_start + emissions[0]
    normalizer = float(logsumexp(log_alpha))
    total_log_likelihood += normalizer
    log_alpha -= normalizer
    filtered[0] = np.exp(log_alpha)
    for index in range(1, len(matrix)):
        log_alpha = emissions[index] + logsumexp(log_alpha[:, np.newaxis] + safe_transition, axis=0)
        normalizer = float(logsumexp(log_alpha))
        total_log_likelihood += normalizer
        log_alpha -= normalizer
        filtered[index] = np.exp(log_alpha)
    return filtered, filtered.argmax(axis=1), total_log_likelihood


def causal_filter(model: GaussianHMM, values: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    return causal_filter_parameters(
        model.startprob_,
        model.transmat_,
        model.means_,
        _diagonal_covariances(model),
        values,
    )


def state_permutation(reference_means: np.ndarray, candidate_means: np.ndarray) -> tuple[int, ...]:
    """Map each candidate state index to the closest reference state globally."""
    reference = np.asarray(reference_means, dtype=float)
    candidate = np.asarray(candidate_means, dtype=float)
    if reference.shape != candidate.shape or reference.ndim != 2:
        raise ValueError("STATE_SIGNATURE_SHAPE_MISMATCH")
    best: tuple[int, ...] | None = None
    best_cost = float("inf")
    for permutation in itertools.permutations(range(reference.shape[0])):
        cost = sum(float(np.linalg.norm(candidate[index] - reference[reference_index]))
                   for index, reference_index in enumerate(permutation))
        if cost < best_cost:
            best = permutation
            best_cost = cost
    if best is None:
        raise ValueError("STATE_PERMUTATION_UNAVAILABLE")
    return best


def align_states(states: np.ndarray, permutation: Iterable[int]) -> np.ndarray:
    mapping = np.asarray(tuple(permutation), dtype=int)
    observed = np.asarray(states, dtype=int)
    if observed.size and (observed.min() < 0 or observed.max() >= len(mapping)):
        raise ValueError("STATE_INDEX_OUT_OF_RANGE")
    return mapping[observed]


def _state_metrics(states: np.ndarray, state_count: int) -> dict[str, Any]:
    observed = np.asarray(states, dtype=int)
    occupancy = np.bincount(observed, minlength=state_count) / len(observed)
    switching_rate = float(np.mean(observed[1:] != observed[:-1])) if len(observed) > 1 else 0.0
    durations: list[list[int]] = [[] for _ in range(state_count)]
    run_state = int(observed[0])
    run_length = 1
    for state in observed[1:]:
        state = int(state)
        if state == run_state:
            run_length += 1
        else:
            durations[run_state].append(run_length)
            run_state = state
            run_length = 1
    durations[run_state].append(run_length)
    return {
        "occupancy": [float(value) for value in occupancy],
        "minimumOccupancy": float(occupancy.min()),
        "switchingRate": switching_rate,
        "meanDurationSessions": [
            float(np.mean(state_durations)) if state_durations else 0.0
            for state_durations in durations
        ],
    }


def _run_fold(values: np.ndarray, fold, state_count: int, seed: int) -> tuple[dict[str, Any], GaussianHMM, np.ndarray]:
    scaler, train_scaled, validation_scaled = fit_training_scaler(values, fold)
    model = train_gaussian_hmm(train_scaled, state_count, seed)
    combined = np.vstack([train_scaled, validation_scaled])
    _, combined_states, total_likelihood = causal_filter(model, combined)
    training_states = combined_states[:len(train_scaled)]
    validation_states = combined_states[len(train_scaled):]
    training_state_metrics = _state_metrics(training_states, state_count)
    state_metrics = _state_metrics(validation_states, state_count)
    validation_log_likelihood = float(model.score(validation_scaled) / len(validation_scaled))
    result = {
        "fold": fold.fold,
        "seed": seed,
        "trainRows": len(train_scaled),
        "validationRows": len(validation_scaled),
        "converged": bool(model.monitor_.converged),
        "iterations": int(model.monitor_.iter),
        "validationLogLikelihoodPerObservation": validation_log_likelihood,
        "causalSequenceLogLikelihoodPerObservation": float(total_likelihood / len(combined)),
        "aicTraining": float(model.aic(train_scaled)),
        "bicTraining": float(model.bic(train_scaled)),
        "transitionMatrix": np.asarray(model.transmat_).tolist(),
        "trainingMinimumOccupancy": training_state_metrics["minimumOccupancy"],
        **state_metrics,
        "scalerTrainingMean": scaler.mean_.tolist(),
    }
    return result, model, validation_states


def evaluate_state_counts(
    values: np.ndarray,
    plan: ChronologicalEvaluationPlan,
    *,
    state_counts: tuple[int, ...] = HMM_STATE_COUNTS,
    seeds: tuple[int, ...] = HMM_SEEDS,
) -> tuple[list[dict[str, Any]], int | None]:
    matrix = np.asarray(values, dtype=float)
    candidates: list[dict[str, Any]] = []
    for state_count in state_counts:
        runs: list[dict[str, Any]] = []
        seed_agreements: list[float] = []
        fold_centroid_distances: list[float] = []
        prior_reference_means: np.ndarray | None = None
        for fold in plan.folds:
            fold_models: list[GaussianHMM] = []
            fold_states: list[np.ndarray] = []
            for seed in seeds:
                run, model, validation_states = _run_fold(matrix, fold, state_count, seed)
                runs.append(run)
                fold_models.append(model)
                fold_states.append(validation_states)
            reference_model = fold_models[0]
            for candidate_model, candidate_states in zip(fold_models[1:], fold_states[1:]):
                permutation = state_permutation(reference_model.means_, candidate_model.means_)
                seed_agreements.append(float(np.mean(
                    fold_states[0] == align_states(candidate_states, permutation)
                )))
            if prior_reference_means is not None:
                permutation = state_permutation(prior_reference_means, reference_model.means_)
                aligned = np.empty_like(reference_model.means_)
                for candidate_index, reference_index in enumerate(permutation):
                    aligned[reference_index] = reference_model.means_[candidate_index]
                fold_centroid_distances.append(float(np.mean(np.linalg.norm(
                    prior_reference_means - aligned,
                    axis=1,
                ))))
            prior_reference_means = np.asarray(reference_model.means_)

        convergence_rate = float(np.mean([run["converged"] for run in runs]))
        minimum_training_occupancy = float(min(run["trainingMinimumOccupancy"] for run in runs))
        minimum_validation_occupancy = float(min(run["minimumOccupancy"] for run in runs))
        validation_state_coverage_rate = float(np.mean([run["minimumOccupancy"] > 0 for run in runs]))
        median_seed_agreement = float(np.median(seed_agreements)) if seed_agreements else 1.0
        maximum_switching_rate = float(max(run["switchingRate"] for run in runs))
        mean_validation_likelihood = float(np.mean([
            run["validationLogLikelihoodPerObservation"] for run in runs
        ]))
        mean_bic = float(np.mean([run["bicTraining"] for run in runs]))
        reasons: list[str] = []
        if convergence_rate < QUALIFICATION_THRESHOLDS.convergence_rate_min:
            reasons.append("HMM_CONVERGENCE_INSUFFICIENT")
        if minimum_training_occupancy < QUALIFICATION_THRESHOLDS.minimum_training_state_occupancy:
            reasons.append("HMM_STATE_COLLAPSE_OR_RARE_STATE")
        if median_seed_agreement < QUALIFICATION_THRESHOLDS.median_seed_agreement_min:
            reasons.append("HMM_MULTI_SEED_STATE_INSTABILITY")
        if maximum_switching_rate > QUALIFICATION_THRESHOLDS.maximum_switching_rate:
            reasons.append("HMM_EXCESSIVE_STATE_SWITCHING")
        candidates.append({
            "stateCount": state_count,
            "qualifiedForShadow": not reasons,
            "qualificationReasonCodes": reasons or ["HMM_SHADOW_THRESHOLDS_MET"],
            "convergenceRate": convergence_rate,
            "minimumTrainingStateOccupancy": minimum_training_occupancy,
            "minimumStateOccupancy": minimum_validation_occupancy,
            "validationRunsWithAllStatesRate": validation_state_coverage_rate,
            "medianPermutationAlignedSeedAgreement": median_seed_agreement,
            "meanPermutationAlignedFoldCentroidDistance": (
                float(np.mean(fold_centroid_distances)) if fold_centroid_distances else 0.0
            ),
            "maximumSwitchingRate": maximum_switching_rate,
            "meanValidationLogLikelihoodPerObservation": mean_validation_likelihood,
            "meanTrainingBic": mean_bic,
            "runs": runs,
        })

    qualified = [candidate for candidate in candidates if candidate["qualifiedForShadow"]]
    if not qualified:
        return candidates, None
    # Lexicographic selection avoids an invented weighted score: prioritize
    # permutation-aware stability, then fold stability, then OOS likelihood,
    # then the simpler state count.
    selected = sorted(qualified, key=lambda candidate: (
        -candidate["medianPermutationAlignedSeedAgreement"],
        candidate["meanPermutationAlignedFoldCentroidDistance"],
        -candidate["meanValidationLogLikelihoodPerObservation"],
        candidate["stateCount"],
    ))[0]
    return candidates, int(selected["stateCount"])


def fit_final_shadow_model(
    values: np.ndarray,
    plan: ChronologicalEvaluationPlan,
    state_count: int,
    *,
    seed: int = 17,
) -> tuple[GaussianHMM, StandardScaler, dict[str, Any]]:
    matrix = np.asarray(values, dtype=float)
    development = matrix[:plan.holdout_start]
    holdout = matrix[plan.holdout_start:plan.holdout_end]
    scaler = StandardScaler().fit(development)
    train_scaled = scaler.transform(development)
    holdout_scaled = scaler.transform(holdout)
    model = train_gaussian_hmm(train_scaled, state_count, seed)
    _, combined_states, total_likelihood = causal_filter(model, np.vstack([train_scaled, holdout_scaled]))
    development_states = combined_states[:len(train_scaled)]
    holdout_states = combined_states[len(train_scaled):]
    state_feature_means = []
    for state in range(state_count):
        state_rows = development[development_states == state]
        state_feature_means.append(
            [float(value) for value in np.mean(state_rows, axis=0)] if len(state_rows) else None
        )
    metrics = {
        "converged": bool(model.monitor_.converged),
        "iterations": int(model.monitor_.iter),
        "holdoutLogLikelihoodPerObservation": float(model.score(holdout_scaled) / len(holdout_scaled)),
        "causalCombinedLogLikelihoodPerObservation": float(total_likelihood / (len(train_scaled) + len(holdout_scaled))),
        "holdout": _state_metrics(holdout_states, state_count),
        "transitionMatrix": np.asarray(model.transmat_).tolist(),
        "trainingStateFeatureMeans": state_feature_means,
        "trainingAic": float(model.aic(train_scaled)),
        "trainingBic": float(model.bic(train_scaled)),
    }
    return model, scaler, metrics


def model_parameters_equal(first: GaussianHMM, second: GaussianHMM) -> bool:
    return all(np.allclose(np.asarray(left), np.asarray(right), rtol=1e-12, atol=1e-12) for left, right in (
        (first.startprob_, second.startprob_),
        (first.transmat_, second.transmat_),
        (first.means_, second.means_),
        (_diagonal_covariances(first), _diagonal_covariances(second)),
    ))


def diagonal_covariances(model: GaussianHMM) -> np.ndarray:
    return _diagonal_covariances(model).copy()
