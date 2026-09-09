# Phase 7 Final End-to-End Acceptance

Date: 2026-09-09

Initial Phase 7 HEAD: `d7a652c4e939dd0817f664ea3ad5745121b0862b`

Release decision: **RELEASE_READY_WITH_DOCUMENTED_NON_BLOCKING_LIMITATIONS**

## Final architecture

The accepted authority path is:

`Financial Profile -> hard suitability gate -> eligible parent universe -> verified product facts -> provider-neutral normalization -> deterministic comparison/ranking -> verified NSE facts -> deterministic feature engine -> champion market policy -> hysteresis -> bounded adjustment -> suitability/concentration revalidation -> persisted backend recommendation -> presentation-only frontend`

Supporting boundaries remain intact:

- AMFI supplies observed mutual-fund NAV and history evidence.
- India Post/government sources supply effective-interval small-savings facts.
- SBI supplies official comparable term-deposit facts.
- The Phase 4 HMM is a CPU-only shadow diagnostic and has no allocation authority.
- Tax is calculated only from explicit user input and fiscal-year-versioned backend rules.
- Projection returns are versioned WealthGenie model assumptions, never provider forecasts.
- Monte Carlo values are simulated outputs.
- LLM providers may explain a frozen evidence packet, but cannot select products, change weights, calculate tax, supply rates, browse, or mutate a profile.

Architecture degraded: **NO**.

## Authority matrix

| Value | Authority | Required semantic class |
|---|---|---|
| Profile facts | User input plus backend schema/version checks | `FINANCIAL_PROFILE` |
| Suitability tier | Backend risk/suitability engine | deterministic derived state |
| Eligible instruments | Backend hard suitability gate | policy result |
| Mutual-fund NAV | AMFI | observed product fact |
| Trailing 1Y mutual-fund return | AMFI NAV history plus deterministic derivation | historical fact, never expected return |
| Government scheme rate | Official effective-interval source | official published rate |
| SBI deposit rate | Official SBI tenure/rate table | official bank-published rate |
| NIFTY 50 and India VIX | NSE provider adapter | observed market fact |
| Market features | Deterministic feature engine | derived market fact |
| Published market context | Deterministic policy plus hysteresis | champion policy state |
| HMM state | Committed Phase 4 artifact | shadow diagnostic only |
| Projection rate | Versioned WealthGenie policy table | `MODEL_ASSUMPTION` |
| Monte Carlo bands | Seeded simulation engine | `SIMULATED` |
| Tax result | Explicit tax facts plus fiscal-year policy | calculated result |
| Narrative | Grounded explanation service over immutable evidence | explanation only |

Null and unavailable values remain null/unavailable. No provider value, trailing return, or client field can become portfolio authority through an alternate path.

## Acceptance environment

- Windows local acceptance host, Node.js 24.11.1 and Python 3.12.
- MongoDB 8.0 replica set `rs0` on an isolated local port for the real browser lifecycle.
- Express API, FastAPI ML service, and Vite frontend ran as separate local processes.
- The final browser lifecycle deliberately ran with Redis unavailable, exercising designed cache degradation. Redis cache/coalescing behavior was separately covered by integration tests and live provider qualification.
- Chromium/Playwright exercised the restored frontend against the real local services.
- No provider or LLM credential was exposed in commands, logs, documentation, or the frontend bundle.

## Provider qualification summary

### NSE

Live qualification passed against current NSE observations. The normalized snapshot contained:

- NIFTY 50: `23491.1`; previous close: `23635.1`.
- India VIX: `11.72`; previous close: `11.23`.
- Provider observation: `2026-09-09T09:20:00Z`; fetch: `2026-09-09T09:21:07Z`; freshness `FRESH` at 67 seconds.
- 272 valid completed daily candles from 2025-08-04 through 2026-09-08.
- 1D return `-0.609263%`; 5D `-1.770269%`; 20D `-3.866639%`.
- Recent drawdown `-10.928139%`; 20-session realized volatility `5.665172%`.
- MA50 `24196.319`; MA200 `24583.89875`.
- Price versus MA50 `-2.914571%`; price versus MA200 `-4.445181%`.
- Current evidence-derived context: `CAUTIOUS`.

The live route matched the forced provider snapshot. Quote/history cache hits and request coalescing passed. The current NSE public website contract is normalized only inside the provider adapter and fails closed on schema drift.

