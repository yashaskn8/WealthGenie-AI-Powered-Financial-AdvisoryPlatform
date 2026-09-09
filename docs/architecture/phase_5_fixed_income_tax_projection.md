# Phase 5 — Source-backed fixed income, tax, and projection semantics

## Authority boundary

The established path remains unchanged:

`Financial Profile → hard suitability → eligible parent class → provider adapter → normalized facts → comparison authority → market-context adjustment → suitability/concentration revalidation → backend response → frontend evidence rendering`.

Government and bank facts do not alter suitability, market-context policy, the HMM shadow model, or projection return assumptions.

## Qualified official sources

### Government small savings

- Provider: Department of Posts, Government of India
- Source: <https://www.indiapost.gov.in/banking-services/savings>
- Data class: `QUARTERLY_OFFICIAL_RATE`
- Qualified interval on 2026-09-08: 2026-07-01 through 2026-09-30
- Runtime parser requires the explicit effective interval and the complete recognized rate table. Missing rows, missing rates, or schema drift fail closed.
- Normalized schemes: Post Office Savings Account; 1-, 2-, 3-, and 5-year Time Deposits; 5-year Recurring Deposit; SCSS; POMIS; NSC; PPF; KVP; Sukanya Samriddhi Account.
- WTI-supported parent mappings: PPF, SCSS, Sukanya, NSC, KVP, POMIS, Post Office RD, and Post Office 1-year TD.

The rate is an official effective-interval fact, not a live market price or expected return. Facts for different intervals have distinct observation identities and are retained separately. Operational eligibility, contribution limits, premature-withdrawal rules, and tax treatment are not claimed by this rate adapter when they are not established by its parsed source contract.

### Bank term deposits

- Qualified provider: State Bank of India only
- Source: <https://sbi.bank.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits>
- Data class: `OFFICIAL_BANK_PUBLISHED_RATE`
- Qualified table on 2026-09-08: revised rates effective 2025-12-15; page publication/last-update date 2026-06-16
- Product universe: retail domestic term deposits below ₹3 crore, eight official tenure buckets, separate General Public and Senior Citizen columns.

The adapter uses only the revised official columns. It does not infer credit quality, deposit insurance, minimum deposit, or premature-withdrawal terms. WTI returns at most one source-matched comparable option for the profile horizon and age-established depositor class. It never compares unlike tenures/depositor classes or claims a best FD. HDFC, ICICI, Axis, Kotak, and all other bank/corporate deposits remain unsupported rather than receiving static values.

## Failure and cache behavior

- Both providers use the existing Redis read-through cache and request coalescing with a 12-hour fetch TTL.
- Source errors, missing facts, stale facts, and schema changes yield explicit unavailable/error states.
- No static financial number is substituted.
- A persisted verified observation retains source, observation/effective dates, first/last fetch dates, and freshness. Stale observations may be identified as stale but are not recommended as current.

## Tax policy

- Supported policy versions: `tax-policy-FY2025-26-v1` and `tax-policy-FY2026-27-v1`.
- Each fiscal year owns a separate frozen policy entry and slab array even where rates happen to be equal.
- Official references are returned in the API response from the Government of India Union Budget material and Income Tax Department guidance.
- Annual income, income source, and regime are mandatory separate tax inputs. The Financial Profile's monthly take-home, savings, lump sum, and portfolio value are never used to infer them.
- Post-tax UI also requests an explicit fiscal year and inflation assumption.
- For both supported fiscal years, bank-interest TDS applicability uses the Finance Act 2025 thresholds: ₹50,000 for non-senior depositors and ₹1,00,000 for senior citizens. TDS is withholding, not final tax liability.
- Responses include `policyVersion`, `fiscalYear`, `inputsUsed`, `rulesApplied`, `sourceReferences`, `assumptions`, and `unavailableReasons`.
- Unsupported instrument tax classifications fail closed. Mutual-fund tax treatment is never inferred from an AMFI scheme name.

This is an educational MVP estimate, not a complete return-filing or capital-gains-lot engine. Users must verify product tax classification and personal circumstances with a qualified tax professional.

## Projection and Monte Carlo semantics

- Assumption version: `wealthgenie-projection-assumptions-1.0.0`
- Data class: `MODEL_ASSUMPTION`
- Source: `WEALTHGENIE_MODEL_POLICY`
- `observedMarketFact: false`
- `providerForecast: false`

The old mutable “live parameter override” path was removed. NSE context, AMFI NAV/history, government rates, SBI rates, and HMM state do not mutate these assumptions. API fields and frontend copy use “return assumption” language. Monte Carlo bands are explicitly simulated percentiles and the arithmetic mean is `simulated_mean`.

Historical AMFI returns remain backward-looking product evidence only and never enter projection assumptions. The deterministic NSE policy remains the allocation-context champion; the HMM remains shadow-only.

## Known limitations

- Only SBI has a qualified official bank-rate adapter in this phase.
- The source contracts are HTML/JavaScript page parsers and therefore intentionally fail closed if official page structure changes.
- India Post rate parsing does not establish every product's operational or tax term.
- Bank deposit risk quality and DICGC applicability are unavailable in the normalized product result.
- Model assumptions remain frozen academic policy inputs; they are not calibrated provider forecasts.
- No paid API, new dependency, GPU, browser-scraping service, microservice, NIM, XGBoost, or LightGBM was added.
