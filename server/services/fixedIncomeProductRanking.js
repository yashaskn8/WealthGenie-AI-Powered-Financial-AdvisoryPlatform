import { AVAILABILITY, FACT_KINDS, FRESHNESS, MARKET_DATA_SCHEMA_VERSION, PROVIDERS } from './marketData/contracts.js';
import { GOVERNMENT_RATE_DATA_CLASS, INDIA_POST_SAVINGS_URL } from './marketData/GovernmentSmallSavingsProvider.js';
import { RBI_FRSB_NOTIFICATION_URL, RBI_RATE_DATA_CLASS } from './marketData/RbiFloatingRateSavingsBondProvider.js';
import { SBI_RATE_DATA_CLASS, SBI_TERM_DEPOSIT_URL } from './marketData/SbiTermDepositProvider.js';

export const FIXED_INCOME_RANKING_VERSION = 'wti-fixed-income-comparison-1.0.0';

const GOVERNMENT_PARENT_SCHEMES = Object.freeze({
  ppf: 'ppf',
  scss: 'scss',
  sukanya: 'sukanya',
  nsc: 'nsc',
  kvp: 'kvp',
  pomis: 'pomis',
  po_rd: 'post-office-rd-5y',
  po_td_1yr: 'post-office-td-1y',
});

const SBI_PARENT_IDS = new Set(['fd', 'sbi_fd']);
const RBI_PARENT_IDS = new Set(['rbi_bonds']);

export function fixedIncomeProviderForParent(parentInstrumentId) {
  if (Object.hasOwn(GOVERNMENT_PARENT_SCHEMES, parentInstrumentId)) return PROVIDERS.GOVERNMENT_OF_INDIA;
  if (SBI_PARENT_IDS.has(parentInstrumentId)) return PROVIDERS.SBI;
  if (RBI_PARENT_IDS.has(parentInstrumentId)) return PROVIDERS.RBI;
  return null;
}

export function supportsFixedIncomeParentCategory(parentInstrumentId) {
  return fixedIncomeProviderForParent(parentInstrumentId) !== null;
}

function unavailable(reasonCodes, provider, disclosure) {
  return {
    products: [],
    ranking: {
      version: FIXED_INCOME_RANKING_VERSION,
      status: 'UNAVAILABLE',
      provider,
      reasonCodes,
      arbitraryWeightedScoreUsed: false,
      forcedResultCount: false,
    },
    comparisonUniverse: {
      dataClass: 'UNAVAILABLE',
      provider,
      eligibleProductCount: 0,
      disclosure,
    },
  };
}

function commonProductDto(product, fact, parentInstrumentId) {
  return {
    id: product.canonicalProductId,
    canonicalProductId: product.canonicalProductId,
    parentInstrumentId,
    productType: product.productType,
    presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
    rank: null,
    tiedRank: false,
    name: product.name,
    provider: product.providerName,
    source: fact.source,
    officialRate: {
      value: fact.value,
      unit: fact.unit,
      basis: fact.rateBasis,
      effectiveFrom: fact.effectiveFrom,
      effectiveTo: fact.effectiveTo,
      publicationDate: fact.publicationDate,
      observedAt: fact.observedAt,
      fetchedAt: fact.fetchedAt,
      dataClass: fact.dataClass,
    },
    valuationDate: null,
    freshness: fact.freshness,
    availabilityStatus: fact.availabilityStatus,
    productEligibility: {
      eligible: true,
      status: 'PARENT_SUITABILITY_PASSED',
      scope: 'PARENT_HARD_SUITABILITY_ONLY',
      reasonCodes: ['PARENT_HARD_SUITABILITY_PASSED'],
      productSpecificTermsStatus: 'UNAVAILABLE_NOT_SOURCE_QUALIFIED_IN_PHASE_5',
    },
    rankingReasonCodes: [
      'OFFICIAL_SOURCE_FACT_VERIFIED',
      'NO_CROSS_TENURE_OR_CROSS_PRODUCT_MERIT_RANKING',
      'VERIFIED_COMPARABLE_OPTION_ONLY',
    ],
    nav: null,
    historicalReturn: null,
    expectedReturn: null,
    nominalReturn: null,
    effectiveYield: null,
    postTaxReturn: null,
    taxClassification: null,
    expenseRatio: null,
    aum: null,
    riskLevel: null,
    riskScore: null,
    benchmark: null,
    trackingError: null,
    minimumInvestment: null,
    minInvestment: null,
    platform: null,
    score: null,
    plan: null,
    option: null,
  };
}

function indiaDateAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function isUsableFact(fact, now) {
  const today = indiaDateAt(now);
  const effectiveFrom = fact?.effectiveFrom == null ? null : String(fact.effectiveFrom).slice(0, 10);
  const effectiveTo = fact?.effectiveTo == null ? null : String(fact.effectiveTo).slice(0, 10);
  const hasValidEffectivePeriod = (!effectiveFrom || /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))
    && (!effectiveTo || /^\d{4}-\d{2}-\d{2}$/.test(effectiveTo))
    && (!effectiveFrom || !effectiveTo || effectiveFrom <= effectiveTo);
  return fact?.availabilityStatus === AVAILABILITY.AVAILABLE
    && fact?.freshness?.status === FRESHNESS.FRESH
    && Number.isFinite(Number(fact.value))
    && Number(fact.value) > 0
    && today !== null
    && hasValidEffectivePeriod
    && (!effectiveFrom || today >= effectiveFrom)
    && (!effectiveTo || today <= effectiveTo);
}

function hasQualifiedFact(fact, {
  canonicalProductId,
  provider,
  sourceInstrumentId,
  sourceUrl,
  dataClass,
  rateBasis,
  kind = FACT_KINDS.SCHEME_INTEREST_RATE,
}) {
  return fact?.schemaVersion === MARKET_DATA_SCHEMA_VERSION
    && fact.kind === kind
    && fact.canonicalProductId === canonicalProductId
    && fact.source?.provider === provider
    && fact.source?.instrumentId === sourceInstrumentId
    && fact.source?.url === sourceUrl
    && fact.unit === 'PERCENT_PER_ANNUM'
    && fact.dataClass === dataClass
    && fact.rateBasis === rateBasis;
}

function hasQualifiedProduct(product, { canonicalProductId, provider, productType, sourceUrl }) {
  return product?.schemaVersion === MARKET_DATA_SCHEMA_VERSION
    && product.canonicalProductId === canonicalProductId
    && product.productType === productType
    && product.source?.provider === provider
    && product.source?.url === sourceUrl;
}

export function selectCurrentEffectiveFact(facts, canonicalProductId, now = new Date()) {
  return (facts || [])
    .filter(fact => fact.canonicalProductId === canonicalProductId && isUsableFact(fact, now))
    .sort((left, right) => String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || '')))[0] || null;
}

function selectGovernmentProduct(parentInstrumentId, snapshot, now) {
  const schemeId = GOVERNMENT_PARENT_SCHEMES[parentInstrumentId];
  const canonicalId = `government:india-post:${schemeId}`;
  const product = (snapshot?.products || []).find(item => item.canonicalProductId === canonicalId);
  const fact = selectCurrentEffectiveFact(snapshot?.facts, canonicalId, now);
  const productValid = hasQualifiedProduct(product, {
    canonicalProductId: canonicalId,
    provider: PROVIDERS.GOVERNMENT_OF_INDIA,
    productType: 'GOVERNMENT_SCHEME',
    sourceUrl: INDIA_POST_SAVINGS_URL,
  }) && product.externalIds?.some(item => item.source === 'INDIA_POST_SCHEME_ID' && item.value === schemeId);
  const factValid = isUsableFact(fact, now) && hasQualifiedFact(fact, {
    canonicalProductId: canonicalId,
    provider: PROVIDERS.GOVERNMENT_OF_INDIA,
    sourceInstrumentId: schemeId,
    sourceUrl: INDIA_POST_SAVINGS_URL,
    dataClass: GOVERNMENT_RATE_DATA_CLASS,
    rateBasis: 'OFFICIAL_NOMINAL_RATE_PER_ANNUM',
  });
  return productValid && factValid ? { product, fact } : null;
}

