# Phase 3 verified live market context

## Scope and authority

Phase 3 replaces the static current-regime and sector-tilt authority with a
server-side pipeline built only from qualified Upstox observations. It does not
contain HMM/XGBoost, an LLM/NIM decision, a forecast, or an execution path.

The data sources are Upstox Full Market Quotes V3 for the batched NIFTY 50 and
India VIX observations, and Upstox Historical Candle Data V3 for one bounded
NIFTY 50 daily-candle window. The Analytics Token is read only from server
environment variables. It is never sent to the browser, response provenance,
cache key, or logs.

## Deterministic features

The feature engine publishes values with units, calculation basis, source,
observation time, fetch time, and freshness:

- NIFTY 50 current quote and V3 top-level previous-session close;
- India VIX current quote;
- current-to-previous-close one-day return;
- current-to-completed-close five-day and twenty-day returns;
- drawdown from the maximum daily high in up to 252 completed sessions;
- annualized sample standard deviation of twenty daily log returns using
  `sqrt(252)`;
- mean of fifty completed daily closes and current price versus that mean;
- mean of two hundred completed daily closes and current price versus that mean,
  only when at least two hundred verified candles exist.

At least fifty valid candles are required for any available context. The
200-day values remain explicitly unavailable when the shorter minimum is met.

## Versioned policy

Classification is `DETERMINISTIC_POLICY_HEURISTIC`, policy version
`market-context-policy-1.0.0`. These are transparent MVP engineering policy
thresholds. They are not statistically fitted, learned, predictive, or claimed
to be optimal.

Rules are evaluated in this order:

1. `RISK_OFF`: drawdown is at or below -10%, twenty-day return is at or below
   -5%, and current price is below MA50.
2. `HIGH_VOLATILITY`: India VIX is at or above 25, or annualized twenty-day
   realized volatility is at or above 30%.
3. `CAUTIOUS`: India VIX is at or above 20, drawdown is at or below -5%,
   twenty-day return is at or below -3%, or current price is below MA50.
4. `NORMAL`: none of the above.

Confidence is `null`. Required missing or stale evidence makes the entire
context `MARKET_CONTEXT_UNAVAILABLE`; it never produces a default `NORMAL`.

## Hysteresis and adjustment safety

The first complete observation initializes state. A worse context requires two
distinct observation fingerprints; a recovery requires three. Re-reading the
same observation does not advance confirmation. State uses Redis with a
seven-day TTL and process memory only as a single-instance continuity fallback.
Unavailable observations do not update state.

Adjustment version `market-context-adjustment-1.0.0` transfers at most 0, 2, 4,
or 5 percentage points for `NORMAL`, `CAUTIOUS`, `HIGH_VOLATILITY`, and
`RISK_OFF`, respectively. Transfer is only from higher-risk instruments to the
lowest-risk instruments already present in the latest server-owned
recommendation. The service rejects client weights/context, never adds an
instrument, and re-runs hard Financial Profile suitability, risk-ceiling,
normalization, and concentration-cap checks. The endpoint is a non-persisted
preview and cannot execute trades.

## Cost, cache, refresh, and failure behavior

Benchmark quotes use one two-instrument request and the existing 60-second
Redis/coalescing cache. The bounded daily-history request uses a six-hour
Redis/coalescing cache. The existing two-hour periodic job refreshes quotes and
evaluates context; it does not stream or persist ticks. No paid vendor, GPU,
new microservice, or websocket was introduced.

Missing configuration returns `PROVIDER_NOT_CONFIGURED`. Source errors, stale
NIFTY/VIX/history, missing VIX or previous close, malformed rows, and fewer than
fifty valid candles remain explicit reason codes with null/unavailable values.
There is no hardcoded market-value, regime, or financial-value fallback.