### AMFI

Live qualification parsed 14,348 schemes, including 14,107 positive NAV observations. Source-established null Plan/Option values remained null; scheme names were not parsed to infer those classifications. A representative large-cap request returned five verified Direct + Growth products ranked only within its defensible comparison universe. NAV and trailing historical return remained observed/derived historical facts; neither became an expected return. FMPs remain comparison-only.

### India Post / government and SBI

Live fixed-income qualification returned 12 current government/small-savings records and 16 SBI term-deposit records with official source, effective-date/tenure metadata, and freshness. No static fallback rate was used. SBI options were compared only within compatible tenure/customer classes; no cross-tenure “best FD” claim was produced.

### NVIDIA NIM

`BLOCKED_MISSING_ROTATED_NVIDIA_API_KEY`. A previously exposed key was not used. No live NIM claim is made. Provider-failure, fallback ordering, grounding, numeric unit-binding, and deterministic terminal explanation behavior passed automated tests.

## End-to-end user-flow result

The real Playwright lifecycle passed in 44.2 seconds (test body 37.9 seconds):

1. Registered a new user and established the HTTP-only session.
2. Created and persisted a canonical Financial Profile.
3. Generated and persisted a non-empty, profile-bound recommendation.
4. Rendered the restored dashboard, allocation cards, charts, and donut visualization.
5. Updated the profile and observed recommendation refresh.
6. Requested AMFI WTI evidence and accepted a truthful 0–5 result contract.
7. Requested deterministic market context and bounded adjustment; no product was introduced and suitability/concentration were revalidated.
8. Ran projection and Monte Carlo using recommendation catalog IDs mapped only after suitability to model-assumption keys.
9. Created a custom goal using the persisted profile ID.
10. Calculated both tax regimes from explicit annual income, income source, and `FY2026-27`.
11. Rendered a grounded chat response with evidence/citation/provider details.
12. Restored the session after reload, logged out, logged back in, and logged out again.
13. Confirmed sensitive profile/session data was absent from browser storage.
14. Confirmed the browser made no direct NSE, AMFI, SBI, India Post, NVIDIA, Gemini, or Groq request.

## Failure matrix

| Failure | Accepted behavior | Result |
|---|---|---|
| Mongo unavailable | Startup/persistence unavailable; no fabricated persistence | PASS by configuration/error tests |
| Standalone Mongo | Explicit transaction-capability rejection | PASS |
| Redis unavailable | Revocation checks fail closed; non-authoritative caches degrade safely | PASS; also observed in real lifecycle |
| ML unavailable | Deterministic recommendation authority remains; optional ML unavailable | PASS |
| NSE unavailable/schema drift | `MARKET_CONTEXT_UNAVAILABLE`; no silent NORMAL | PASS |
| AMFI unavailable | Product evidence unavailable; no catalog/rate fallback | PASS |
| India Post unavailable | Government product facts unavailable; no static-rate fallback | PASS |
| SBI unavailable | SBI facts unavailable; no other-bank/static fallback | PASS |
| HMM unavailable/drifted | Champion deterministic context unaffected; challenger diagnostic unavailable | PASS |
| NVIDIA unavailable | Gemini, then Groq when configured, then deterministic grounded template | PASS |
| All LLMs unavailable | Deterministic evidence-backed explanation | PASS |
| Missing tax facts | Validation/unavailable result; no income, regime, or fiscal-year inference | PASS |

## Security and architecture verification

- JWT/session, ownership, CSRF, CORS, idempotency, rate-limit, unknown-field, error-contract, and fail-closed Redis tests passed.
- Recommendation persistence remains transaction-bound; no unsafe standalone fallback was added.
- Hostile prompt and provider-output tests reject allocation/profile mutation, unsupported assets/returns, secret requests, arbitrary URLs, HMM semantic invention, and tax-income inference.
- Numeric grounding binds values to evidence entity, field, and unit; cross-unit/cross-entity reuse is rejected.
- Recommendation records retain profile hash/version and policy/model provenance. Stale profile/recommendation mismatch is rejected.
- Provider payloads remain behind provider-neutral adapters. No raw provider cookie/header, secret, password hash, or Mongo document is returned by accepted DTOs.
- Production frontend build contains no NVIDIA, Gemini, Groq, JWT, Mongo, or Redis secret.
- Frontend remains presentation-only. Visual regression: **NONE**. Frontend architecture degraded: **NO**.

