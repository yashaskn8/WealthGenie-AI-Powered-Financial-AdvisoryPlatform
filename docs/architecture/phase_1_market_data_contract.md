# Phase 1 market-data contract

## Provider-neutral benchmark identity

NIFTY 50 and India VIX use stable canonical identities independent of the
active source. NSE and optional Upstox adapters map their own source instrument
keys into those identities before data reaches downstream feature or policy
code. Provider timestamps, effective trading date, data class, fetch time,
freshness, and public provenance remain distinct normalized fields.

## Upstox Full Market Quotes V3

`metrics.previousClose` maps only from the top-level V3 field `prev_close_price`.
It must not be inferred from `ohlc.close`, because that field is the close value
inside the current trading-session OHLC object.

## AMFI NAVAll

AMFI `NAVAll.txt` formats may omit separate `Plan` and `Option` columns. The
header-driven parser therefore returns `plan: null` and `option: null` when the
source does not provide those fields. Phase 2 must treat either null as an
unestablished classification; it must not infer Direct/Regular or
Growth/Dividend from the scheme name without a separately qualified rule and
provenance.
