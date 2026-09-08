# Phase 4 Market-Regime ML Qualification

Generated: 2026-09-08T16:13:12.921579Z

## Decision

- Final decision: `DETERMINISTIC_CHAMPION_HMM_SHADOW`
- Production champion: `market-context-policy-1.0.0` (unchanged)
- HMM status: `SHADOW`
- ML allocation authority: **NO**

## Data

- Source: `NSE` via the Express normalized provider boundary
- Period: `2021-09-08` to `2026-09-07`
- Matched completed sessions: `1239`
- Usable causal feature rows: `1040`
- Dataset: `market-regime-dataset-1.0.0+sha256:958f1d9a072ede61`
- SHA-256: `958f1d9a072ede6169973da93949aba5c894db4d41b25ad5a4b018c3ac5cccad`
- Missing observations: `{"indiaVixWithoutNifty50": 0, "nifty50WithoutIndiaVix": 0, "policy": "INNER_JOIN_NO_IMPUTATION_NO_FORWARD_FILL"}`

No missing trading session was interpolated, forward-filled, or synthesized.

## Features

Feature schema: `market-regime-features-1.0.0`. All rolling windows are trailing and include only day t or earlier.

| Feature | Unit | Lookback | Calculation |
|---|---:|---:|---|
| `daily_log_return` | DECIMAL | 1 | ln(NIFTY_close_t / NIFTY_close_t-1) |
| `return_5d` | DECIMAL | 5 | NIFTY_close_t / NIFTY_close_t-5 - 1 |
| `return_20d` | DECIMAL | 20 | NIFTY_close_t / NIFTY_close_t-20 - 1 |
| `realized_volatility_20d` | ANNUALIZED_DECIMAL | 20 | sample_std(last 20 daily log returns through t) * sqrt(252) |
| `drawdown_60d` | DECIMAL | 60 | NIFTY_close_t / max(NIFTY_high over trailing 60 sessions through t) - 1 |
| `price_vs_ma50` | DECIMAL | 50 | NIFTY_close_t / trailing_mean_50(close through t) - 1 |
| `price_vs_ma200` | DECIMAL | 200 | NIFTY_close_t / trailing_mean_200(close through t) - 1 |
| `india_vix_level` | INDEX_POINTS | 1 | Verified India VIX close at t |

## Chronological evaluation

- Walk-forward folds: `3`
- Untouched holdout: `2025-09-02` to `2026-09-07`
- Random shuffle: `NO`
- Scaling: fit independently on each fold's training window; final scaler fit on development rows only
- Supervised purge/embargo: not applicable because no supervised target was qualified

| States | Shadow gate | Convergence | Min training occupancy | Median seed agreement | Max switching | Validation log likelihood/row |
|---:|---|---:|---:|---:|---:|---:|
| 2 | True | 1.000 | 0.374 | 1.000 | 0.060 | -10.5806 |
| 3 | True | 1.000 | 0.258 | 0.982 | 0.120 | -10.0398 |
| 4 | True | 1.000 | 0.032 | 0.988 | 0.108 | -9.6035 |

State numbers remain `STATE_0..N`; no bull/bear/crash semantics were forced. Historical evaluation uses causal filtering, not retrospective smoothing.

The shadow gate requires every fit to converge, at least 1% training occupancy per state, median permutation-aligned seed agreement of at least 70%, and no validation switching rate above 35%. These are explicit anti-degeneracy/stability bounds rather than a weighted ranking score. Among models clearing the gate, selection is lexicographic: seed stability, fold-centroid stability, out-of-sample likelihood, then fewer states. A state may legitimately be absent from a short validation window; that fact is disclosed as validation state coverage rather than concealed or treated as synthetic occupancy.

The selected two-state artifact converged in 35 iterations. On the untouched 252-session holdout its per-observation log likelihood was `-12.7968`, state occupancy was `64.29% / 35.71%`, switching frequency was `4.78%`, and mean state durations were `23.14 / 15.00` sessions. These are stability diagnostics, not investment-performance results. Training-period state characteristics are recorded in the machine-readable report, but no semantic market labels are assigned.

## Supervised challengers

`XGBOOST_SUPERVISED_LABELS_NOT_QUALIFIED`: no externally justified forward-risk bucket thresholds were established. Training XGBoost on deterministic policy outputs would measure imitation, so XGBoost and LightGBM were not added.

## Recommendation safety

The HMM route is shadow-only and has no allocation mutation path. The existing deterministic context, hysteresis, bounded adjustment, suitability re-validation, concentration re-validation, and no-new-instrument checks remain unchanged.

Observed Phase-4 allocation attempts, tactical turnover, suitability violations, concentration violations, and new-instrument introductions were all zero because shadow output is structurally excluded from the adjustment path. Missing/corrupt/schema-mismatched artifacts return `MODEL_CONTEXT_UNAVAILABLE`; they do not invent `NORMAL` or any other market state.

## Model comparison and registry

The deterministic policy remains champion because it is causal, transparent, already integrated with hysteresis and verified safety boundaries, and operationally independent of a model artifact. The two-state HMM is retained only as a challenger in shadow mode. The registry disables automatic promotion and records the feature/dataset versions, train-only preprocessing, hyperparameters, validation and holdout diagnostics, Python/library versions, seed, creation time, immutable artifact filename, and SHA-256 checksum.

Artifact: `gaussian-hmm-market-context-1.0.0.npz` (`SHA-256 8796f024ab0a1d707585212a3dc79f969993909cb658e7a07a0397ac49cf1463`).

Reproduction uses a new output directory because registry artifacts are immutable:

```powershell
npm run export:market-regime-data --prefix server -- --from 2021-09-08 --to 2026-09-07 --output <temporary-normalized-json> --force-refresh true
Set-Location ml-service
python -m market_context.qualification --dataset <temporary-normalized-json> --artifact-directory <new-artifact-directory> --report-json <new-report.json> --report-markdown <new-report.md>
```

The normalized raw dataset is intentionally not committed. Its version, period, row count, source identities, and content hash are retained in the report and registry.

## Phase-3 live regression qualification

After Phase 4, `npm run qualify:nse` passed against the live official NSE source. NIFTY 50, India VIX, previous close, 271 daily NIFTY candles, MA50, MA200, freshness, Redis cache, request coalescing, and `/api/regime/current` signal parity all passed. The evidence-derived candidate and published deterministic context were both `CAUTIOUS`; no threshold was changed to produce that result.

## Limitations

- The official NSE website history schema is validated but not a versioned contractual API.
- The reliable joined qualification period is five years; a ten-year India VIX retrieval did not qualify reliably.
- HMM states are unsupervised numeric clusters and have no claimed bull/bear/crash meaning.
- HMM probabilities are uncalibrated and intentionally not exposed as confidence.
- Drift output is diagnostic raw PSI/KS data with no automatic retraining or promotion.
- No investment-performance or excess-return claim is made.
