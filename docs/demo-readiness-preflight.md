# Live-demo readiness preflight

`npm run demo:preflight --prefix server` is an explicit operator gate, not a
mocked test. It is inert unless `DEMO_LIVE_PREFLIGHT=1` is set. When enabled,
it checks the configured live API, readiness and transaction-capable MongoDB,
Redis when required, current NIFTY/VIX and market-context provenance, verified
tax-policy metadata, a real authenticated browser/profile-completion path,
current recommendation binding, exact-product ranking/tax provenance, and a
production frontend build.

Run it only with a disposable demonstration account and an isolated demo
database. Profile completion is a real authenticated mutation and may commit a
profile/recommendation. Use a stable idempotency key for retries of the same
completion payload; use a new key if the payload changes. Do not use customer
credentials, customer profile facts, or a production database.

Configure these values through a secret-aware environment mechanism; never put
credentials or financial payloads in shell history, source control, or logs:

- `DEMO_LIVE_PREFLIGHT=1` — explicit opt-in.
- `DEMO_API_BASE_URL` — backend API URL ending in `/api`; remote URLs must use
  HTTPS. Defaults to local `http://127.0.0.1:5000/api`.
- `DEMO_FRONTEND_URL` — the running frontend origin; remote URLs must use HTTPS.
- `DEMO_EMAIL` and `DEMO_PASSWORD` — disposable demo login credentials.
- `DEMO_PROFILE_COMPLETION_FILE` — path to a JSON profile-completion request
  body, stored outside the repository.
- `DEMO_COMPLETION_IDEMPOTENCY_KEY` — stable key for that exact completion body.
- `DEMO_NIFTY_ETF_PARENT_ID` — a parent instrument present in the current
  authoritative recommendation and eligible for the exact NIFTY-50 ETF query.
- `DEMO_TAX_CONTEXT_FILE` — path to explicit JSON tax facts, stored outside the
  repository. The server validates and calculates; the preflight does not
  synthesize tax inputs.
- `MONGODB_URI` — isolated replica-set demo database URI. The transaction check
  itself is read-only, but profile completion is not.
- `REDIS_URL` — required when production runtime policy or `DEMO_REQUIRE_REDIS`
  requires Redis. Demo settings cannot disable the production requirement.
- Provider credentials such as `UPSTOX_ACCESS_TOKEN`, when that qualified
  provider is intentionally configured. Values are never printed.

The running frontend must be built/configured to call the same API origin as
`DEMO_API_BASE_URL`. The check fails if the browser calls a financial provider
directly; provider access belongs to the backend.

The preflight intentionally fails closed if a current, exact, source-qualified
NIFTY-50 ETF result and its requested-fiscal-year tax calculation are not
available. It does not substitute an index, mutual fund, stale cache, static
catalog value, or inferred tax treatment. A successful preflight is evidence
for that specific configured demo environment and observation window only; it
does not establish universal provider uptime or production availability.

The current exact-product WTI path is intentionally limited to the Nippon India
ETF Nifty 50 BeES identity (AMFI scheme code `140084`, ISIN `INF204KB14I2`, NSE
symbol `NIFTYBEES`). Scheme identity and NIFTY 50 benchmark linkage are backed
by official NSE/issuer disclosures; current NAV is sourced from AMFI and is
shown separately from exchange price. No exchange price, ETF risk/access
classification, or exact-product tax class is inferred. Accordingly, the live
preflight will continue to fail its exact-product tax check until an
independently qualified tax adapter and required product facts exist.