function selectComparableSbiProduct(profile, snapshot, now) {
  const horizonDays = Number(profile?.investmentHorizonYears) * 365;
  const depositorType = Number(profile?.age) >= 60 ? 'SENIOR_CITIZEN' : 'GENERAL_PUBLIC';
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) return null;
  const product = (snapshot?.products || []).find(item => (
    item.depositorType === depositorType
      && Number(item.tenureMinDays) <= horizonDays
      && horizonDays < Number(item.tenureMaxDaysExclusive)
  ));
  const fact = product
    ? (snapshot?.facts || []).find(item => item.canonicalProductId === product.canonicalProductId)
    : null;
  const canonicalProductId = product?.canonicalProductId;
  const idMatch = typeof canonicalProductId === 'string'
    && /^deposit:sbi:retail-domestic:[a-z0-9-]+:(?:public|senior)$/.test(canonicalProductId);
  const depositorSlug = product?.depositorType === 'SENIOR_CITIZEN' ? 'senior' : 'public';
  const tenureId = idMatch ? canonicalProductId.match(/^deposit:sbi:retail-domestic:([a-z0-9-]+):/)[1] : null;
  const expectedInstrumentId = tenureId ? `retail-domestic:${tenureId}:${depositorSlug}` : null;
  const productValid = idMatch
    && product.schemaVersion === MARKET_DATA_SCHEMA_VERSION
    && product.productType === 'BANK_TERM_DEPOSIT'
    && product.providerName === 'State Bank of India'
    && product.source?.provider === PROVIDERS.SBI
    && product.source?.url === SBI_TERM_DEPOSIT_URL
    && product.externalIds?.some(item => item.source === 'SBI_TENURE_CLASS' && item.value === tenureId)
    && product.depositType === 'RETAIL_DOMESTIC_TERM_DEPOSIT_BELOW_INR_3_CRORE'
    && product.callability === 'CALLABLE_STANDARD_CARD_RATE';
  const factValid = isUsableFact(fact, now) && hasQualifiedFact(fact, {
    canonicalProductId,
    provider: PROVIDERS.SBI,
    sourceInstrumentId: expectedInstrumentId,
    sourceUrl: SBI_TERM_DEPOSIT_URL,
    dataClass: SBI_RATE_DATA_CLASS,
    rateBasis: 'OFFICIAL_NOMINAL_CARD_RATE_PER_ANNUM',
    kind: FACT_KINDS.TERM_DEPOSIT_RATE,
  });
  return productValid && factValid ? { product, fact } : null;
}

function selectRbiProduct(snapshot, now) {
  const canonicalId = 'government:rbi:frsb-2020-taxable';
  const product = (snapshot?.products || []).find(item => item.canonicalProductId === canonicalId);
  const fact = selectCurrentEffectiveFact(snapshot?.facts, canonicalId, now);
  const productValid = hasQualifiedProduct(product, {
    canonicalProductId: canonicalId,
    provider: PROVIDERS.RBI,
    productType: 'GOVERNMENT_BOND',
    sourceUrl: RBI_FRSB_NOTIFICATION_URL,
  }) && product.providerName === 'Government of India / Reserve Bank of India'
    && product.tenureMonths === 84
    && product.couponResetFrequency === 'SEMI_ANNUAL'
    && product.interestPaymentFrequency === 'SEMI_ANNUAL'
    && product.referenceRate === 'NSC'
    && product.spreadBps === 35;
  const factValid = isUsableFact(fact, now) && hasQualifiedFact(fact, {
    canonicalProductId: canonicalId,
    provider: PROVIDERS.RBI,
    sourceInstrumentId: 'frsb-2020-taxable',
    sourceUrl: RBI_FRSB_NOTIFICATION_URL,
    dataClass: RBI_RATE_DATA_CLASS,
    rateBasis: 'NSC_REFERENCE_RATE_PLUS_35_BPS',
  }) && fact.kind === FACT_KINDS.SCHEME_INTEREST_RATE
    && fact.referenceRate === 'NSC'
    && fact.spreadBps === 35;
  return productValid && factValid ? { product, fact } : null;
}

