import { AVAILABILITY, FRESHNESS, PROVIDERS } from './marketData/contracts.js';

export const MUTUAL_FUND_RANKING_VERSION = 'wti-mutual-fund-ranking-2.0.1';
export const MUTUAL_FUND_RESULT_LIMIT = 5;
export const HISTORICAL_RETURN_BASIS = 'HISTORICAL_POINT_TO_POINT_NAV_RETURN_1Y';
export const EVIDENCE_RANKING_PLAN_CLASS = 'DIRECT';

const COMPARISON_ONLY_PARENT_CATEGORIES = new Set(['fixed_maturity_plan']);

/**
 * Exact AMFI report headings qualified for an existing parent category.
 * These are explicit aliases observed in the official report, not product-name
 * guesses. Broad index and sector/thematic headings are intentionally absent
 * because they do not establish a benchmark or a specific sector.
 */
export const AMFI_CATEGORIES_BY_PARENT = Object.freeze({
  banking_psu_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Banking and PSU Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Banking and PSU Debt Fund)',
  ]),
  corporate_bond_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Corporate Bond Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Corporate Bond Fund)',
  ]),
  credit_risk_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Credit Risk Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Credit Risk Fund)',
  ]),
  dynamic_bond_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Dynamic Bond)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Dynamic Term Fund)',
  ]),
  gilt_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Gilt Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Gilt Fund)',
  ]),
  liquid_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Liquid Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Liquid Fund)',
  ]),
  low_duration_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Low Duration Fund)',
  ]),
  medium_duration_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Medium Duration Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Medium Term Fund)',
  ]),
  money_market_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Money Market Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Money Market Fund)',
  ]),
  overnight_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Overnight Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Overnight Fund)',
  ]),
  short_duration_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Short Duration Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Short Term Fund)',
  ]),
  ultra_short_mf: Object.freeze([
    'Open Ended Schemes(Debt Scheme - Ultra Short Duration Fund)',
    'Open Ended Schemes(Income/Debt Oriented Schemes - Ultra Short Term Fund)',
  ]),
  floater_mf: Object.freeze([
    'Open Ended Schemes(Income/Debt Oriented Schemes - Floating Interest Rates Fund)',
  ]),
  floating_rate_debt_mf: Object.freeze([
    'Open Ended Schemes(Income/Debt Oriented Schemes - Floating Interest Rates Fund)',
  ]),
  large_cap_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Large Cap Fund)',
    'Open Ended Schemes(Equity Schemes - Large Cap Fund)',
  ]),
  large_mid_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Large & Mid Cap Fund)',
    'Open Ended Schemes(Equity Schemes - Large & Mid Cap Fund)',
  ]),
  midcap_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Mid Cap Fund)',
    'Open Ended Schemes(Equity Schemes - Mid Cap Fund)',
  ]),
  smallcap_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Small Cap Fund)',
    'Open Ended Schemes(Equity Schemes - Small Cap Fund)',
  ]),
  flexi_cap_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)',
    'Open Ended Schemes(Equity Schemes - Flexi Cap Fund)',
  ]),
  multi_cap_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Multi Cap Fund)',
    'Open Ended Schemes(Equity Schemes - Multi Cap Fund)',
  ]),
  focused_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Focused Fund)',
    'Open Ended Schemes(Equity Schemes - Focused Fund)',
  ]),
  value_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Value Fund)',
    'Open Ended Schemes(Equity Schemes - Value Fund)',
  ]),
  contra_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Contra Fund)',
    'Open Ended Schemes(Equity Schemes - Contra Fund)',
  ]),
  dividend_yield_mf: Object.freeze([
    'Open Ended Schemes(Equity Scheme - Dividend Yield Fund)',
    'Open Ended Schemes(Equity Schemes - Dividend Yield Fund)',
  ]),
  elss: Object.freeze([
    'Open Ended Schemes(Equity Scheme - ELSS)',
    'Open Ended Schemes(Equity Schemes - ELSS- Tax Saver Fund)',
  ]),
  agg_hybrid_mf: Object.freeze([
    'Open Ended Schemes(Hybrid Scheme - Aggressive Hybrid Fund)',
    'Open Ended Schemes(Hybrid Schemes - Aggressive Hybrid Fund)',
  ]),
  conservative_hybrid_mf: Object.freeze([
    'Open Ended Schemes(Hybrid Scheme - Conservative Hybrid Fund)',
    'Open Ended Schemes(Hybrid Schemes - Conservative Hybrid Fund)',
  ]),
  hybrid_mf: Object.freeze([
    'Open Ended Schemes(Hybrid Scheme - Dynamic Asset Allocation or Balanced Advantage)',
    'Open Ended Schemes(Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation)',
  ]),
  equity_savings_mf: Object.freeze([
    'Open Ended Schemes(Hybrid Scheme - Equity Savings)',
    'Open Ended Schemes(Hybrid Schemes - Equity Savings Fund)',
  ]),
  multi_asset_allocation_mf: Object.freeze([
    'Open Ended Schemes(Hybrid Scheme - Multi Asset Allocation)',
    'Open Ended Schemes(Hybrid Schemes - Multi Asset Allocation Fund)',
  ]),
  children_solution_fund: Object.freeze([
    'Open Ended Schemes(Children’s Fund - Childrens\' Fund)',
    'Open Ended Schemes(Solution Oriented Scheme - Children’s Fund)',
  ]),
  retirement_solution_fund: Object.freeze([
    'Open Ended Schemes(Solution Oriented Scheme - Retirement Fund)',
    'Open Ended Schemes(Solution Oriented Schemes ** - Retirement Fund)',
  ]),
  fixed_maturity_plan: Object.freeze([
    'Close Ended Schemes(Income/Debt Oriented Schemes - Fixed Term Plan)',
  ]),
});

