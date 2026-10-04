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

Before enabling live mode, run `npm run demo:doctor --prefix server`. This is a
read-only prerequisite check: it does not authenticate, call market providers,
or invoke profile/recommendation/tax mutation endpoints. Configure
`DEMO_EXPECTED_MONGODB_DATABASE`, `DEMO_EXPECTED_MONGODB_HOST`,
`DEMO_EXPECTED_MONGODB_PORT`, and `DEMO_EXPECTED_MONGODB_ENVIRONMENT_ID` in
both the backend and preflight process. The connected database name, URI host,
and selected Mongo server port must match exactly, and the database must
contain the operator-provisioned sentinel below with that same UUIDv4
environment ID. The sentinel check is read-only; application startup and
health routes never create or repair it. This prevents a similarly named
database or a different endpoint on the same host from passing the demo gate. Reserved or
default database names such as `test`, `admin`, `config`, and `local` are
rejected. Missing or mismatched identity/sentinel blocks readiness and every
preflight provider/authenticated mutation stage.

Provision the marker only after independently confirming the target is the
disposable demo database. Its exact document in
`demo_environment_sentinels` is:

```json
{
  "_id": "wealthgenie-phase15-demo",
  "environmentId": "<operator-generated UUIDv4>",
  "purpose": "WEALTHGENIE_PHASE15_DEMO",
  "schemaVersion": 1
}
```

Use the same UUIDv4 as `DEMO_EXPECTED_MONGODB_ENVIRONMENT_ID` in both
processes. The application only reads this record and requires its exact field
set and values; an absent, unreadable, or mismatched marker is not verified.

Configure these values through a secret-aware environment mechanism; never put
credentials or financial payloads in shell history, source control, or logs:

- `DEMO_LIVE_PREFLIGHT=1` — explicit opt-in.
- `DEMO_API_BASE_URL` — backend API URL ending in `/api`; remote URLs must use
  HTTPS and the exact origin must appear in `DEMO_TRUSTED_REMOTE_ORIGINS`.
  Defaults to local `http://127.0.0.1:5000/api`.
- `DEMO_FRONTEND_URL` — the running frontend origin; remote URLs must use HTTPS
  and the exact origin must appear in `DEMO_TRUSTED_REMOTE_ORIGINS`.
- `DEMO_TRUSTED_REMOTE_ORIGINS` — optional comma-separated exact HTTPS origins
  approved for this disposable demo, such as `https://demo.example`; it does
  not accept paths, query strings, credentials, wildcards, or plain HTTP. Local
  loopback URLs do not require this allowlist. Browser traffic is restricted to
  the configured frontend and backend origins before login credentials are
  entered.
- `DEMO_EXPECTED_MONGODB_DATABASE` — exact isolated database name expected from
  the live backend connection; configure the same value in both processes.
- `DEMO_EXPECTED_MONGODB_HOST` — exact Mongo URI host expected from the live
  backend connection; configure the same host in both processes.
- `DEMO_EXPECTED_MONGODB_PORT` — exact TCP port of the selected live Mongo
  server (normally `27017`); configure the same port in both processes. The
  preflight requires an exact match and does not infer a port from the host.
- `DEMO_EXPECTED_MONGODB_ENVIRONMENT_ID` — UUIDv4 that matches the isolated
  database's out-of-band `demo_environment_sentinels` marker; not a secret,
  but unique to this disposable demo environment.
- `DEMO_EMAIL` and `DEMO_PASSWORD` — disposable demo login credentials.
- `DEMO_PROFILE_COMPLETION_FILE` — path to a JSON profile-completion request
  body, stored outside the repository.
- `DEMO_COMPLETION_IDEMPOTENCY_KEY` — stable key for that exact completion body.
- `DEMO_NIFTY_ETF_PARENT_ID` — a parent instrument present in the current
  authoritative recommendation and eligible for the exact NIFTY-50 ETF query.
- `DEMO_TAX_CONTEXT_FILE` — path to explicit JSON tax facts, stored outside the
  repository. The server validates and calculates; the preflight does not
  synthesize tax inputs. For the exact NIFTYBEES historical illustration, the
  scenario must explicitly include `sttConditionAssumedSatisfied: true` to
  model the applicable transfer-level STT condition. This is an assumption for
  a hypothetical transfer, not verification that an actual transaction meets
  the statutory condition; omit it or set it false to keep the calculation
  unavailable.
- `MONGODB_URI` — isolated replica-set demo database URI. The transaction check
  itself is read-only, but profile completion is not.
- `REDIS_URL` — required when production runtime policy or `DEMO_REQUIRE_REDIS`
  requires Redis. Demo settings cannot disable the production requirement.
- Provider credentials such as `UPSTOX_ACCESS_TOKEN`, when that qualified
  provider is intentionally configured. Values are never printed.

The running frontend must be built/configured to call the same API origin as
`DEMO_API_BASE_URL`. The check fails if the browser calls a financial provider
directly; provider access belongs to the backend.
The production-build check writes to a unique temporary directory and removes
it afterward; it does not overwrite the normal `reactapp/dist` output.

The preflight intentionally fails closed if a current, exact, source-qualified
NIFTY-50 ETF result and its requested-fiscal-year tax calculation are not
available. It does not substitute an index, mutual fund, stale cache, static
catalog value, or inferred tax treatment. A successful preflight is evidence
for that specific configured demo environment and observation window only; it
does not establish universal provider uptime or production availability.

Market readiness is session-aware and uses the backend's NSE trading-calendar
contract. During `MARKET_OPEN`, only current-date fresh quotes and coherent
source-qualified history pass. On `MARKET_HOLIDAY`, the official current-date
session check, matching NIFTY/VIX observations, and history must identify the
same latest completed trading session; the preflight labels these as completed
session observations, not intraday quotes. `MARKET_CLOSED` passes only after a
weekday's regular close when today's completed close is verified. Unknown,
stale, pre-market, weekend-only, mixed-provider, and last-known-good evidence
does not pass. If a selected provider does not expose the backend's qualified
NSE session provenance, market-context readiness remains unverified.

The current exact-product WTI path is intentionally limited to the Nippon India
ETF Nifty 50 BeES identity (AMFI scheme code `140084`, ISIN `INF204KB14I2`, NSE
symbol `NIFTYBEES`). Scheme identity and NIFTY 50 benchmark linkage are backed
by official NSE/issuer disclosures; current NAV is sourced from AMFI and is
shown separately from exchange price. No exchange price, ETF risk/access
classification, or generic ETF tax class is inferred. The exact product's
equity-oriented classification is bound to Nippon India's Scheme Information
Document dated 2025-11-28. The statutory calculation uses the existing
FY2026-27 Income-tax Act, 2025 policy and requires the explicit scenario STT
assumption above. The tax result remains a historical illustration, not the
user's realized gain or a forecast. Preflight still fails closed if identity,
product evidence, policy provenance, financial-state binding, or required tax
scenario facts do not match.
