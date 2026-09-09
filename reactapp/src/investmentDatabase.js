/**
 * WealthGenie — Generated Frontend Investment Catalog Adapter
 * ──────────────────────────────────────────────────────
 * Adapts the committed frontend mirror generated from the canonical backend
 * file at server/data/investment_master.json. Never edit the mirror directly;
 * run `npm run catalog:sync` from server and commit both files.
 * Dynamically loads investment_master.json and flattens properties
 * to maintain 100% backward compatibility with all UI pages, charts,
 * and non-personalized comparison/details views. It is never a browser-side
 * recommendation or ranking authority.
 */

import masterCatalog from './data/investment_master.json' with { type: 'json' };

// Legacy keys are retained for UI compatibility, but no current tax conclusion is
// embedded in this presentation catalog. Authoritative tax output requires the
// user's explicit fiscal year, regime, income and product classification.
const UNAVAILABLE_TAX_REFERENCE = Object.freeze({
  label: 'Reference tax tag',
  desc: 'Unavailable here. Use the Tax view with explicit inputs and current versioned rules.',
});
export const TAX_INFO = Object.freeze({
  eee: UNAVAILABLE_TAX_REFERENCE,
  slab: UNAVAILABLE_TAX_REFERENCE,
  ltcg: UNAVAILABLE_TAX_REFERENCE,
  elss: UNAVAILABLE_TAX_REFERENCE,
  nps: UNAVAILABLE_TAX_REFERENCE,
  sgb: UNAVAILABLE_TAX_REFERENCE,
});

// ─── RISK COLORS ──────────────────────────────────────────────────
export const RISK_COLORS = {
  "Very Low": "#14b8a6",
  "Low": "#10b981",
  "Low-Medium": "#22d3ee",
  "Medium-Low": "#22d3ee",
  "Medium": "#f59e0b",
  "High": "#ef4444",
  "Very High": "#fca5a5"
};

// ─── CHART COLORS ──────────────────────────────────────────────────
export const CHART_COLORS = [
  "#f59e0b", "#10b981", "#a855f7", "#3b82f6", "#14b8a6",
  "#06b6d4", "#ef4444", "#f97316", "#8b5cf6", "#6366f1",
  "#eab308", "#ec4899", "#22d3ee", "#dc2626", "#16a34a",
  "#ca8a04", "#84cc16", "#0ea5e9", "#4f46e5", "#db2777"
];

// ─── CONCENTRATION CAPS ──────────────────────────────────────────
export const CONCENTRATION_CAPS = {
  smallcap_mf: { maxPct: 15, badge: "Cap at 15% of portfolio" },
  midcap_mf: { maxPct: 20, badge: "Cap at 20% of portfolio" },
  direct_equity: { maxPct: 20, badge: "Cap at 20% of portfolio" },
  sgb: { maxPct: 10, badge: "Cap at 10% of portfolio" },
  gold_etf: { maxPct: 10, badge: "Cap at 10% of portfolio" },
  nps: { maxPct: 25, badge: "Illiquid until age 60 — plan accordingly" },
};

// Extract TRUST_BADGES from canonical JSON to maintain single source of truth
export const TRUST_BADGES = {};
masterCatalog.instruments.forEach(inst => {
  if (inst.staticData.trustBadge) {
    TRUST_BADGES[inst.id] = {
      type: inst.staticData.trustBadge.type,
      label: inst.staticData.trustBadge.label,
      body: inst.staticData.trustBadge.body,
      desc: inst.staticData.trustBadge.desc
    };
  }
});

// Map masterCatalog instruments to the old flat structure for backward compatibility
export const investmentDatabase = masterCatalog.instruments.map(inst => {
  return {
    id: inst.id,
    slug: inst.slug,
    name: inst.name,
    abbr: inst.abbr,
    category: inst.category,
    cat: inst.category, // cat mapped to category for compat
    assetClass: inst.assetClass,
    color: inst.color,
    eligibility: inst.eligibility,
    metadata: inst.metadata,
    
    // Static fields flattened
    description: inst.staticData.description,
    desc: inst.staticData.description, // desc mapped to description
    pros: inst.staticData.pros,
    cons: inst.staticData.cons,
    faq: inst.staticData.faq,
    taxation: inst.staticData.taxation,
    suitability: inst.staticData.suitability,
    trustBadge: inst.staticData.trustBadge,
    alternatives: inst.staticData.alternatives,
    explainer: inst.staticData.explainer,
    cardSubtitle: inst.staticData.cardSubtitle,
    
    // Dynamic fields flattened
    expectedReturn: inst.dynamicData.expectedReturn.avg,
    returnDataClass: 'MODEL_ASSUMPTION',
    returnAssumptionVersion: 'wealthgenie-projection-assumptions-1.0.0',
    returnSource: 'WEALTHGENIE_MODEL_POLICY',
    observedMarketFact: false,
    providerForecast: false,
    rate: inst.dynamicData.interestRates,
    returnRange: {
      min: inst.dynamicData.expectedReturn.min,
      max: inst.dynamicData.expectedReturn.max
    },
    riskLevel: inst.dynamicData.risk.value,
    risk: inst.dynamicData.risk.value,
    riskLabel: inst.dynamicData.risk.level,
    volatility: inst.dynamicData.risk.volatility,
    liquidityScore: inst.dynamicData.liquidity.score,
    lockIn: inst.dynamicData.liquidity.lockIn,
    taxType: inst.dynamicData.taxType,
    taxEfficiencyScore: inst.dynamicData.taxEfficiencyScore,
    expenseRatio: inst.dynamicData.expenseRatio,
    minMonthlyInvestment: inst.dynamicData.minMonthlyInvestment,
    maxAnnualInvestment: inst.dynamicData.maxAnnualInvestment,
    idealHorizon: inst.dynamicData.idealHorizon,
    goalTags: inst.dynamicData.goalTags,
    
    // Keep nested references for new code
    staticData: inst.staticData,
    dynamicData: inst.dynamicData
  };
});