function exactCategoryKey(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : null;
}

function establishedNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceSchemeCode(product) {
  return product.externalIds?.find(item => item.source === 'AMFI_SCHEME_CODE')?.value || null;
}

function isEstablishedGrowthOption(option) {
  return typeof option === 'string' && /\bgrowth\b/i.test(option.trim());
}

/**
 * Classify only the dedicated AMFI Plan field. Product names are deliberately
 * excluded so an absent or unfamiliar value can never be promoted to Direct.
 */
export function sourceEstablishedPlanClass(plan) {
  if (typeof plan !== 'string') return null;
  const normalized = plan.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized === 'direct' || normalized === 'direct plan') return 'DIRECT';
  if (normalized === 'regular' || normalized === 'regular plan') return 'REGULAR';
  return null;
}

function annualizedHistoricalReturn(currentFact, historicalFact) {
  const endNav = establishedNumber(currentFact?.value);
  const startNav = establishedNumber(historicalFact?.value);
  const startTime = Date.parse(historicalFact?.observedAt);
  const endTime = Date.parse(currentFact?.observedAt);
  if (endNav === null || startNav === null || endNav <= 0 || startNav <= 0
      || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;
  const elapsedDays = (endTime - startTime) / (24 * 60 * 60 * 1000);
  if (elapsedDays < 330 || elapsedDays > 400) return null;
  const valuePct = (Math.pow(endNav / startNav, 365 / elapsedDays) - 1) * 100;
  if (!Number.isFinite(valuePct)) return null;
  return {
    valuePct: Number(valuePct.toFixed(6)),
    basis: HISTORICAL_RETURN_BASIS,
    annualized: true,
    startNav,
    startDate: historicalFact.observedAt.slice(0, 10),
    endNav,
    endDate: currentFact.observedAt.slice(0, 10),
    elapsedDays: Number(elapsedDays.toFixed(2)),
    source: {
      provider: PROVIDERS.AMFI,
      startObservationUrl: historicalFact.source?.url ?? null,
      endObservationUrl: currentFact.source?.url ?? null,
    },
  };
}

function buildProductDto({
  product,
  currentFact,
  historicalReturn,
  parentInstrumentId,
  presentationStatus,
  rank = null,
  tiedRank = false,
}) {
  const schemeCode = sourceSchemeCode(product);
  const ranked = presentationStatus === 'VERIFIED_RANKED_PRODUCT';
  return {
    id: product.canonicalProductId,
    canonicalProductId: product.canonicalProductId,
    parentInstrumentId,
    productType: 'MUTUAL_FUND',
    presentationStatus,
    rank,
    tiedRank,
    name: product.name,
    provider: product.providerName ?? null,
    plan: product.plan ?? null,
    planClass: sourceEstablishedPlanClass(product.plan),
    option: product.option ?? null,
    schemeCategory: product.schemeCategory ?? null,
    source: {
      provider: PROVIDERS.AMFI,
      instrumentId: schemeCode,
      url: currentFact.source?.url ?? product.source?.url ?? null,
    },
    nav: {
      value: currentFact.value,
      currency: currentFact.currency,
      unit: currentFact.unit,
      valuationDate: currentFact.observedAt?.slice(0, 10) ?? null,
      observedAt: currentFact.observedAt ?? null,
      fetchedAt: currentFact.fetchedAt ?? null,
    },
    valuationDate: currentFact.observedAt?.slice(0, 10) ?? null,
    freshness: currentFact.freshness ?? null,
    availabilityStatus: currentFact.availabilityStatus,
    productEligibility: {
      eligible: true,
      status: 'ELIGIBLE_WITHIN_SUITABLE_PARENT',
      scope: 'PARENT_HARD_SUITABILITY_VERIFIED_AMFI_CATEGORY_AND_EXPLICIT_DIRECT_PLAN',
      reasonCodes: [
        'PARENT_HARD_SUITABILITY_PASSED',
        'AMFI_CATEGORY_EXACT_MATCH',
        'CURRENT_NAV_VERIFIED_AND_FRESH',
        'DIRECT_PLAN_ESTABLISHED_BY_SOURCE',
      ],
    },
    rankingReasonCodes: ranked
      ? [
        'AMFI_CATEGORY_EXACT_MATCH',
        'DIRECT_PLAN_ESTABLISHED_BY_SOURCE',
        'GROWTH_OPTION_ESTABLISHED_BY_SOURCE',
        'HISTORICAL_NAV_PAIR_VERIFIED',
        'TRAILING_1Y_HISTORICAL_RETURN_DESC',
      ]
      : [
        'AMFI_CATEGORY_EXACT_MATCH',
        'DIRECT_PLAN_ESTABLISHED_BY_SOURCE',
        'CURRENT_NAV_VERIFIED_AND_FRESH',
        ...(COMPARISON_ONLY_PARENT_CATEGORIES.has(parentInstrumentId)
          ? ['COMPARABLE_MATURITY_TENURE_NOT_VERIFIED']
          : []),
        'NO_DEFENSIBLE_MERIT_ORDER_ESTABLISHED',
      ],
    historicalReturn: ranked ? historicalReturn : null,
    returnBasis: ranked ? HISTORICAL_RETURN_BASIS : null,
    expectedReturn: null,
    nominalReturn: null,
    effectiveYield: null,
    postTaxReturn: null,
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
    investmentRoute: null,
  };
}

export function supportsAmfiParentCategory(parentInstrumentId) {
  return Object.hasOwn(AMFI_CATEGORIES_BY_PARENT, parentInstrumentId);
}

export function rankVerifiedMutualFundProducts({
  parentInstrumentId,
  currentSnapshot,
  historicalSnapshot,
  limit = MUTUAL_FUND_RESULT_LIMIT,
}) {
  if (!Number.isInteger(limit) || limit < 0 || limit > MUTUAL_FUND_RESULT_LIMIT) {
    throw new RangeError(`limit must be an integer from 0 to ${MUTUAL_FUND_RESULT_LIMIT}.`);
  }
  const categories = AMFI_CATEGORIES_BY_PARENT[parentInstrumentId];
  if (!categories) {
    return {
      products: [],
      ranking: {
        version: MUTUAL_FUND_RANKING_VERSION,
        status: 'UNAVAILABLE',
        authority: 'NONE',
        reasonCodes: ['PRODUCT_CLASS_NOT_SUPPORTED_PHASE_2'],
        hasUniqueLeader: false,
      },
      comparisonUniverse: {
        parentInstrumentId,
        sourceProvider: null,
        qualifiedCategoryHeadings: [],
        verifiedCategoryProductCount: 0,
        freshNavProductCount: 0,
        sourceEstablishedDirectPlanProductCount: 0,
        historicalEvidenceProductCount: 0,
        returnedProductCount: 0,
        resultLimit: MUTUAL_FUND_RESULT_LIMIT,
        disclosure: 'No qualified Phase-2 product universe exists for this parent category.',
      },
    };
  }

  const categoryKeys = new Set(categories.map(exactCategoryKey));
  const currentFacts = new Map((currentSnapshot?.facts || []).map(fact => [fact.canonicalProductId, fact]));
  const historicalFacts = new Map((historicalSnapshot?.facts || []).map(fact => [fact.canonicalProductId, fact]));
  const verifiedCategoryProducts = [...new Map((currentSnapshot?.products || [])
    .filter(product => (
      product?.productType === 'MUTUAL_FUND'
        && product?.source?.provider === PROVIDERS.AMFI
        && categoryKeys.has(exactCategoryKey(product.schemeCategory))
    ))
    .map(product => [product.canonicalProductId, product])).values()];

  const freshCategoryProducts = verifiedCategoryProducts.flatMap(product => {
    const currentFact = currentFacts.get(product.canonicalProductId);
    if (currentFact?.availabilityStatus !== AVAILABILITY.AVAILABLE
        || currentFact?.freshness?.status !== FRESHNESS.FRESH
        || establishedNumber(currentFact.value) === null
        || currentFact.value <= 0) return [];
    return [{
      product,
      currentFact,
      planClass: sourceEstablishedPlanClass(product.plan),
    }];
  });
  const eligible = freshCategoryProducts
    .filter(item => item.planClass === EVIDENCE_RANKING_PLAN_CLASS)
    .map(item => ({
      ...item,
      historicalReturn: !COMPARISON_ONLY_PARENT_CATEGORIES.has(parentInstrumentId)
        && isEstablishedGrowthOption(item.product.option)
        ? annualizedHistoricalReturn(item.currentFact, historicalFacts.get(item.product.canonicalProductId))
        : null,
    }));
  const evidenceCandidates = eligible.filter(item => item.historicalReturn !== null);
  const distinctReturns = new Set(evidenceCandidates.map(item => item.historicalReturn.valuePct));
  const hasDefensibleOrder = evidenceCandidates.length >= 2 && distinctReturns.size >= 2;

  let selected;
  let ranking;
  if (hasDefensibleOrder) {
    const sorted = [...evidenceCandidates].sort((a, b) => (
      b.historicalReturn.valuePct - a.historicalReturn.valuePct
        || a.product.canonicalProductId.localeCompare(b.product.canonicalProductId)
    ));
    let previousValue = null;
    let previousRank = null;
    selected = sorted.slice(0, limit).map((item, index) => {
      const tied = previousValue !== null && item.historicalReturn.valuePct === previousValue;
      const rank = tied ? previousRank : index + 1;
      previousValue = item.historicalReturn.valuePct;
      previousRank = rank;
      return buildProductDto({
        ...item,
        parentInstrumentId,
        presentationStatus: 'VERIFIED_RANKED_PRODUCT',
        rank,
        tiedRank: tied || sorted.some((candidate, candidateIndex) => (
          candidateIndex !== index && candidate.historicalReturn.valuePct === item.historicalReturn.valuePct
        )),
      });
    });
    const hasUniqueLeader = sorted.length === 1
      || sorted[0].historicalReturn.valuePct !== sorted[1].historicalReturn.valuePct;
    ranking = {
      version: MUTUAL_FUND_RANKING_VERSION,
      status: 'EVIDENCE_RANKED',
      authority: 'VERIFIED_AMFI_CURRENT_AND_HISTORICAL_NAV',
      method: 'ONE_YEAR_ANNUALIZED_POINT_TO_POINT_NAV_RETURN_DESCENDING',
      planClass: EVIDENCE_RANKING_PLAN_CLASS,
      planClassSource: 'AMFI_PLAN_FIELD',
      planClassInferredFromName: false,
      historicalReturnIsExpectedReturn: false,
      arbitraryWeightedScoreUsed: false,
      hasUniqueLeader,
      reasonCodes: [
        'PARENT_HARD_SUITABILITY_PASSED',
        'AMFI_CATEGORY_EXACT_MATCH',
        'DIRECT_PLAN_ESTABLISHED_BY_SOURCE',
        'GROWTH_OPTION_ESTABLISHED_BY_SOURCE',
        'TRAILING_1Y_HISTORICAL_RETURN_DESC',
      ],
      warning: 'Historical NAV return is backward-looking, excludes product facts not supplied by AMFI, and is not an expected return or guarantee.',
    };
  } else {
    selected = [...eligible]
      .sort((a, b) => a.product.canonicalProductId.localeCompare(b.product.canonicalProductId))
      .slice(0, limit)
      .map(item => buildProductDto({
        ...item,
        historicalReturn: null,
        parentInstrumentId,
        presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
      }));
    ranking = {
      version: MUTUAL_FUND_RANKING_VERSION,
      status: selected.length > 0 ? 'VERIFIED_COMPARABLE_OPTIONS' : 'UNAVAILABLE',
      authority: selected.length > 0 ? 'VERIFIED_AMFI_CURRENT_NAV_ONLY' : 'NONE',
      method: selected.length > 0 ? 'STABLE_PRODUCT_ID_ASC_FOR_BOUNDED_DISPLAY_NOT_A_RANKING' : null,
      planClass: EVIDENCE_RANKING_PLAN_CLASS,
      planClassSource: 'AMFI_PLAN_FIELD',
      planClassInferredFromName: false,
      historicalReturnIsExpectedReturn: false,
      arbitraryWeightedScoreUsed: false,
      hasUniqueLeader: false,
      reasonCodes: selected.length > 0
        ? [
            ...(COMPARISON_ONLY_PARENT_CATEGORIES.has(parentInstrumentId)
              ? ['COMPARABLE_MATURITY_TENURE_NOT_VERIFIED']
              : ['NO_DEFENSIBLE_MERIT_ORDER_ESTABLISHED']),
            'DISPLAY_ORDER_IS_NOT_A_RANKING',
          ]
        : freshCategoryProducts.length > 0
          ? ['NO_EXPLICIT_DIRECT_PLAN_PRODUCTS']
          : ['NO_FRESH_ELIGIBLE_AMFI_PRODUCTS'],
      warning: selected.length > 0
        ? COMPARISON_ONLY_PARENT_CATEGORIES.has(parentInstrumentId)
          ? 'These verified Direct-plan FMPs are comparable options only because comparable maturity and tenure facts are not established. Display order is not a recommendation or ranking.'
          : 'These verified Direct-plan products are comparable options. Their display order is not a recommendation or ranking.'
        : freshCategoryProducts.length > 0
          ? 'No product had an explicit AMFI Direct Plan classification; Regular, unknown, and null Plan values were not substituted.'
          : 'No product met the verified category and fresh-NAV evidence requirements.',
    };
  }

  return {
    products: selected,
    ranking,
    comparisonUniverse: {
      parentInstrumentId,
      sourceProvider: PROVIDERS.AMFI,
      qualifiedCategoryHeadings: [...categories],
      verifiedCategoryProductCount: verifiedCategoryProducts.length,
      freshNavProductCount: freshCategoryProducts.length,
      sourceEstablishedDirectPlanProductCount: eligible.length,
      historicalEvidenceProductCount: evidenceCandidates.length,
      returnedProductCount: selected.length,
      resultLimit: MUTUAL_FUND_RESULT_LIMIT,
      currentSnapshotStatus: currentSnapshot?.status ?? AVAILABILITY.UNAVAILABLE,
      currentSnapshotFetchedAt: currentSnapshot?.fetchedAt ?? null,
      historicalSnapshotStatus: historicalSnapshot?.status ?? AVAILABILITY.UNAVAILABLE,
      historicalSnapshotFetchedAt: historicalSnapshot?.fetchedAt ?? null,
      disclosure: hasDefensibleOrder
        ? 'Ranked only among products explicitly classified by AMFI as Direct Plan and Growth Option, with a fresh current NAV and a verified approximately one-year historical NAV pair. Regular and unknown Plan classes are outside this merit universe.'
        : COMPARISON_ONLY_PARENT_CATEGORIES.has(parentInstrumentId)
          ? 'Bounded comparable set of explicitly sourced Direct-plan FMPs. Comparable maturity and tenure are not established, so historical-return ranking is disabled and stable-ID display order has no merit meaning.'
          : 'Bounded comparable set of products explicitly classified by AMFI as Direct Plan with fresh current NAVs; Regular and unknown Plan classes are excluded, and stable-ID display order has no merit meaning.',
    },
  };
}
