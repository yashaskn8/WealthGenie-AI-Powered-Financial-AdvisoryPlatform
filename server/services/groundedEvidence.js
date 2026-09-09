import crypto from 'crypto';

export const GROUNDED_EVIDENCE_VERSION = 'grounded-financial-evidence-1.0.0';

export const EXTERNAL_LLM_PROFILE_FIELDS = Object.freeze([
  'age',
  'monthlySavings',
  'riskTolerance',
  'suitabilityRisk',
  'investmentHorizonYears',
  'investmentGoals',
  'suitabilityReasonCodes',
]);

const CONDITIONAL_PROFILE_FIELDS = Object.freeze({
  monthlyTakeHome: /income|take[- ]?home|salary|cash flow|saving/i,
  savingsRate: /saving|cash flow|capacity/i,
  liquidSavings: /liquid|emergency|cash/i,
  emiBurdenPct: /emi|debt|loan/i,
  financialDependents: /dependent|family/i,
  emergencyFundMonths: /emergency/i,
  deployableLumpSum: /lump[ -]?sum|one[ -]?time|capital/i,
});

const BASE_PROFILE_FIELDS = Object.freeze([
  'age',
  'monthlySavings',
  'riskTolerance',
  'suitabilityRisk',
  'investmentHorizonYears',
  'investmentGoals',
  'suitabilityReasonCodes',
]);

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

