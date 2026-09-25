"""
WealthGenie ML Microservice - Dataset Module
PyTorch Dataset class and DataLoader factory for batching, shuffling, and data splitting.
"""

from typing import Tuple, Optional
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split

from model.config import TrainingConfig
from model.data.preprocessing import FeaturePreprocessor


def create_stratified_split_indices(
    y: np.ndarray,
    config: TrainingConfig,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return deterministic, disjoint train/validation/test row indices.

    The test split is reserved first. Validation is then drawn only from the
    remaining train+validation rows, preserving the configured overall split
    fractions and class stratification.
    """
    labels = np.asarray(y)
    if labels.ndim != 1 or len(labels) < 3:
        raise ValueError("labels must be a one-dimensional array with at least three rows")
    if config.test_split + config.val_split >= 1:
        raise ValueError("train/validation/test split fractions must leave training data")

    all_indices = np.arange(len(labels), dtype=np.int64)
    train_val_indices, test_indices = train_test_split(
        all_indices,
        test_size=config.test_split,
        random_state=config.random_seed,
        stratify=labels,
    )
    validation_fraction_of_train_val = config.val_split / (1.0 - config.test_split)
    train_relative, validation_relative = train_test_split(
        np.arange(len(train_val_indices), dtype=np.int64),
        test_size=validation_fraction_of_train_val,
        random_state=config.random_seed,
        stratify=labels[train_val_indices],
    )
    train_indices = train_val_indices[train_relative]
    validation_indices = train_val_indices[validation_relative]

    if (
        len(train_indices) + len(validation_indices) + len(test_indices) != len(labels)
        or len(np.unique(np.concatenate((train_indices, validation_indices, test_indices)))) != len(labels)
    ):
        raise RuntimeError("stratified split failed to partition every row exactly once")
    return train_indices, validation_indices, test_indices


class FinancialDataset(Dataset):
    """PyTorch Dataset wrapping standardized feature matrices and target class labels."""

    def __init__(self, X: np.ndarray, y: Optional[np.ndarray] = None):
        self.X = torch.tensor(X, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.long) if y is not None else None

    def __len__(self) -> int:
        return len(self.X)

    def __getitem__(self, index: int) -> Tuple[torch.Tensor, Optional[torch.Tensor]]:
        if self.y is not None:
            return self.X[index], self.y[index]
        return self.X[index], torch.tensor(-1, dtype=torch.long)


def create_data_loaders(
    X: np.ndarray,
    y: np.ndarray,
    preprocessor: FeaturePreprocessor,
    config: TrainingConfig
) -> Tuple[DataLoader, DataLoader, DataLoader, FeaturePreprocessor]:
    """
    Splits features and targets into Train/Validation/Test sets, fits the FeaturePreprocessor,
    and returns PyTorch DataLoader objects for training, validation, and testing.
    """
    train_indices, validation_indices, test_indices = create_stratified_split_indices(y, config)
    X_train, y_train = X[train_indices], y[train_indices]
    X_val, y_val = X[validation_indices], y[validation_indices]
    X_test, y_test = X[test_indices], y[test_indices]

    # 3. Fit scaler on training set only, then transform all sets
    X_train_scaled = preprocessor.fit_transform(X_train)
    X_val_scaled = preprocessor.transform(X_val)
    X_test_scaled = preprocessor.transform(X_test)

    # 4. Create PyTorch Datasets
    train_dataset = FinancialDataset(X_train_scaled, y_train)
    val_dataset = FinancialDataset(X_val_scaled, y_val)
    test_dataset = FinancialDataset(X_test_scaled, y_test)

    # 5. Build DataLoaders
    train_loader = DataLoader(
        train_dataset, batch_size=config.batch_size, shuffle=True, drop_last=False
    )
    val_loader = DataLoader(
        val_dataset, batch_size=config.batch_size, shuffle=False, drop_last=False
    )
    test_loader = DataLoader(
        test_dataset, batch_size=config.batch_size, shuffle=False, drop_last=False
    )

    return train_loader, val_loader, test_loader, preprocessor
