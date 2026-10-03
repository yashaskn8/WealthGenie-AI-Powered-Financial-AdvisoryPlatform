# Phase-15 live preflight closure record

## Snapshot and verdict

- Repository: `yashaskn8/WealthGenie-AI-Powered-Financial-AdvisoryPlatform`
- Branch at inspection: `main`
- Base snapshot inspected: `db7a4938a8434cc1c76a77673af3f6c3da864031`
- `origin/main` at inspection: same SHA; refreshed successfully before closure work.
- This record describes local code/test evidence only. The final commit SHA is the SHA of the commit containing this record and is reported with the push/remote-check results.
- Live Phase-15 verdict: **BLOCKED — live preflight not authorized**. No 22/22 live result is claimed.

The read-only `demo:doctor` currently reports **5 PASS / 25 FAIL**. Chromium launches. The process lacks the explicit isolated-database name, API/frontend target, expected build SHA, fixture paths, and idempotency key. Those omissions prevent safe live execution. In particular, the backend must prove the actual connected Mongo database equals a configured non-reserved demo DB before any authenticated mutation is allowed. No login, profile completion, tax operation, or WTI request was run in this closure pass.

Previously supplied demo/Mongo credentials have appeared in conversation text. They are not recorded here and must not be reused for a live run; rotate them first and provide replacements through a secret-safe process environment. The URI is not echoed or persisted by the doctor.

## 22-gate runtime contract

The authoritative ordered gate names are `EXPECTED_PREFLIGHT_CHECKS` in `server/scripts/demoPreflight.js`. `PASS`, `FAIL`, and `NOT_EVALUATED` are distinct terminal states; exit code is zero only for exactly 22 PASS, zero FAIL, and zero NOT_EVALUATED.