export function compareVerifiedFixedIncomeProducts({ parentInstrumentId, snapshot, profile, now = new Date() }) {
  const currentTime = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(currentTime.getTime())) throw new TypeError('now must be a valid date.');
  const provider = fixedIncomeProviderForParent(parentInstrumentId);
  if (!provider) {
    return unavailable(
      ['FIXED_INCOME_PROVIDER_NOT_QUALIFIED'],
      null,
      'No official provider adapter is qualified for this fixed-income parent category.',
    );
  }
  if (![AVAILABILITY.AVAILABLE, AVAILABILITY.PARTIAL].includes(snapshot?.status)) {
    return unavailable(
      [snapshot?.error?.code || 'OFFICIAL_SOURCE_UNAVAILABLE'],
      provider,
      'The official source did not provide a usable current snapshot. No static rate was substituted.',
    );
  }
  if (snapshot?.schemaVersion !== MARKET_DATA_SCHEMA_VERSION || snapshot?.provider !== provider) {
    return unavailable(
      ['OFFICIAL_SOURCE_IDENTITY_MISMATCH'],
      provider,
      'The snapshot identity did not match the qualified provider contract. No source fact was presented.',
    );
  }

  let selected = null;
  if (provider === PROVIDERS.GOVERNMENT_OF_INDIA) {
    selected = selectGovernmentProduct(parentInstrumentId, snapshot, currentTime);
  } else if (provider === PROVIDERS.SBI) {
    selected = selectComparableSbiProduct(profile, snapshot, currentTime);
  } else if (provider === PROVIDERS.RBI) {
    selected = selectRbiProduct(snapshot, currentTime);
  }

  if (!selected) {
    let reason = 'CURRENT_EFFECTIVE_SCHEME_RATE_UNAVAILABLE';
    if (provider === PROVIDERS.SBI) {
      reason = 'NO_SAME_TENURE_AND_DEPOSITOR_CLASS_PRODUCT';
    } else if (provider === PROVIDERS.RBI) {
      reason = snapshot?.error?.code || 'RBI_FRSB_COUPON_UNAVAILABLE';
    }
    return unavailable(
      [reason],
      provider,
      provider === PROVIDERS.RBI
        ? 'The official RBI floating coupon or reference NSC rate could not be verified. No static rate was substituted.'
        : 'No source-qualified product matches the exact scheme or comparable tenure and depositor class.',
    );
  }

  const dto = commonProductDto(selected.product, selected.fact, parentInstrumentId);
  if (provider === PROVIDERS.GOVERNMENT_OF_INDIA) {
    dto.compoundingBasis = selected.fact.compoundingBasis ?? null;
    dto.tenureMonths = selected.product.tenureMonths ?? null;
  } else if (provider === PROVIDERS.SBI) {
    dto.tenure = {
      label: selected.product.tenureLabel,
      minDays: selected.product.tenureMinDays,
      maxDaysExclusive: selected.product.tenureMaxDaysExclusive,
    };
    dto.depositorType = selected.product.depositorType;
    dto.depositType = selected.product.depositType;
    dto.callability = selected.product.callability;
    dto.riskQuality = null;
  } else if (provider === PROVIDERS.RBI) {
    dto.tenureMonths = selected.product.tenureMonths;
    dto.couponResetFrequency = selected.product.couponResetFrequency;
    dto.interestPaymentFrequency = selected.product.interestPaymentFrequency;
    dto.referenceRate = selected.product.referenceRate;
    dto.spreadBps = selected.product.spreadBps;
    dto.rankingReasonCodes = [
      'OFFICIAL_SOURCE_FACT_VERIFIED',
      'SINGLE_CANONICAL_PRODUCT',
      'MERIT_RANKING_NOT_CLAIMED',
    ];
  }

  const rankingReasonCodes = provider === PROVIDERS.RBI
    ? ['OFFICIAL_SOURCE_FACT_VERIFIED', 'SINGLE_CANONICAL_PRODUCT', 'MERIT_RANKING_NOT_CLAIMED']
    : ['OFFICIAL_SOURCE_FACT_VERIFIED', 'MERIT_RANKING_NOT_CLAIMED'];

  return {
    products: [dto],
    ranking: {
      version: FIXED_INCOME_RANKING_VERSION,
      status: 'VERIFIED_COMPARABLE_OPTIONS',
      provider,
      reasonCodes: rankingReasonCodes,
      arbitraryWeightedScoreUsed: false,
      forcedResultCount: false,
      hasUniqueLeader: false,
    },
    comparisonUniverse: {
      dataClass: selected.fact.dataClass,
      provider,
      eligibleProductCount: 1,
      effectiveFrom: selected.fact.effectiveFrom,
      effectiveTo: selected.fact.effectiveTo,
      disclosure: provider === PROVIDERS.SBI
        ? 'One SBI card-rate option matching the profile horizon and source-established depositor class. Different tenures and depositor classes are excluded; no best-FD claim is made.'
        : provider === PROVIDERS.RBI
          ? 'The single canonical Floating Rate Savings Bond (Taxable) issued by Government of India / RBI. Coupon is officially linked to the prevailing NSC rate plus 35 bps reset semi-annually.'
          : 'The exact India Post government scheme within the already suitable parent category. Its official interval rate is shown without a cross-scheme merit ranking.',
    },
  };
}