export function hashGroundedEvidence(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function entry(id, kind, value, {
  dataClass,
  displayValue = null,
  source = null,
  observedAt = null,
  freshness = null,
  authority = 'WEALTHGENIE_BACKEND',
} = {}) {
  return Object.freeze({
    id,
    kind,
    value,
    displayValue,
    dataClass,
    source,
    observedAt,
    freshness,
    authority,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.values(value).forEach(deepFreeze);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function compactSource(source) {
  if (!source || typeof source !== 'object') return null;
  return {
    provider: source.provider ?? null,
    url: source.url ?? null,
    publicationDate: source.publicationDate ?? null,
    instrumentId: source.instrumentId ?? null,
  };
}

function profileEntries(profile, question) {
  if (!profile) return [];
  const rows = [
    entry('E_PROFILE_AGE', 'PROFILE', profile.age, { dataClass: 'USER_INPUT', displayValue: `${profile.age} years` }),
    entry('E_PROFILE_SAVINGS', 'PROFILE', profile.monthlySavings, { dataClass: 'USER_INPUT', displayValue: `INR ${Number(profile.monthlySavings).toLocaleString('en-IN')} per month` }),
    entry('E_PROFILE_RISK', 'SUITABILITY', {
      statedRiskTolerance: profile.riskTolerance,
      finalSuitabilityRisk: profile.suitabilityRisk,
    }, { dataClass: 'DERIVED_VALUE', displayValue: `${profile.suitabilityRisk} final suitability ceiling` }),
    entry('E_PROFILE_HORIZON', 'PROFILE', profile.investmentHorizonYears, { dataClass: 'USER_INPUT', displayValue: `${profile.investmentHorizonYears} years` }),
    entry('E_PROFILE_GOALS', 'PROFILE', profile.investmentGoals, { dataClass: 'USER_INPUT', displayValue: (profile.investmentGoals || []).join(', ') }),
    entry('E_SUITABILITY_REASONS', 'SUITABILITY', profile.suitabilityReasonCodes || [], { dataClass: 'DERIVED_VALUE', displayValue: (profile.suitabilityReasonCodes || []).join(', ') || 'No reason codes available' }),
  ];
  for (const [field, pattern] of Object.entries(CONDITIONAL_PROFILE_FIELDS)) {
    if (!pattern.test(question || '') || profile[field] === undefined || profile[field] === null) continue;
    const id = `E_PROFILE_${field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
    rows.push(entry(id, 'PROFILE', profile[field], {
      dataClass: field === 'savingsRate' ? 'DERIVED_VALUE' : 'USER_INPUT',
      displayValue: String(profile[field]),
    }));
  }
  return rows;
}

function recommendationEntries(recommendation) {
  if (!recommendation || !Array.isArray(recommendation.instruments) || recommendation.instruments.length === 0) return [];
  const rows = [entry('E_REC_POLICY', 'RECOMMENDATION', {
    modelVersion: recommendation.modelVersion ?? null,
    profileInputHash: recommendation.profileInputHash ?? null,
  }, {
    dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
    displayValue: `Recommendation model ${recommendation.modelVersion || 'unavailable'}`,
  })];
  recommendation.instruments.slice(0, 8).forEach((instrument, index) => {
    const allocationPct = Number.isFinite(Number(instrument.allocation_pct))
      ? Number(instrument.allocation_pct)
      : Number(instrument.allocationWeight) * 100;
    const modelReturnAssumptionPct = Number.isFinite(Number(instrument.nominalReturn))
      ? Number(instrument.nominalReturn)
      : null;
    rows.push(entry(`E_REC_${String(index + 1).padStart(3, '0')}`, 'RECOMMENDATION', {
      instrumentId: instrument.id,
      name: instrument.name,
      type: instrument.type,
      allocationPct,
      modelReturnAssumptionPct,
      returnDataClass: instrument.returnDataClass || 'MODEL_ASSUMPTION',
      returnAssumptionVersion: instrument.returnAssumptionVersion ?? null,
      providerForecast: false,
      riskLevel: instrument.riskLevel ?? null,
    }, {
      dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
      displayValue: modelReturnAssumptionPct === null
        ? `${instrument.name}: ${allocationPct}% allocation; return assumption unavailable`
        : `${instrument.name}: ${allocationPct}% allocation; ${modelReturnAssumptionPct}% pre-tax nominal model assumption`,
    }));
  });
  return rows;
}

export function buildGroundedEvidencePacket({
  question,
  profile,
  recommendation = null,
  additionalEntries = [],
  unavailableFacts = [],
  purpose = 'FINANCIAL_EXPLANATION',
}) {
  const entries = [
    ...profileEntries(profile, question),
    ...recommendationEntries(recommendation),
    ...additionalEntries,
    entry('E_REGULATORY_NOTICE', 'DISCLOSURE', 'For informational purposes only. Not registered investment advice under SEBI (IA) Regulations, 2013. Consult a SEBI-registered adviser before investing. Mutual fund investments are subject to market risks.', {
      dataClass: 'REFERENCE_METADATA',
      displayValue: 'For informational purposes only. Not registered investment advice under SEBI (IA) Regulations, 2013.',
    }),
  ];
  const uniqueEntries = [...new Map(entries.map(item => [item.id, item])).values()];
  const sentProfileFields = [
    ...BASE_PROFILE_FIELDS.filter(field => profile?.[field] !== undefined),
    ...Object.entries(CONDITIONAL_PROFILE_FIELDS)
      .filter(([field, pattern]) => pattern.test(question || '') && profile?.[field] !== undefined && profile?.[field] !== null)
      .map(([field]) => field),
  ];
  const packet = {
    groundingVersion: GROUNDED_EVIDENCE_VERSION,
    purpose,
    entries: uniqueEntries,
    unavailableFacts: [...new Set(unavailableFacts.filter(Boolean))],
    privacy: {
      sentProfileFields: [...new Set(sentProfileFields)],
      excludedFields: ['email', 'phone', 'passwordHash', 'jwt', 'address', 'mongoUserId'],
    },
  };
  return deepFreeze({ ...packet, evidenceHash: hashGroundedEvidence(packet) });
}

export function evidenceEntryFromMarketContext(context) {
  if (!context || context.status !== 'MARKET_CONTEXT_AVAILABLE') return null;
  return entry('E_MARKET_CONTEXT', 'MARKET_CONTEXT', {
    context: context.context,
    candidateContext: context.candidateContext,
    policyVersion: context.policyVersion,
    reasonCodes: context.reasonCodes || [],
    signals: context.signals || context.features || null,
    sources: (context.sources || []).map(compactSource),
    authorityRole: 'DETERMINISTIC_POLICY_CHAMPION',
  }, {
    dataClass: 'DETERMINISTIC_POLICY_RESULT',
    displayValue: `${context.context} deterministic market context`,
    observedAt: context.observedAt ?? context.evaluatedAt ?? null,
    freshness: context.freshness ?? null,
    source: compactSource(context.sources?.[0]),
  });
}

export function evidenceEntryFromOfficialRate(product, index = 0) {
  const rate = product?.officialRate;
  if (!product || !rate || !Number.isFinite(Number(rate.value))) return null;
  return entry(`E_OFFICIAL_RATE_${String(index + 1).padStart(3, '0')}`, 'PRODUCT_FACT', {
    productId: product.id,
    name: product.name,
    ratePctPerAnnum: Number(rate.value),
    rateBasis: rate.basis,
    effectiveFrom: rate.effectiveFrom,
    effectiveTo: rate.effectiveTo,
    tenure: product.tenure ?? null,
    depositorType: product.depositorType ?? null,
    comparisonStatus: product.presentationStatus,
  }, {
    dataClass: rate.dataClass || 'VERIFIED_PRODUCT_FACT',
    displayValue: `${product.name}: ${rate.value}% p.a. effective ${rate.effectiveFrom}${rate.effectiveTo ? ` to ${rate.effectiveTo}` : ''}`,
    source: compactSource(product.source),
    observedAt: rate.observedAt ?? null,
    freshness: product.freshness ?? null,
  });
}

export function evidenceEntryFromProjectionAssumption(instrumentId, assumption) {
  if (!assumption) return null;
  return entry(`E_PROJECTION_ASSUMPTION_${String(instrumentId).replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`, 'PROJECTION', {
    instrumentId,
    annualReturnAssumptionPct: Number.isFinite(Number(assumption.mean)) ? Number(assumption.mean) * 100 : null,
    annualVolatilityAssumptionPct: Number.isFinite(Number(assumption.stdDev)) ? Number(assumption.stdDev) * 100 : null,
    assumptionVersion: assumption.assumptionVersion,
    providerForecast: false,
  }, {
    dataClass: 'MODEL_ASSUMPTION',
    displayValue: `${instrumentId} uses WealthGenie model assumptions; provider forecast is false`,
    source: { provider: assumption.source || 'WEALTHGENIE_MODEL_POLICY', url: null, publicationDate: null, instrumentId },
  });
}

export function makeEvidenceEntry(...args) {
  return entry(...args);
}
