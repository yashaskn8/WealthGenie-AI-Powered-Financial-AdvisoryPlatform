import { AVAILABILITY, FRESHNESS, PROVIDERS } from './marketData/contracts.js';

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

function isUsableFact(fact) {
  return fact?.availabilityStatus === AVAILABILITY.AVAILABLE
    && fact?.freshness?.status === FRESHNESS.FRESH
    && Number.isFinite(Number(fact.value));
}

export function selectCurrentEffectiveFact(facts, canonicalProductId) {
  return (facts || [])
    .filter(fact => fact.canonicalProductId === canonicalProductId && isUsableFact(fact))
    .sort((left, right) => String(right.effectiveFrom || '').localeCompare(String(left.effectiveFrom || '')))[0] || null;
}

function selectGovernmentProduct(parentInstrumentId, snapshot) {
  const schemeId = GOVERNMENT_PARENT_SCHEMES[parentInstrumentId];
  const canonicalId = `government:india-post:${schemeId}`;
  const product = (snapshot?.products || []).find(item => item.canonicalProductId === canonicalId);
  const fact = selectCurrentEffectiveFact(snapshot?.facts, canonicalId);
  return product && isUsableFact(fact) ? { product, fact } : null;
}

function selectComparableSbiProduct(profile, snapshot) {
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
  return product && isUsableFact(fact) ? { product, fact } : null;
}

function selectRbiProduct(snapshot) {
  const canonicalId = 'government:rbi:frsb-2020-taxable';
  const product = (snapshot?.products || []).find(item => item.canonicalProductId === canonicalId);
  const fact = selectCurrentEffectiveFact(snapshot?.facts, canonicalId);
  return product && isUsableFact(fact) ? { product, fact } : null;
}

export function compareVerifiedFixedIncomeProducts({ parentInstrumentId, snapshot, profile }) {
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

  let selected = null;
  if (provider === PROVIDERS.GOVERNMENT_OF_INDIA) {
    selected = selectGovernmentProduct(parentInstrumentId, snapshot);
  } else if (provider === PROVIDERS.SBI) {
    selected = selectComparableSbiProduct(profile, snapshot);
  } else if (provider === PROVIDERS.RBI) {
    selected = selectRbiProduct(snapshot);
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
    dto.tenureMonths = selected.product.tenureMonths ?? 84;
    dto.couponResetFrequency = selected.product.couponResetFrequency ?? 'SEMI_ANNUAL';
    dto.interestPaymentFrequency = selected.product.interestPaymentFrequency ?? 'SEMI_ANNUAL';
    dto.referenceRate = selected.product.referenceRate ?? 'NSC';
    dto.spreadBps = selected.product.spreadBps ?? 35;
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
