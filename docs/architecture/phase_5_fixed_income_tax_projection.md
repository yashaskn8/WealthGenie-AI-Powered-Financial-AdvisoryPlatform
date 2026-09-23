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

- Supported policy versions: `tax-policy-FY2025-26-v2` and `tax-policy-FY2026-27-v2`.
- Fiscal-year semantics are explicit: FY2024-25 maps to AY2025-26, while FY2025-26 maps to AY2026-27. The FY2025-26 new-regime Section 87A policy is a ₹12,00,000 taxable-income limit with a maximum ₹60,000 rebate; it must not inherit the prior FY's ₹7,00,000/₹25,000 policy.
- Each fiscal year owns a separate frozen policy entry and slab array even where rates happen to be equal.
- Old-regime slabs are age-sensitive: non-senior (<60) basic exemption ₹2,50,000, senior citizen (60–79) ₹3,00,000, and super-senior (80+) ₹5,00,000. Old-regime calculations fail closed with `USER_AGE_REQUIRED_FOR_OLD_REGIME` when age is unavailable.
- Family-pension deduction is the lower of one-third of family pension and the fiscal-year/regime policy cap: ₹15,000 old regime and ₹25,000 new regime for FY2025-26 and FY2026-27.
- Employer NPS deduction limits are policy-owned: government employer 14%; non-government employer 10% old regime and 14% new regime for the supported fiscal years. Current-law output uses statute-versioned semantic rule IDs; a legacy section label is not a claim about a new Act section number.
- Official references are returned in the API response from the Government of India Union Budget material and Income Tax Department guidance.
- Annual income, income source, and regime are mandatory separate tax inputs. The Financial Profile's monthly take-home, savings, lump sum, and portfolio value are never used to infer them.
- Post-tax UI also requests an explicit fiscal year and inflation assumption.
- For both supported fiscal years, bank-interest TDS applicability uses the Finance Act 2025 thresholds: ₹50,000 for non-senior depositors and ₹1,00,000 for senior citizens. TDS is withholding, not final tax liability.
- Responses include `policyVersion`, `fiscalYear`, `statuteMetadata`, `taxRuleMetadata`, `inputsUsed`, `rulesApplied`, `sourceReferences`, `assumptions`, and `unavailableReasons`. For FY2026-27, `rulesApplied` uses semantic IDs under `INCOME_TAX_ACT_2025`; any old section-derived names appear only in `taxRuleMetadata.legacyAliases`. No new Act section number is inferred from an old label.
- Product post-tax `sourceReferences` are deduplicated and role-aware: qualified product/rate evidence is marked `PRODUCT_RULE`, while the fiscal-year tax policy evidence is marked `TAX_POLICY`. Calculated outcomes include both.
- The backend exposes `GET /api/tax/policies` with `currentFiscalYear`, `verifiedFiscalYears`, and policy metadata. WTI does not hardcode a prior fiscal year.
- The current calendar date in this baseline (September 2026) resolves to FY2026-27 and therefore `tax-policy-FY2026-27-v2`; future or unverified fiscal years return `FISCAL_YEAR_UNSUPPORTED`. New audit writes resolve `regulatory_rule_version` dynamically at request time using the India fiscal-year authority, while recommendation metadata continues to use the separate suitability policy version.
- Product WTI outcomes use the explicit `postTaxAnalysis` DTO. The generic WTI `postTaxReturn` field remains `null` and is never overloaded with tax authority.
- Product statuses include `CALCULATED`, `REQUIRES_TAX_INPUTS`, `TAX_CLASSIFICATION_UNAVAILABLE`, `FISCAL_YEAR_UNSUPPORTED`, `PRODUCT_FACTS_UNAVAILABLE`, and `UNAVAILABLE`.
- Source-qualified current-rate illustrations, historical-return illustrations, modelled investor what-ifs, and transaction estimates are separate calculation classes. WTI does not claim full-tenure IRR without verified cash-flow facts.
- The current qualified product matrix recognizes conditional PPF and Sukanya account exclusions, but returns no tax result until account/payment facts are established. SBI deposit interest and RBI FRSB interest use their qualified product classes. SCSS/NSC/KVP/POMIS/Post Office term products and AMFI mutual funds remain unavailable until a qualified adapter supplies their tax metadata.
- Mutual-fund tax treatment is never inferred from an AMFI scheme name or category. Equity special-rate calculations require explicit holding period and taxpayer-level equity long-term-gains exemption usage; a product comparison cannot consume the exemption independently for every product. `section112AExemptionUsed` remains a compatibility input name and is not exposed as current statutory authority for FY2026-27.
- The portfolio what-if endpoint remains a separate `MODELLED_POST_TAX_PROJECTION` path. It uses caller-supplied nominal return assumptions and is not an actual transaction tax estimate.

### Canonical post-tax and projection contract

- `taxEngine.js` is the sole statutory policy authority. The legacy positional `postTaxCalculator.js` API is now a compatibility adapter into `taxEventProjectionEngine.js`; it contains no slab rates, cess multipliers, holding-period thresholds, or product-name tax heuristics.
- Ordinary interest uses baseline-versus-with-income incremental tax. The marginal shortcut `nominalRate × (1 - marginalRate)` is not an authority and is not used by the post-tax path.
- Capital gains are maintained in separate short-term and long-term buckets. SIP illustrations preserve monthly FIFO lots, while the taxpayer-level long-term-gains exemption usage is supplied once at context level rather than reset per product. Historical section labels are versioned aliases only.
- Exact acquisition/redemption dates use calendar-anniversary classification. If dates are not available, the response says `MODELLED_MONTHLY_LOTS` or `EXPLICIT_HOLDING_PERIOD_MONTHS`; it must not imply an actual transaction ledger.
- Projection ordering is deterministic: gross contributions/returns → tax events → post-tax cash flows. Ordinary-interest models apply annual incremental-tax events; capital-gain models apply an exit event. `TAX_POLICY_HELD_CONSTANT_FOR_PROJECTION` is disclosed and `postTaxCAGR` is derived from the final post-tax value.
- Generic `ETF`, `Debt_MF`, `Balanced_Advantage`, and similar labels do not establish a statutory class. They return `MODEL_TAX_CLASS_UNAVAILABLE` until provider-qualified metadata or an explicit server-owned model class exists. Unknown timing/model data returns `MODELLED_POST_TAX_PROJECTION_UNAVAILABLE`; it is never converted to zero.
- SGB calculations require an explicit redemption channel and an explicit coupon input. RBI redemption, maturity, and secondary-market paths are separate; no RBI redemption exemption is the default. NPS exit results are explicitly modeled scenarios and require annuity fraction and retirement timing.
- The frontend sends deductions and tax interaction inputs to the backend and renders status/classification. It does not calculate tax or replace an unavailable result with ₹0 or 0%.

This is an educational MVP estimate, not a complete return-filing engine. Its SIP lot model is a projection illustration, not a substitute for a taxpayer's transaction ledger. Users must verify product tax classification and personal circumstances with a qualified tax professional.

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