| # | Gate | Exact PASS predicate | Inputs / upstream | Failure evidence / classification |
|---:|---|---|---|---|
| 1 | Explicit live-demo mode | `DEMO_LIVE_PREFLIGHT === '1'` | Operator process env | Exact message asks for `DEMO_LIVE_PREFLIGHT=1`; deterministic config. |
| 2 | Backend URL configuration | URL parses; protocol is HTTP(S); normalized path ends `/api`; no username/password/query/fragment; non-HTTPS allowed only for localhost, `127.0.0.1`, or `[::1]` | `DEMO_API_BASE_URL` (default is local port 5000) | `DEMO_API_BASE_URL must be a valid safe HTTP(S) URL ending in /api`; deterministic config. |
| 3 | Profile completion payload | File parses as a non-array object and Joi `financialProfileCompletionSchema.validate(..., {abortEarly:false, convert:false, stripUnknown:false})` has no error | `DEMO_PROFILE_COMPLETION_FILE` | `configure the required JSON file path` or `file must contain one valid JSON object; contents are never printed`; fixture. |
| 4 | Tax input payload | File parses as a non-array object and Joi `taxCalculationContextSchema.validate(..., {abortEarly:false, convert:false, stripUnknown:false})` has no error | `DEMO_TAX_CONTEXT_FILE` | Same safe file/schema messages as gate 3; fixture. |
| 5 | Backend | `/health/live` is successful, body status is `ALIVE`, and both live and verification build SHAs match the valid explicit expected SHA | `DEMO_API_BASE_URL`, `DEMO_EXPECTED_BUILD_SHA`, running backend | Safe HTTP detail or `backend build identity is missing, malformed, or differs from the expected build`; runtime/config. |
| 6 | Backend readiness | `/health/ready` is successful and body status is `READY` | Running backend and verified startup dependencies/indexes | Safe HTTP detail; runtime/database. |
| 7 | Mongo/transaction support | Expected DB name is safe and non-reserved; runtime reports `connected`, `transactionCapable`, and `databaseIdentityVerified` all true. Health verifies actual connected `databaseName === backend DEMO_EXPECTED_MONGODB_DATABASE === request X-Demo-Expected-Mongodb-Database`; the read-only transaction probe must succeed. | `MONGODB_URI`, backend and preflight `DEMO_EXPECTED_MONGODB_DATABASE`, health verification | `expected demo database is missing/unsafe or the running backend did not verify connection, transaction, and exact database identity`; database/config. |
| 8 | Redis if required | If neither runtime policy nor `NODE_ENV=production`, `REQUIRE_REDIS`, or `DEMO_REQUIRE_REDIS` requires Redis, pass without a new connection; otherwise runtime says required and connected | Runtime Redis policy and connected health verification | `required Redis was not verified on the running backend connection`; config/runtime. |
| 9 | Market provider configuration | Deep health has `services.database === 'UP'`; backend provider is `NSE` or `UPSTOX`; token-presence flag is true; Mongo is connected and database identity verified; if Redis required, deep health and runtime Redis are UP/connected | Health/deep + health/verification + provider config | Predicate failure emits the gate’s generic dependency/provider detail; deterministic config plus external readiness. |
| 10 | NIFTY quote | `/regime/current` successful and observed `nifty50Current` has AVAILABLE, finite positive value, valid timestamp, FRESH status, and selected-provider provenance | Live market context | `marketQuoteDetail(...)`; external provider/freshness. |
| 11 | VIX quote | Same predicate as gate 10 for `indiaVixCurrent` | Live market context | `marketQuoteDetail(...)`; external provider/freshness. |
| 12 | Market history | Selected provider matches history provider and a derived fact is AVAILABLE, finite, and FRESH | Live market snapshot/history | `verified history is missing`; external provider/freshness. |
| 13 | Market context | Successful response and MARKET_CONTEXT_AVAILABLE at body/snapshot/policy; snapshot and response usability are USABLE; selected provider agrees across quote/history/facts; NIFTY/VIX and history qualify; observed facts are fresh/provenanced; observed timestamp parses; `assessSessionEvidence()` proves current qualified NSE calendar/session and coherent latest completed/current session | Live market snapshot, source provenance, NSE calendar/session, current India time | Session-specific safe detail (e.g. coherent fresh session/current holiday/weekend/close requirements); external evidence plus deterministic calendar policy. |
| 14 | Provider token presence | Live selected provider exactly equals backend-selected provider and backend token-presence flag is true (NSE’s flag is true because no token is required) | Backend health verification + live provider selection | Selected provider/token mismatch detail; deterministic configuration/runtime. |
| 15 | Tax-policy metadata | `/tax/policies` response satisfies `qualifiesTaxPolicyMetadata()` including current supported fiscal year and verified metadata | Runtime tax policy | `current fiscal-year policy metadata is missing, stale, malformed, or unverified`; runtime contract. |
| 16 | Profile completion/auth | Real login succeeds; CSRF cookie exists; completion fixture and 8–128 character idempotency key grammar are valid; authenticated completion returns a profile ID | Disposable account, cookies/CSRF, fixture, stable key, isolated DB | Safe HTTP status/stable code or safe failure kind; auth/database/fixture. |
| 17 | Recommendation current-state binding | Authenticated current-profile ID resolves; `/recommend/current?profileId=...` succeeds; `hasCurrentFinancialBinding()` is true; returned `profileId` matches | Gate 16 and committed/replayed profile operation | `HTTP <status> or incomplete/stale current-state binding` or safe failure code; deterministic financial state. |
| 18 | ETF product source | A successful WTI response has exactly one product accepted by `qualifiesWtiResponse()` against the same current recommendation and `qualifiesExactNiftyEtf()` (Nippon ETF identity, benchmark, source and fresh primary fact) | Gates 17, exact configured parent `nifty_etf`, AMFI/source providers | Safe WTI HTTP/stable code, malformed JSON, binding/identity/freshness detail; provider/financial contract. |
| 19 | Nifty ETF exact-product result | Same single coherent response contains one exact product; no duplicate ambiguity | Gate 18 | Exact source-qualified identity or current-binding mismatch detail; provider/financial contract. |
| 20 | Product tax workflow | Tax context exists and that same qualified product passes `qualifiesCalculatedNiftyEtfTax(..., {financialBindingValid:true})` | Gates 4, 17–19 and current tax policy/product tax evidence | Stable tax status or `exact-product tax result is not calculated; no tax values are inferred`; fixture/policy/provider. |
| 21 | Critical browser path | Browser launch succeeds; safe login navigation is successful; login form/email/password become visible by bounded Playwright waits; DOM build SHA matches expected; login succeeds; `/profile` dashboard/sidebar is authenticated; exact ETF category is exercised; frontend WTI response is observed and financial-provider direct requests are absent | Frontend/API URLs, build SHA, Chromium, disposable credentials, gates 16–20 | Safe failure kind/status, no secret/payload details; browser/runtime. |
| 22 | Production frontend build | Vite build succeeds in a unique temporary output directory and explicit expected SHA is valid; temporary build output is removed successfully | React app dependencies and `DEMO_EXPECTED_BUILD_SHA`; build child environment allowlist | Safe build/cleanup failure detail; deterministic tooling. |

