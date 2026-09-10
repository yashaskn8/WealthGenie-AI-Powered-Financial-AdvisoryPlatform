# Phase 3 verified live market context

## Scope and authority

Phase 3 replaces the static current-regime and sector-tilt authority with a
server-side pipeline built only from verified, normalized provider observations.
It does not contain HMM/XGBoost, an LLM/NIM decision, a forecast, or an
execution path.

The default provider is NSE. Upstox remains an optional adapter selected only
when `MARKET_DATA_PRIMARY_PROVIDER=UPSTOX`; it is not required for normal app
startup. Both adapters terminate their provider-specific payloads at the same
normalized market-fact contract, so the feature, policy, hysteresis,
recommendation-safety, and frontend layers do not understand raw NSE or Upstox
response shapes.

## NSE source qualification

The following public endpoints are hosted on the official `nseindia.com`
domain and require no account, PAN, broker relationship, API key, or cookie in
the qualified server-side flow:

- `https://www.nseindia.com/api/allIndices` supplies the current NIFTY 50 and
  India VIX observations, the NIFTY previous-session close, and a provider
  market timestamp in one response.
- `https://www.nseindia.com/api/historicalOR/indicesHistory` supplies NIFTY 50
  daily OHLC observations. The adapter downloads only the bounded history
  required by the feature engine, split into at most 90-calendar-day requests.
- `https://www.nseindia.com/api/holiday-master?type=trading` supplies the
  current exchange capital-market holiday calendar used by freshness checks.

These are official NSE website JSON endpoints, but they are not represented as
a guaranteed, versioned public API contract. Their qualification is therefore
`OFFICIAL_NSE_WEBSITE_ENDPOINT_UNDOCUMENTED_SCHEMA_VALIDATED`. The adapter uses
strict field and OHLC validation and fails closed on contract drift. It uses a
normal browser User-Agent, JSON accept headers, bounded timeouts, at most two
attempts for transient failures, and no headless browser or cookie harvesting.

The quote class is `LIVE`: the endpoint exposes current intraday index values
during the session and the provider timestamp is retained separately from
`fetchedAt`. Daily history is classed `DAILY`. Neither class is inferred from
fetch time, and the frontend renders the returned provenance rather than a
hardcoded provider label.

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

## Additive market snapshot contract

The market-context endpoint now also returns a `marketSnapshot` envelope with
schema version `market-snapshot-1.0.0`. This is an additive presentation
contract; the existing top-level policy fields remain available for backward
compatibility.

The envelope keeps three data-plane layers separate:

- `observedFacts`: provider observations such as the current NIFTY 50 value,
  previous close, and India VIX, each retaining source, observed time, fetch
  time, and freshness;
- `derivedFacts`: deterministic returns, drawdown, volatility, and moving
  averages, each naming its calculation basis and evidence inputs;
- `policyOutput`: the versioned deterministic market-context classification.

The semantic classes `OBSERVED`, `DERIVED`, and `POLICY_OUTPUT` are separate
from provider `dataClass` values such as `LIVE` and `DAILY`. A provider class
therefore cannot be mistaken for a policy decision or a derived return.

The backend supplies the frontend display state rather than asking React to
infer it: `CURRENT`, `MARKET_CLOSED`, `LAST_AVAILABLE`, `STALE`,
`PARTIAL_DATA`, or `UNAVAILABLE`. Outside a verified session, a complete
snapshot is shown as `LAST_AVAILABLE` rather than being called current. The
NSE adapter explicitly reports `MARKET_OPEN`, `MARKET_CLOSED`, or
`MARKET_HOLIDAY` when the exchange calendar is established. The closed state
means the last verified session may be displayed; it is not a new quote.

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
Qualified quote/history observations and the published snapshot are also
written to the durable `MarketObservation` store. Recovery order is newest
verified provider evidence, durable observation, Redis hot cache, then process
memory. Recovered evidence is always re-aged: old evidence is never relabelled
`CURRENT`, and observation age is kept separate from cache age. Unavailable
observations do not update state.

Adjustment version `market-context-adjustment-1.0.0` transfers at most 0, 2, 4,
or 5 percentage points for `NORMAL`, `CAUTIOUS`, `HIGH_VOLATILITY`, and
`RISK_OFF`, respectively. Transfer is only from higher-risk instruments to the
lowest-risk instruments already present in the latest server-owned
recommendation. The service rejects client weights/context, never adds an
instrument, and re-runs hard Financial Profile suitability, risk-ceiling,
normalization, and concentration-cap checks. The endpoint is a non-persisted
preview and cannot execute trades.

## Cost, cache, refresh, and failure behavior

Benchmark quotes use one official all-indices response, normalized down to only
NIFTY 50 and India VIX, and the existing 60-second Redis/coalescing cache. The
bounded daily-history requests share one six-hour Redis/coalescing cache entry.
The trading-holiday calendar is cached for 24 hours. A single-flight,
session-aware refresh job runs about every eight minutes during an open NSE
session, backs off to thirty minutes while closed, and backs off to two hours
on an established holiday. It refreshes quotes and evaluates context; it does
not stream or persist ticks. No paid vendor, account dependency, GPU, new
microservice, headless browser, or websocket was introduced.

An explicitly selected but unconfigured optional Upstox adapter returns
`PROVIDER_NOT_CONFIGURED`. NSE source errors, holiday-calendar failures, stale
NIFTY/VIX/history, missing VIX or previous close, malformed rows, conflicting
duplicates, and fewer than fifty valid candles remain explicit unavailable
states with null values. There is no hardcoded market-value, regime, or
financial-value fallback.
