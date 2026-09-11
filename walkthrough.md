# WealthGenie: FinTech Correctness & Compliance Hardening Walkthrough

> Historical note: the phase excerpts below document earlier work. The current
> runtime uses fiscal-year tax identifiers such as `tax-policy-FY2026-27-v2`
> for statutory metadata and resolves them at audit-write time with
> `getCurrentRegulatoryRuleVersion()`; `suitability-freeze-1.1.0` remains
> recommendation policy metadata. These fields are intentionally separate.

This document records the engineering accomplishments, statutory defect discovery & remediation, adversarial suitability hardening, live audit verification, and documentation updates executed under the **FinTech Correctness & Compliance Hardening** protocol.

---

## 1. Summary of Accomplishments & Pushed Commits

The historical changes were implemented incrementally and verified with raw test logs and live HTTP endpoints. The authoritative repository is [`yashaskn8/WealthGenie-Architecture-Restoration`](https://github.com/yashaskn8/WealthGenie-Architecture-Restoration).

| Phase | Description | Commit Hash | Key Files Modified / Created |
|---|---|---|---|
| **Phase 1** | **Adversarial Fuzzing & Statutory Cliff Fix**: Discovered & fixed real Old Regime Section 87A statutory cliff bug; created 7-property `fast-check` fuzz suite (7,000+ cases) & exact rupee boundary suite. | [`9cd1782`](https://github.com/yashaskn8/WealthGenie-Architecture-Restoration/commit/9cd1782) | `server/services/taxEngine.js`, `server/test/taxEngineFuzz.test.js`, `server/test/taxBoundary.test.js` |
| **Phase 2** | **Regulatory Data Versioning in Audit Trail**: Added statutory rule metadata to the audit path; the current implementation resolves `regulatory_rule_version` from the tax engine and keeps it separate from `recommendation_policy_version`. | [`d8dfec2`](https://github.com/yashaskn8/WealthGenie-Architecture-Restoration/commit/d8dfec2) | `server/models/AuditRecord.js`, `server/routes/recommend.js`, `server/scripts/verify_regulatory_audit_live.js` |
| **Phase 3** | **Adversarial Suitability & Multi-Instrument Concentration Defense**: Hardened capacity pull-down safeguards and anti-gaming aggregate category concentration caps; verified against adversarial senior-citizen and multi-fund attack profiles. | [`d3ee7dc`](https://github.com/yashaskn8/WealthGenie-Architecture-Restoration/commit/d3ee7dc) | `server/services/RecommendationPipeline.js`, `server/test/suitabilityAdversarial.test.js`, `server/scripts/verify_suitability_live.js` |
| **Phase 4** | **Explicit Scope & RIA Compliance Documentation**: Added explicit jurisdictional scope limitations (Indian retail only), RIA educational disclaimers, and Union Budget tax engine update protocols to `PROJECT_STATUS.md` and `README.md`. | [`4cfe42c`](https://github.com/yashaskn8/WealthGenie-Architecture-Restoration/commit/4cfe42c) | `PROJECT_STATUS.md`, `README.md` |

---

## 2. Phase 1 — Adversarial Fuzzing & Statutory Bug Fix

### Real Pre-Fix Defect Uncovered by Fuzzing
During initial `fast-check` fuzzing (1,000 runs per statutory invariant property), Property 4 failed immediately:
- **Pre-Fix Counterexample**: `taxableIncome = ₹5,00,001` in Old Regime
- **Observed Pre-Fix Tax**: `₹1` (Incorrectly applied Section 87A marginal relief to Old Regime)
- **Statutory Law**: Under the Income Tax Act, 1961, Section 87A marginal relief applies **strictly to the New Tax Regime** (Section 115BAC). Under the Old Tax Regime, taxable income exceeding ₹5,00,000 by even ₹1 results in a total loss of Section 87A rebate (statutory cliff) — resulting in `₹12,500 + 20% on ₹1 + 4% cess = ₹13,000`.

### Remediation in `server/services/taxEngine.js`
Guarded Section 87A marginal relief so it only triggers for `safeRegime === 'new'`:
```javascript
    const rebateLimit = safeRegime === 'new' ? 1200000 : 500000;
    if (taxableIncome <= rebateLimit) {
        taxBeforeCess = 0;
        rebateApplied = true;
    }
    else if (safeRegime === 'new') {
        // Section 87A Proviso (Marginal relief under Section 115BAC):
        // Tax payable shall not exceed the amount by which total income exceeds rebate limit
        const excessOverLimit = taxableIncome - rebateLimit;
        if (taxBeforeCess > excessOverLimit) {
            marginalReliefAmount87A = taxBeforeCess - excessOverLimit;
            taxBeforeCess = excessOverLimit;
            marginalReliefApplied = true;
        }
    }
```

### Exact Boundary Testing (`server/test/taxBoundary.test.js`)
```
[Boundary 1: Section 87A New Regime ₹12L]
  ₹11,99,999 Taxable -> Tax: ₹0, Rebate Applied: true
  ₹12,00,000 Taxable -> Tax: ₹0, Rebate Applied: true
  ₹12,00,001 Taxable -> Tax: ₹1, Marginal Relief Applied: true, Relief Amount: ₹59999

[Boundary 2: Section 87A Old Regime ₹5L Cliff]
  ₹4,99,999 Taxable -> Tax: ₹0, Rebate Applied: true
  ₹5,00,000 Taxable -> Tax: ₹0, Rebate Applied: true
  ₹5,00,001 Taxable -> Tax: ₹13000, Rebate Applied: false, Marginal Relief: false

[Boundary 3: Surcharge Tier 1 ₹50L]
  ₹49,99,999 Taxable -> Tax: ₹1123200, Surcharge: ₹0
  ₹50,00,000 Taxable -> Tax: ₹1123200, Surcharge: ₹0
  ₹50,00,001 Taxable -> Tax: ₹1123201, Surcharge: ₹108000, Marginal Relief: ₹107999 (Net increase: exactly ₹1)
```

---

## 3. Phase 2 — Regulatory Versioning in Immutable Audit Trail

### Schema Extension (`server/models/AuditRecord.js`)
```javascript
  regulatory_rule_version: {
    type: String,
    required: true,
    index: true,
  },
```

### Live HTTP Verification Output (`server/scripts/verify_regulatory_audit_live.js`)
```
================================================================
[2026-08-17T06:32:44.672Z] PHASE 2: REGULATORY RULE VERSIONING LIVE AUDIT TEST
================================================================
[2026-08-17T06:32:44.679Z] Step 1: Building test profile...
[2026-08-17T06:32:44.920Z] Step 2: Requesting recommendation via POST /api/recommend...

================= LIVE RECOMMENDATION AUDIT REPORT =================
Timestamp: 2026-08-17T06:32:47.706Z
Recommendation ID: 6a82ab0f529d2323160c9c28
Audit ID: 6a82ab0f529d2323160c9c2a
Audit Hash: 87a776678c836c51f37e2a094aa2c6eac43c8dbc1b8b173c58f7aaa7036c97ee
Model Version: rule_fallback
Regulatory Rule Version: tax-policy-FY2026-27-v2
Instruments Count: 5
Portfolio Yield: 6.56%

[2026-08-17T06:32:47.706Z] Step 3: Querying GET /api/recommend/audit...

=================== STORED AUDIT RECORD REPORT ===================
Record ID: 6a82ab0f529d2323160c9c2a
User ID: b0dfcafecc598e19d6717a50
Profile ID: 6a82ab0c529d2323160c9c24
Version ID: rule_fallback
Regulatory Rule Version: tax-policy-FY2026-27-v2
Input Hash: 87a776678c836c51f37e2a094aa2c6eac43c8dbc1b8b173c58f7aaa7036c97ee
Engine: rule_fallback
Timestamp: 2026-08-17T06:32:47.638Z
Recommendations Count: 5
==================================================================

✅ Verified: statutory tax policy version 'tax-policy-FY2026-27-v2' is captured separately from the recommendation policy in new AuditRecords.
```

---

## 4. Phase 3 — Adversarial Suitability & Anti-Gaming Concentration

### Defect Identified & Hardened
- **Multi-Instrument Concentration Bypass**: If an investor selected multiple small-cap or mid-cap funds (e.g. 3 mid-cap funds), individual instrument caps were not violated, but aggregate asset-class concentration exceeded 20%.
- **Hardening**: Implemented `resolveConcentrationCap` and aggregate category grouping in `applyConcentrationCaps` (`RecommendationPipeline.js`), ensuring the sum of all instruments in a given asset class is capped at `CONCENTRATION_CAPS[key].maxPct`.

### Live Verification Output (`server/scripts/verify_suitability_live.js`)
```
================================================================
[2026-08-17T06:36:14.721Z] PHASE 3: LIVE ADVERSARIAL SUITABILITY & CONCENTRATION TEST
================================================================

[Live Scenario 1] Conservative Senior Citizen (Age 65, Horizon Manipulated to 25 yrs)...
  Recommendation ID: 6a82abdfdd648d422b2f4eaf
  Final Risk Tier: Conservative
  Capacity Score: 3, Preference Score: 1
  Reconciliation Note: Preference (T=1) pulled tier down from capacity (C=3). Final: 1.
    - Bharat Bond ETF 2030 [Type: ETF, Tier: Low]: 13.8% (Weight: 0.138)
    - Voluntary Provident Fund (VPF) [Type: NPS, Tier: Low]: 9% (Weight: 0.09)
    - Sovereign Gold Bond (SGB) [Type: SGB, Tier: Low]: 10% (Weight: 0.1)
    - Equity Savings Hybrid Fund [Type: Equity_MF, Tier: Low]: 12.8% (Weight: 0.128)
    - Conservative Hybrid Fund [Type: Hybrid_MF, Tier: Low]: 54.4% (Weight: 0.544)
  Total Low Risk: 100.0%, Total High Risk: 0.0%

[Live Scenario 2] Aggressive Profile (Attempting Multi-Instrument Concentration Bypass)...
  Recommendation ID: 6a82abdfdd648d422b2f4eb7
  Final Risk Tier: Aggressive
    - Small-Cap Mutual Fund [Type: Smallcap_MF]: 11.5% (Weight: 0.115)
    - Nifty Midcap 150 ETF [Type: Midcap_MF]: 6.6% (Weight: 0.066)
    - HDFC Mid-Cap Opportunities Fund [Type: Midcap_MF]: 6.7% (Weight: 0.067)
    - Mid-Cap Mutual Fund [Type: Midcap_MF]: 6.7% (Weight: 0.067)
    - Post Office 1-Year Time Deposit [Type: Debt_MF]: 68.5% (Weight: 0.685)
  Aggregate Smallcap: 11.5% (Cap: 15%)
  Aggregate Midcap: 20.0% (Cap: 20%)

[Live Scenario 3] Mismatched Profile Safeguard (Capacity C=2 vs Preference T=5)...
  Recommendation ID: 6a82abe0dd648d422b2f4ebf
  Capacity Score: 2, Stated Preference: 5
  Final Risk Tier: Moderate
  Advisory Note: "Significant mismatch between risk capacity (Conservative-Moderate, C=2) and stated preference (Aggressive, T=5). Your financial profile suggests Conservative-Moderate risk capacity, but you selected Aggressive preference. The engine reconciled to tier 3 to protect against over-exposure."

================================================================
✅ All Live Adversarial Suitability and Concentration Tests Passed!
================================================================
```

---

## 5. Full Test Suite Validation

The entire server-side test suite was run across all 26 suites, confirming **404 out of 404 tests passing with zero failures**:
```
ℹ tests 404
ℹ suites 26
ℹ pass 404
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24119.746
```
