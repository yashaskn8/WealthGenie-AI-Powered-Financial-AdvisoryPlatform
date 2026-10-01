# Phase 15 financial display contract

The browser formats server-owned facts; it does not calculate financial results.
The recommendation is accepted only with the complete current-state binding and matching profile version.

| UI field | Backend field | Endpoint | Component | Format | Missing data |
|---|---|---|---|---|---|
| Investment name / ID | instruments[].name / id | GET recommend/current | Dashboard | Exact text | No invented instrument |
| Category | instruments[].assetClass | GET recommend/current | Dashboard | Server category | Unavailable |
| Monthly allocation | dashboard_projection.instrument_monthly_allocations[id] | GET recommend/current | Dashboard | INR, whole rupees | No portfolio fallback |
| Allocation % | instruments[].allocation_pct | GET recommend/current | Dashboard | 1–2 decimals | Unavailable; never rederive from rounded money |
| Risk | instruments[].riskLevel / riskScore | GET recommend/current | Dashboard | Server label | Unavailable |
| Lock-in | instruments[].lockIn | GET recommend/current | Dashboard | Years; zero means none | Unavailable |
| Tax classification | instruments[].taxClassification | GET recommend/current | Dashboard | Verified class only | No inferred tax benefit |
| Exact product name | products[].name | POST instruments/rank-wti | WhereToInvest | Exact text | Explicit empty/unavailable state |
| Provider | products[].provider | POST instruments/rank-wti | WhereToInvest | Readable provider text | Provider unavailable |
| Product type | products[].productType | POST instruments/rank-wti | WhereToInvest | Readable label | Unavailable |
| Product risk / access / fit | products[].beginnerSuitability | POST instruments/rank-wti | WhereToInvest | Server wording | Unavailable |
| Official rate | products[].officialRate.value | POST instruments/rank-wti | WhereToInvest | Current official rate (% p.a.); coupon disclosed separately | No NAV/history substitution as a rate |
| NAV | products[].nav.value | POST instruments/rank-wti | WhereToInvest | Current NAV, INR/provider precision | Unavailable |
| Historical return | products[].historicalReturn.valuePct | POST instruments/rank-wti | WhereToInvest | Historical 1Y return; not forecast | No expected-return fallback |
| Source provider / URL | products[].source.provider / url | POST instruments/rank-wti | WhereToInvest | Readable label; safe HTTP(S) source link | Unavailable |
| Observed / valuation date | officialRate.observedAt / nav.observedAt / valuationDate | POST instruments/rank-wti | WhereToInvest | IST timestamp / valuation date | Unavailable |
| Effective period | products[].officialRate.effectiveFrom / effectiveTo | POST instruments/rank-wti | WhereToInvest | Separate legal/rate interval | Never substitute observed date |
| Nominal return | results[].nominalReturnPercent | POST tax/post-tax-return/batch | PostTaxAnalysis | Model assumption (pre-tax), % | Unavailable |
| Post-tax return | results[].postTaxReturnPercent | POST tax/post-tax-return/batch | PostTaxAnalysis | Estimated after tax, % | Unavailable |
| Real return | results[].realReturnPercent | POST tax/post-tax-return/batch | PostTaxAnalysis | Real return after inflation, signed % | Unavailable |
| Post-tax gain | results[].postTaxGain | POST tax/post-tax-return/batch | PostTaxAnalysis | INR whole rupees | Unavailable, never zero |
| Tax drag (wealth / CAGR) | results[].taxDragWealth / taxDragCAGR | POST tax/post-tax-return/batch | PostTaxAnalysis | INR / fraction formatted as % | Unavailable |
| Effective tax | results[].effectiveTaxPercent | POST tax/post-tax-return/batch | PostTaxAnalysis | % | Zero preserved |
| Total invested | results[].totalInvested | POST tax/post-tax-return/batch | PostTaxAnalysis | INR | Unavailable |
| Tax type / status | results[].taxType / status | POST tax/post-tax-return/batch | PostTaxAnalysis | Server treatment / unavailable | Never calculate a missing class |
| Fiscal year / policy | fiscalYear / policyVersion | POST tax/post-tax-return/batch; GET tax/policies | PostTaxAnalysis | Visible policy context | No unverified year selection |
| Market context | context / status | GET regime/current | WhereToInvest Market Today | Readable policy context | Explicit unavailable |
| NIFTY 50 / India VIX | signals.nifty50Current / indiaVixCurrent | GET regime/current | Market Today details | Indian grouping, ≤2 decimals | Unavailable, never 0 |
| 1/5/20-day returns | signals.return1DayPct / return5DayPct / return20DayPct | GET regime/current | Market Today details | Signed %, ≤2 decimals | Unavailable |
| Drawdown / moving averages | signals.drawdownFromRecentHighPct / movingAverage50Day / movingAverage200Day | GET regime/current | Market Today details | Server values only | Unavailable |
| Market observed time | marketSnapshot.observedAt | GET regime/current | Market Today | IST timestamp | Unavailable |
| Market freshness | marketSnapshot.status / freshness | GET regime/current | Market Today | Current/closed/stale/partial/unavailable | Failed refresh explicitly previous, never current |
| Market session | marketSnapshot.marketSession.status | GET regime/current | Market Today | Readable session | Unavailable |

Tax analysis is a separate explicit-input model what-if, not a tax-aware recommendation.
Results are bound in the browser to the captured profile, portfolio and tax-input fingerprint; edits invalidate them.
Live market adjustment remains a server-owned preview, never a browser allocation mutation.
