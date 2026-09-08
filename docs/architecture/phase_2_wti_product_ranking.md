# Phase 2 Where-to-Invest product authority

## Scope

Phase 2 supports a mutual-fund vertical slice. The saved Financial Profile first
passes the existing hard parent-instrument suitability checks. Product selection
then stays inside that exact eligible parent category.

The API returns zero to five products. It never pads the result and never falls
back to the legacy provider arrays.

## Qualified external data

- Current product universe, AMC, category, Plan, Option, NAV, and valuation date:
  AMFI `https://portal.amfiindia.com/spages/NAVAll.txt`.
- Historical NAV evidence: AMFI
  `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx`, requested as
  one seven-day window centred approximately one year before the current NAV.

Both reports are parsed by header name. Missing Plan or Option fields remain
`null`; scheme names are not parsed to invent those classifications. The full
current report and single historical window are cached for 24 hours and requests
are coalesced. No per-product vendor calls are made.

## Deterministic ranking rule

Rule version: `wti-mutual-fund-ranking-2.0.0`.

1. Require the parent instrument to pass hard Financial Profile suitability.
2. Require an exact, allow-listed AMFI category heading for that parent.
3. Require a verified, fresh, positive current NAV.
4. For ranking, require the AMFI Option field itself to establish a Growth
   option and require a positive historical NAV 330–400 days before the current
   valuation date.
5. Calculate annualized point-to-point historical NAV return and sort descending.

No weighted score, expected return, NAV-size comparison, post-tax return, AUM,
expense ratio, risk, tracking error, or benchmark assumption participates.
The response states that historical return is backward-looking and not expected
return. A unique first product may be labelled a Top Pick only under this rule.
Tied leaders are not given a unique Top Pick label.

If fewer than two products have distinct qualified historical returns, products
with verified category membership and fresh NAVs are returned as `VERIFIED
COMPARABLE OPTION`. Their stable-ID display order is explicitly not a ranking.

## Supported parent categories

Only exact AMFI headings mapped in
`server/services/mutualFundProductRanking.js` are supported. They currently
cover standard large-cap, large-and-mid-cap, mid-cap, small-cap, flexi-cap,
multi-cap, focused, value, contra, dividend-yield, ELSS, liquid, overnight,
money-market, ultra-short, short-duration, low-duration, medium-duration,
banking-and-PSU, corporate-bond, credit-risk, dynamic-bond, gilt, floater,
aggressive-hybrid, conservative-hybrid, balanced-advantage/dynamic-allocation,
equity-savings, multi-asset, children, retirement, and fixed-term-plan parent
categories where the parent itself is suitable.

## Explicitly unsupported

All non-mutual-fund products remain unavailable in Phase 2. Broad AMFI index,
sector/thematic, ETF, domestic fund-of-funds, and overseas fund-of-funds headings
are also unavailable where the AMFI heading does not establish the specific
benchmark, sector, geography, or structure claimed by an existing parent card.
Named-fund parent cards are not matched from name similarity.

## Legacy catalog boundary

`whereToInvestCatalog` exports only `title` and `howToStart` reference text. Its
legacy embedded product arrays, rates, provider order, and promotional text are
not exported and cannot determine the runtime universe, financial fields, or
ranking.

## Failure behaviour

AMFI source errors, schema mismatches, stale or missing NAVs, absent historical
evidence, and unsupported categories remain explicit. No numeric fallback is
inserted. Product fields not established by AMFI are returned as `null`, and the
UI labels verified ranked products, verified comparable options, reference
metadata, and unavailable states separately.