The browser path uses condition-based visibility waits for the login form and both credential inputs after `domcontentloaded`, with `LOGIN_BROWSER_TIMEOUT_MS`; it does not use arbitrary sleeps. The WTI request retains `WTI_USER_FLOW_TIMEOUT_MS` (90 seconds).

## Environment contract (presence from the inspected process)

Presence is a point-in-time status only; no secret values are recorded. The process-status probe is not proof of service validity.

| Variable | Required / consumer | Current presence | Secret | Can block the 22 gates |
|---|---|---|---|---|
| `NODE_ENV` | Runtime policy / Redis and defaults | ABSENT | No | Yes; set intentionally for isolated local run. |
| `PORT` | Backend listener | ABSENT | No | Yes, default port must be isolated per campaign. |
| `JWT_SECRET` | Backend authentication signing | ABSENT | Yes | Yes, backend startup/auth. |
| `MONGODB_URI` | Backend Mongo connection | PRESENT | Yes | Yes; connection, transaction, indexes and DB identity. Presence alone proves none. |
| `MONGODB_FLAVOR` | Runtime Mongo policy if configured | ABSENT | No | Potentially. |
| `MONGODB_AUTO_INDEX` | Mongoose index creation behavior; production default is off | ABSENT | No | Startup still verifies explicit financial/market indexes; do not use auto-index as a migration substitute. |
| `REDIS_URL` | Redis when production/policy requires | ABSENT | Yes | Conditional. |
| `REQUIRE_REDIS` | Redis policy | ABSENT | No | Conditional. |
| `CORS_ORIGINS` | Backend browser-origin allowlist | ABSENT | No | Yes for cross-origin browser auth. |
| `AUTH_COOKIE_SECURE` | Cookie transport policy | ABSENT | No | Potentially; local HTTP must use the verified local policy. |
| `AUTH_COOKIE_SAME_SITE` | Cookie policy | ABSENT | No | Potentially. |
| `APP_BUILD_SHA` | Backend build identity (`/health/live`, verification) | ABSENT | No | Yes; must equal frozen SHA. |
| `AGENTIC_PLAN_REVIEW_ENABLED` | Optional PlanReview runtime; defaults enabled outside production | ABSENT | No | Yes, can add PlanReview and agent persistence index readiness. Disable explicitly for the isolated financial-only run if not required by a gate. |
| `AGENT_WORKER_ENABLED` | Optional worker; defaults enabled | ABSENT | No | Yes, development defaults to embedded worker startup. Disable explicitly for the isolated financial-only run if not required by a gate. |
| `AGENT_WORKER_MODE` | Worker mode; defaults embedded outside production | ABSENT | No | Conditional runtime startup. |
| `VITE_API_URL` | Frontend backend origin | ABSENT | No | Yes; must target isolated backend. |
| `VITE_BUILD_SHA` | Frontend DOM build identity | ABSENT | No | Yes; must equal frozen SHA. |
| `DEMO_LIVE_PREFLIGHT` | Explicit live-run opt-in | ABSENT | No | Yes; exact value `1`. |
| `DEMO_API_BASE_URL` | Preflight backend API target | ABSENT | No | Yes; use isolated backend `/api`, not default accidentally. |
| `DEMO_FRONTEND_URL` | Browser target | ABSENT | No | Yes. |
| `DEMO_EMAIL` | Disposable account login | PRESENT | Sensitive identifier | Yes; presence is not proof of safe/demo ownership. Previously exposed credential must be rotated. |
| `DEMO_PASSWORD` | Disposable account login | PRESENT | Yes | Yes; previously exposed credential must be rotated. |
| `DEMO_PROFILE_COMPLETION_FILE` | Strict profile fixture path | ABSENT | No (contents sensitive) | Yes. |
| `DEMO_TAX_CONTEXT_FILE` | Strict tax-context fixture path | ABSENT | No (contents sensitive) | Yes. |
| `DEMO_COMPLETION_IDEMPOTENCY_KEY` | Stable exact-payload retry identity | ABSENT | Treat as sensitive operational token | Yes. |
| `DEMO_NIFTY_ETF_PARENT_ID` | Exact product parent | ABSENT | No | Yes; must be `nifty_etf`. |
| `DEMO_EXPECTED_BUILD_SHA` | Preflight build identity | ABSENT | No | Yes; must equal frozen SHA. |
| `DEMO_EXPECTED_MONGODB_DATABASE` | Explicit isolated DB identity | ABSENT | No | Yes; this is a safety stop before mutation. |
| `DEMO_REQUIRE_REDIS` | Cannot weaken production Redis policy | ABSENT | No | Conditional. |
| `MARKET_DATA_PRIMARY_PROVIDER` | Provider selection; default NSE | ABSENT | No | Yes if selected provider/runtime disagree. |
| `UPSTOX_ACCESS_TOKEN` / `UPSTOX_ANALYTICS_TOKEN` | Only when Upstox is selected | ABSENT | Yes | Conditional; NSE requires no token. |
| `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | Deferred advisory/explanation providers, not used by the 22 preflight gates | Not probed | Yes | Not required for this preflight; no LLM-backed financial authority is involved. |
| MCP secrets/agent OIDC credentials | Remote MCP/agent subsystems, not used by the financial live gates | Not probed | Yes | Not required if those optional subsystems are disabled; their normal runtime configuration must not be weakened in production. |

The process also lacks the required fixture/target values above; see the doctor output summarized below. A secret-safe parser check confirmed the currently supplied Mongo URI's database target does **not** satisfy the non-reserved isolated-name policy, and `DEMO_EXPECTED_MONGODB_DATABASE` is absent; no Mongo connection was attempted. Current working-tree SHA cannot serve as final build identity until the validated changes are committed. Do not reuse `DEMO_EMAIL`/`DEMO_PASSWORD` without replacing the exposed values through a secret-safe channel.

## Evidence and safety boundary

- `npm run demo:doctor` is intentionally read-only: it checks safe config/fixture presence, health endpoints, frontend reachability, and Chromium launch; it does not authenticate, invoke market providers, or call mutation endpoints.
- Current doctor result: **5 PASS / 25 FAIL**. PASS checks are demo email/password presence, default NSE selection/no provider token requirement, and Chromium launch. Missing checks include explicit opt-in, URLs, expected build SHA, explicit isolated DB, idempotency key, exact parent, both fixture files, backend health/readiness/verification, frontend reachability. No secret values, URL credentials, fixture paths, or fixture bodies were emitted.
- Mongo DB identity is not verified. The supplied URI must not be used for stateful demo verification until an isolated non-reserved database is explicitly selected, matches the actual connected database, and the disposable account is confirmed for that DB.
- `OFFLINE PREFLIGHT CONTRACT VERIFIED` is an injected orchestration test only. It is not provider, database, login, browser-user-flow, or production-build evidence.
- The deterministic offline test has one injected failure scenario for each named gate and verifies an upstream precondition failure prevents provider/browser mutation entry.
- No live 22-gate run occurred. Market/calendar/AMFI/tax/session freshness, demo login/account ownership, current recommendation containing the exact parent, indexes, DB transaction support, runtime build identity, and real browser financial flow remain unproven.

## Remediation and local validation

| Finding / change | Class | Evidence / disposition |
|---|---|---|
| Preflight previously collapsed “not reached” checks into ordinary failures and could report an incomplete set without distinct state | CODE | Reporter now retains `NOT_EVALUATED`; success requires exactly 22 PASS and no FAIL/NOT_EVALUATED. |
| A live profile-completion mutation must not run against a guessed/default/wrong Mongo DB | CODE + CONFIG | Preflight sends the explicit expected database; health compares requested name, backend configuration, and actual connected DB name; mismatch/reserved names fail before the read-only transaction probe and preflight short-circuits before auth/provider calls. Current operator configuration does not satisfy this prerequisite. |
| Fixtures could parse while containing fields rejected by actual endpoint schemas | CODE + FIXTURE | Preflight and doctor validate against the strict profile-completion and tax-context Joi schemas with coercion/stripping disabled. No valid live fixtures are configured in this process. |
| Offline orchestration success could be mistaken for live proof | TEST / EVIDENCE | The offline success campaign is explicitly named as such; it injects dependencies and does not claim provider/DB/auth proof. The read-only doctor and inert preflight outputs are recorded above. |
| Temp frontend build could overwrite ordinary `reactapp/dist` or inherit secrets | CODE | Build uses an isolated temp output directory, a small child-process environment allowlist, validated non-secret Vite settings, and cleanup; the actual local frontend build passed. Dotenv/build inputs still require ordinary operator review for a live release. |
| Deferred-advisory regression test stub did not satisfy provider configuration guard without a key | TEST HARNESS | The test sets a clearly fake local-only sentinel while stubbing provider generation and restores prior environment; no network call is made. |

Fresh local validation on the inspected source tree:

- Focused Phase-15 and adjacent backend suites: **264 passed, 0 failed, 0 skipped**.
- Post-review database-identity short-circuit tests: **62 passed, 0 failed, 0 skipped**.
- Full backend `npm test` with `MONGODB_URI` and `MONGO_URI` unset: **1198 tests, 1195 passed, 0 failed, 3 skipped**. This completed immediately before the final wording-only correction to the browser success diagnostic; the directly affected preflight suite is rerun after that correction. This is local unit/integration evidence without a configured external Mongo URI, not the exact-SHA GitHub Mongo matrix.
- Backend lint: **pass**, 0 errors, 43 existing warnings.
- Backend typecheck and `node --check` for all changed JavaScript: **pass**.
- Frontend Vitest: **254 tests across 36 files passed**; frontend lint and typecheck: **pass**.
- Frontend production build: **pass**; Vite emitted the existing >1 MB chunk-size advisory.
- `git diff --check`: **pass** at last check; rerun before commit.
- Default inert `npm run demo:preflight` (live flag absent): **0 PASS / 1 FAIL / 21 NOT_EVALUATED; exit 1**. It stopped at the opt-in gate and did not perform HTTP/provider/auth/DB/build actions.
- Read-only doctor: **5 PASS / 25 FAIL**; details above. This is not a live 22-gate run.

## Required safe next verification

After rotating the exposed credentials, provide process-only values for an isolated transaction-capable replica-set database and its exact expected DB name. Use only the isolated ports: backend `127.0.0.1:5001`, frontend `127.0.0.1:5174`; set `PORT=5001`, `DEMO_API_BASE_URL=http://127.0.0.1:5001/api`, `VITE_API_URL=http://127.0.0.1:5001/api`, `DEMO_FRONTEND_URL=http://127.0.0.1:5174`, and `CORS_ORIGINS=http://127.0.0.1:5174`. Do not disturb existing services on 5000/5173. Set `APP_BUILD_SHA`, `VITE_BUILD_SHA`, and `DEMO_EXPECTED_BUILD_SHA` to the exact committed SHA. For an isolated financial-only development runtime, explicitly disable optional `AGENTIC_PLAN_REVIEW_ENABLED` and `AGENT_WORKER_ENABLED` only after confirming neither is needed by the gates. Provide strict fixture files outside the repository and a stable idempotency key for the exact fixture. Run the read-only doctor, prove index readiness and disposable login/account ownership, then re-evaluate live-provider/calendar/AMFI prerequisites. Only when every deterministic prerequisite is demonstrated should `npm run demo:preflight --prefix server` be run. Do not turn provider or tax unavailability into a pass.