## Automated gate results

### Backend

- Full Node suite: **511 passed, 0 failed**, 26 suites, 540.425 seconds.
- Lint: **0 errors**, 55 existing warnings.
- Syntax/typecheck: PASS.
- Production dependency audit at high threshold: PASS; 5 lower-severity findings remain (1 low, 4 moderate).

### Frontend

- Vitest: **106 passed, 0 failed**, 22 files, 100.66 seconds.
- Playwright real lifecycle: **1 passed, 0 failed**, 44.2 seconds.
- ESLint: PASS.
- TypeScript: PASS.
- Production build: PASS; 2,956 modules transformed in 27.67 seconds.
- npm audit: **0 vulnerabilities**.

### ML

- Pytest: **326 passed, 0 failed**.
- Ruff: PASS.
- Committed HMM artifact checksum/schema/registry load and CPU shadow inference: PASS.
- Python audit: no unexcepted known vulnerabilities; the CI exception is restricted to the already documented, upstream-unfixed `accelerate` CVE and does not promote that package into financial authority.

### Repository

- Documentation architecture checker: PASS.
- `git diff --check`: PASS.
- Tracked/diff secret scan and frontend-bundle scan: PASS.
- Residual financial-authority search: no unauthorized recommendation input, exact-five padding authority, static provider ranking authority, frontend provider access, or historical-to-expected-return bypass found.

## Phase 7 defects fixed

1. **NSE route parity race** — the qualifier compared a route result with an older snapshot. It now compares the route with the latest forced provider observation.
2. **CD tax smoke invalid input** — the smoke request omitted newly required tax facts. It now supplies explicit income source and fiscal year.
3. **Frontend dependency findings** — the lockfile was refreshed to patched versions; frontend audit is now zero.
4. **Misleading dashboard semantics** — unsupported “AI-synthesized” and “after-tax” claims were removed while preserving the exact dashboard structure.
5. **Stale architecture documentation** — current-state docs and the automated docs guard now describe deterministic/grounded authority correctly.
6. **Browser lifecycle coverage drift** — the test now follows restored visible controls and covers WTI, market adjustment, projection, Monte Carlo, goals, tax, grounding, storage, and session behavior.
7. **Windows CI overhead failure** — Windows still runs all 511 backend tests, while duplicate c8 instrumentation is kept on the two Linux/Mongo jobs where coverage is already collected.
8. **Projection/Monte Carlo identifier mismatch** — exact eligible catalog IDs are now mapped to versioned model-assumption keys only after hard suitability validation; unknown IDs still fail closed.
9. **Goal creation silently stopped before the API** — `GoalPlanner` now supplies the persisted canonical profile ID to the already fail-closed shared submission utility.

## Known non-blocking limitations

- Live NVIDIA NIM qualification requires a user-rotated key configured manually in ignored `server/.env`.
- The NSE public website endpoint is an official source but its website payload is not a stable published developer API; schema drift is therefore monitored and fails closed.
- The backend production npm tree has five lower-severity audit findings. The configured high-severity gate passes; these should be upgraded in a dedicated dependency-maintenance change after compatibility review.
- The Python audit carries one narrow exception for an upstream-unfixed `accelerate` advisory. This is documented and does not grant the package decision authority.
- Official-provider availability and page formats remain external dependencies. A source failure yields unavailable data, never a hardcoded financial value.
- The restored dashboard has a comparatively large main bundle; it is acceptable for the academic demo but remains a future performance optimization target outside the UI freeze.

## Final invariant decision

- Financial Profile authoritative: **YES**
- Market data bypasses suitability: **NO**
- Market context introduces products: **NO**
- HMM controls allocation: **NO**
- NIM controls allocation, tax, or rates: **NO**
- Historical return used as expected return: **NO**
- Projection assumption claimed as provider forecast: **NO**
- Missing value converted to zero: **NO**
- Static FD/government rate authoritative: **NO**
- Exact-five padding: **NO**
- Frontend direct provider requests: **NO**
- Secrets in frontend/repository diff: **NO**
- Ungrounded LLM fallback: **NONE**
- Phase 8 started: **NO**

The repository is ready for an academic demonstration with the limitations above disclosed. Phase 7 is closed; no subsequent feature phase is authorized by this acceptance.
