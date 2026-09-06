"""Canonical RandomForest training entry point.

The pre-v4 bespoke dataset and labeler formerly in this module used annual
gross-income semantics and a hidden goal taxonomy. Keeping a second trainer
would make stale artifacts easy to recreate, so every invocation delegates to
the versioned v4 trainer.
"""

from model.training.train_rf import train_random_forest_model


def train_model(num_samples: int = 20_000, seed: int = 42):
    return train_random_forest_model(num_samples=num_samples, seed=seed)


if __name__ == "__main__":
    train_model()
