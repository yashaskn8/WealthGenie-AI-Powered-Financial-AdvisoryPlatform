"""Offline GEPA run boundary. It accepts sanitized fixtures only."""

from .schemas import validate_optimizer_dataset


def run_gepa(*, optimizer, student, trainset, valset, metric):
    validate_optimizer_dataset(trainset)
    validate_optimizer_dataset(valset)
    return optimizer.optimize(student, trainset, valset, metric)
