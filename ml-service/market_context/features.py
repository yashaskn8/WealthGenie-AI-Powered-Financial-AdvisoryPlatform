"""Strict normalized-dataset validation and causal market features."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd

from . import FEATURE_SCHEMA_VERSION

DATASET_SCHEMA_VERSION = "market-regime-dataset-1.0.0"
MARKET_DATA_SCHEMA_VERSION = "market-fact-1.0.0"


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    unit: str
    lookback_sessions: int
    calculation: str
    causality: str = "Uses observations at or before trading day t only."
    missing_value_policy: str = "Drop until lookback is complete; never impute or forward-fill."


FEATURE_SPECS = (
    FeatureSpec("daily_log_return", "DECIMAL", 1, "ln(NIFTY_close_t / NIFTY_close_t-1)"),
    FeatureSpec("return_5d", "DECIMAL", 5, "NIFTY_close_t / NIFTY_close_t-5 - 1"),
    FeatureSpec("return_20d", "DECIMAL", 20, "NIFTY_close_t / NIFTY_close_t-20 - 1"),
    FeatureSpec(
        "realized_volatility_20d",
        "ANNUALIZED_DECIMAL",
        20,
        "sample_std(last 20 daily log returns through t) * sqrt(252)",
    ),
    FeatureSpec(
        "drawdown_60d",
        "DECIMAL",
        60,
        "NIFTY_close_t / max(NIFTY_high over trailing 60 sessions through t) - 1",
    ),
    FeatureSpec("price_vs_ma50", "DECIMAL", 50, "NIFTY_close_t / trailing_mean_50(close through t) - 1"),
    FeatureSpec("price_vs_ma200", "DECIMAL", 200, "NIFTY_close_t / trailing_mean_200(close through t) - 1"),
    FeatureSpec("india_vix_level", "INDEX_POINTS", 1, "Verified India VIX close at t"),
)
FEATURE_NAMES = tuple(spec.name for spec in FEATURE_SPECS)


def feature_specification() -> list[dict[str, Any]]:
    return [asdict(spec) for spec in FEATURE_SPECS]


def _canonical_dataset_hash(dataset: dict[str, Any]) -> str:
    payload = {
        "schemaVersion": dataset.get("schemaVersion"),
        "marketDataSchemaVersion": dataset.get("marketDataSchemaVersion"),
        "source": "NSE",
        "rows": dataset.get("rows"),
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_normalized_dataset(dataset: dict[str, Any]) -> None:
    if dataset.get("schemaVersion") != DATASET_SCHEMA_VERSION:
        raise ValueError("MARKET_REGIME_DATASET_SCHEMA_MISMATCH")
    if dataset.get("marketDataSchemaVersion") != MARKET_DATA_SCHEMA_VERSION:
        raise ValueError("MARKET_DATA_SCHEMA_MISMATCH")
    if dataset.get("source", {}).get("provider") != "NSE":
        raise ValueError("MARKET_REGIME_DATASET_SOURCE_UNQUALIFIED")
    rows = dataset.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("MARKET_REGIME_DATASET_ROWS_MISSING")
    if dataset.get("rowCount") != len(rows):
        raise ValueError("MARKET_REGIME_DATASET_ROW_COUNT_MISMATCH")
    expected_hash = dataset.get("contentHash")
    if not isinstance(expected_hash, str) or _canonical_dataset_hash(dataset) != expected_hash:
        raise ValueError("MARKET_REGIME_DATASET_HASH_MISMATCH")


def _positive_finite(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"INVALID_MARKET_OBSERVATION:{field}") from exc
    if not np.isfinite(number) or number <= 0:
        raise ValueError(f"INVALID_MARKET_OBSERVATION:{field}")
    return number


def _validate_leg(leg: Any, prefix: str) -> dict[str, Any]:
    if not isinstance(leg, dict):
        raise ValueError(f"INVALID_MARKET_OBSERVATION:{prefix}")
    values = {name: _positive_finite(leg.get(name), f"{prefix}.{name}") for name in ("open", "high", "low", "close")}
    if values["high"] < max(values["open"], values["close"], values["low"]):
        raise ValueError(f"INVALID_MARKET_OBSERVATION:{prefix}.high")
    if values["low"] > min(values["open"], values["close"], values["high"]):
        raise ValueError(f"INVALID_MARKET_OBSERVATION:{prefix}.low")
    observed_at = pd.to_datetime(leg.get("observedAt"), utc=True, errors="coerce")
    if pd.isna(observed_at):
        raise ValueError(f"INVALID_MARKET_OBSERVATION:{prefix}.observedAt")
    return {**values, "observed_at": observed_at}


def build_feature_frame(dataset: dict[str, Any]) -> pd.DataFrame:
    """Build features without centered windows, imputation, or full-dataset fitting."""
    validate_normalized_dataset(dataset)
    normalized: list[dict[str, Any]] = []
    prior_date: pd.Timestamp | None = None
    for index, row in enumerate(dataset["rows"]):
        effective_date = pd.to_datetime(row.get("effectiveTradingDate"), format="%Y-%m-%d", errors="coerce")
        if pd.isna(effective_date):
            raise ValueError(f"INVALID_MARKET_OBSERVATION:rows[{index}].effectiveTradingDate")
        if prior_date is not None and effective_date <= prior_date:
            raise ValueError("MARKET_OBSERVATIONS_NOT_STRICTLY_CHRONOLOGICAL")
        prior_date = effective_date
        nifty = _validate_leg(row.get("nifty50"), f"rows[{index}].nifty50")
        vix = _validate_leg(row.get("indiaVix"), f"rows[{index}].indiaVix")
        normalized.append({
            "effective_trading_date": effective_date,
            "observed_at": max(nifty["observed_at"], vix["observed_at"]),
            "nifty_open": nifty["open"],
            "nifty_high": nifty["high"],
            "nifty_low": nifty["low"],
            "nifty_close": nifty["close"],
            "india_vix_close": vix["close"],
        })

    frame = pd.DataFrame(normalized)
    close = frame["nifty_close"]
    log_return = np.log(close / close.shift(1))
    frame["daily_log_return"] = log_return
    frame["return_5d"] = close.pct_change(5, fill_method=None)
    frame["return_20d"] = close.pct_change(20, fill_method=None)
    frame["realized_volatility_20d"] = log_return.rolling(20, min_periods=20).std(ddof=1) * np.sqrt(252)
    frame["drawdown_60d"] = (close / frame["nifty_high"].rolling(60, min_periods=60).max()) - 1
    frame["price_vs_ma50"] = (close / close.rolling(50, min_periods=50).mean()) - 1
    frame["price_vs_ma200"] = (close / close.rolling(200, min_periods=200).mean()) - 1
    frame["india_vix_level"] = frame["india_vix_close"]
    usable = frame.dropna(subset=list(FEATURE_NAMES)).reset_index(drop=True)
    if not np.isfinite(usable.loc[:, list(FEATURE_NAMES)].to_numpy(dtype=float)).all():
        raise ValueError("NON_FINITE_CAUSAL_FEATURE")
    usable.attrs.update({
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "dataset_version": dataset["datasetVersion"],
        "dataset_hash": dataset["contentHash"],
        "raw_row_count": dataset["rowCount"],
        "source": dataset["source"],
    })
    return usable
