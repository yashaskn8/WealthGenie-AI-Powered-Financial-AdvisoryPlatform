import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAmfiNavHistoryReport } from '../services/marketData/AmfiNavHistoryProvider.js';
import {
  HISTORICAL_RETURN_BASIS,
  MUTUAL_FUND_RANKING_VERSION,
  rankVerifiedMutualFundProducts,
} from '../services/mutualFundProductRanking.js';
import { rankWhereToInvestBackend } from '../services/RecommendationPipeline.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const CURRENT_DATE = '2026-09-07T00:00:00.000Z';
const FETCHED_AT = '2026-09-08T00:00:00.000Z';
const LARGE_CAP_CATEGORY = 'Open Ended Schemes(Equity Scheme - Large Cap Fund)';
const FIXED_MATURITY_CATEGORY = 'Close Ended Schemes(Income/Debt Oriented Schemes - Fixed Term Plan)';

function currentProduct(code, {
  category = LARGE_CAP_CATEGORY,
  option = 'Growth Option',
  plan = 'Direct Plan',
  provider = `AMC ${code}`,
} = {}) {
  return {
    schemaVersion: 'market-fact-1.0.0',
    canonicalProductId: `mf:amfi:${code}`,
    productType: 'MUTUAL_FUND',
    name: `Verified Fund ${code}`,
    providerName: provider,
    schemeCategory: category,
    plan,
    option,
    externalIds: [{ source: 'AMFI_SCHEME_CODE', value: String(code) }],
    source: { provider: 'AMFI', url: 'https://portal.amfiindia.com/spages/NAVAll.txt' },
  };
}

function navFact(code, value, observedAt = CURRENT_DATE, url = 'https://portal.amfiindia.com/spages/NAVAll.txt') {
  return {
    schemaVersion: 'market-fact-1.0.0',
    kind: 'MUTUAL_FUND_NAV',
    canonicalProductId: `mf:amfi:${code}`,
    value,
    currency: 'INR',
    unit: 'NAV_PER_UNIT',
    observedAt,
    fetchedAt: FETCHED_AT,
    availabilityStatus: 'AVAILABLE',
    freshness: { status: 'FRESH', ageSeconds: 86400, maxAgeSeconds: 345600 },
    source: { provider: 'AMFI', instrumentId: String(code), url },
  };
}

function snapshots() {
  const products = [
    currentProduct('101'),
    currentProduct('102'),
    currentProduct('103'),
    currentProduct('104'),
    currentProduct('105'),
    currentProduct('106'),
    currentProduct('107', { option: 'IDCW Option' }),
    currentProduct('108', { category: 'Open Ended Schemes(Equity Scheme - Mid Cap Fund)' }),
  ];
  const currentValues = [125, 120, 115, 110, 105, 101, 500, 999];
  const current = {
    provider: 'AMFI',
    status: 'AVAILABLE',
    fetchedAt: FETCHED_AT,
    products,
    facts: products.map((product, index) => navFact(
      product.canonicalProductId.split(':').at(-1),
      currentValues[index],
    )),
  };
  const historical = {
    provider: 'AMFI',
    status: 'AVAILABLE',
    fetchedAt: FETCHED_AT,
    facts: ['101', '102', '103', '104', '105', '106', '107', '108'].map(code => navFact(
      code,
      100,
      '2025-09-07T00:00:00.000Z',
      'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=04-Sep-2025&todt=10-Sep-2025',
    )),
  };
  return { current, historical };
}

test('AMFI historical parser follows the live header contract and picks the observation closest to target', () => {
  const report = [
    'Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date',
    '',
    'Open Ended Schemes ( Equity Scheme - Large Cap Fund )',
    'Example Mutual Fund',
    '101;Example Fund;Direct Plan;Growth Option;INF000A01010;;99.00;05-Sep-2025',
    '101;Example Fund;Direct Plan;Growth Option;INF000A01010;;100.00;08-Sep-2025',
    '101;Example Fund;Direct Plan;Growth Option;INF000A01010;;101.00;10-Sep-2025',
  ].join('\n');
  const snapshot = parseAmfiNavHistoryReport(report, {
    targetDate: '2025-09-07',
    fetchedAt: FETCHED_AT,
    now: new Date(FETCHED_AT),
    sourceUrl: 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=04-Sep-2025&todt=10-Sep-2025',
  });
  assert.equal(snapshot.facts.length, 1);
  assert.equal(snapshot.facts[0].value, 100);
  assert.equal(snapshot.facts[0].observedDate, '2025-09-08');
  assert.equal(snapshot.facts[0].historicalContext.plan, 'Direct Plan');
  assert.equal(snapshot.facts[0].historicalContext.option, 'Growth Option');
});

test('Phase 2 ranks at most five exact-category Direct Growth options by verified historical return only', () => {
  const { current, historical } = snapshots();
  const result = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'large_cap_mf',
    currentSnapshot: current,
    historicalSnapshot: historical,
  });
  assert.equal(result.ranking.version, MUTUAL_FUND_RANKING_VERSION);
  assert.equal(result.ranking.status, 'EVIDENCE_RANKED');
  assert.equal(result.ranking.arbitraryWeightedScoreUsed, false);
  assert.equal(result.ranking.historicalReturnIsExpectedReturn, false);
  assert.equal(result.products.length, 5);
  assert.deepEqual(result.products.map(product => product.id), [
    'mf:amfi:101', 'mf:amfi:102', 'mf:amfi:103', 'mf:amfi:104', 'mf:amfi:105',
  ]);
  assert.ok(result.products.every(product => product.presentationStatus === 'VERIFIED_RANKED_PRODUCT'));
  assert.ok(result.products.every(product => product.planClass === 'DIRECT'));
  assert.ok(result.products.every(product => product.returnBasis === HISTORICAL_RETURN_BASIS));
  assert.ok(result.products.every(product => product.expectedReturn === null));
  assert.ok(result.products.every(product => product.postTaxReturn === null));
  assert.ok(result.products.every(product => product.expenseRatio === null));
  assert.ok(result.products.every(product => product.aum === null));
  assert.ok(result.products.every(product => product.benchmark === null));
  assert.equal(result.products[0].nav.value, 125);
  assert.equal(result.products[0].historicalReturn.endNav, 125);
  assert.equal(result.comparisonUniverse.verifiedCategoryProductCount, 7);
  assert.equal(result.comparisonUniverse.sourceEstablishedDirectPlanProductCount, 7);
  assert.equal(result.comparisonUniverse.historicalEvidenceProductCount, 6);
});

test('Direct and Regular plans never share a merit universe', () => {
  const { current, historical } = snapshots();
  current.products = [
    currentProduct('181', { plan: 'Direct Plan' }),
    currentProduct('182', { plan: 'Direct' }),
    currentProduct('183', { plan: 'Regular Plan' }),
  ];
  current.facts = [navFact('181', 125), navFact('182', 110), navFact('183', 250)];
  historical.facts = [
    navFact('181', 100, '2025-09-07T00:00:00.000Z'),
    navFact('182', 100, '2025-09-07T00:00:00.000Z'),
    navFact('183', 100, '2025-09-07T00:00:00.000Z'),
  ];
  const result = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'large_cap_mf',
    currentSnapshot: current,
    historicalSnapshot: historical,
  });
  assert.equal(result.ranking.status, 'EVIDENCE_RANKED');
  assert.equal(result.ranking.planClass, 'DIRECT');
  assert.equal(result.ranking.planClassSource, 'AMFI_PLAN_FIELD');
  assert.equal(result.ranking.planClassInferredFromName, false);
  assert.deepEqual(result.products.map(product => product.id), ['mf:amfi:181', 'mf:amfi:182']);
  assert.ok(result.products.every(product => product.planClass === 'DIRECT'));
  assert.ok(result.products.every(product => !/regular/i.test(product.plan)));
  assert.equal(result.comparisonUniverse.verifiedCategoryProductCount, 3);
  assert.equal(result.comparisonUniverse.sourceEstablishedDirectPlanProductCount, 2);
  assert.equal(result.comparisonUniverse.historicalEvidenceProductCount, 2);
});

test('missing Plan remains null and cannot be treated as Direct or promoted into the product set', () => {
  const { current, historical } = snapshots();
  current.products = [currentProduct('201', { plan: null, option: null })];
  current.facts = [navFact('201', 20)];
  historical.facts = [navFact('201', 10, '2025-09-07T00:00:00.000Z')];
  const result = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'large_cap_mf',
    currentSnapshot: current,
    historicalSnapshot: historical,
  });
  assert.equal(result.ranking.status, 'UNAVAILABLE');
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.ranking.reasonCodes, ['NO_EXPLICIT_DIRECT_PLAN_PRODUCTS']);
  assert.equal(result.comparisonUniverse.verifiedCategoryProductCount, 1);
  assert.equal(result.comparisonUniverse.freshNavProductCount, 1);
  assert.equal(result.comparisonUniverse.sourceEstablishedDirectPlanProductCount, 0);
  assert.equal(result.comparisonUniverse.historicalEvidenceProductCount, 0);
});

test('indistinguishable historical evidence remains a comparable set instead of forcing ranks', () => {
  const { current, historical } = snapshots();
  current.products = [currentProduct('301'), currentProduct('302')];
  current.facts = [navFact('301', 120), navFact('302', 120)];
  historical.facts = [
    navFact('301', 100, '2025-09-07T00:00:00.000Z'),
    navFact('302', 100, '2025-09-07T00:00:00.000Z'),
  ];
  const result = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'large_cap_mf',
    currentSnapshot: current,
    historicalSnapshot: historical,
  });
  assert.equal(result.ranking.status, 'VERIFIED_COMPARABLE_OPTIONS');
  assert.ok(result.products.every(product => product.presentationStatus === 'VERIFIED_COMPARABLE_OPTION'));
  assert.ok(result.products.every(product => product.rank === null));
  assert.ok(result.products.every(product => product.historicalReturn === null));
});

test('fixed maturity plans remain comparable and cannot be ranked without verified comparable tenure', () => {
  const { current, historical } = snapshots();
  current.products = [
    currentProduct('351', { category: FIXED_MATURITY_CATEGORY }),
    currentProduct('352', { category: FIXED_MATURITY_CATEGORY }),
  ];
  current.facts = [navFact('351', 140), navFact('352', 110)];
  historical.facts = [
    navFact('351', 100, '2025-09-07T00:00:00.000Z'),
    navFact('352', 100, '2025-09-07T00:00:00.000Z'),
  ];
  const result = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'fixed_maturity_plan',
    currentSnapshot: current,
    historicalSnapshot: historical,
  });
  assert.equal(result.ranking.status, 'VERIFIED_COMPARABLE_OPTIONS');
  assert.ok(result.ranking.reasonCodes.includes('COMPARABLE_MATURITY_TENURE_NOT_VERIFIED'));
  assert.equal(result.ranking.hasUniqueLeader, false);
  assert.equal(result.comparisonUniverse.historicalEvidenceProductCount, 0);
  assert.equal(result.products.length, 2);
  assert.ok(result.products.every(product => product.presentationStatus === 'VERIFIED_COMPARABLE_OPTION'));
  assert.ok(result.products.every(product => product.rank === null));
  assert.ok(result.products.every(product => product.historicalReturn === null));
  assert.ok(result.products.every(product => product.rankingReasonCodes.includes('COMPARABLE_MATURITY_TENURE_NOT_VERIFIED')));
});

test('unavailable, stale, mismatched, and unsupported evidence produces zero products without fallback values', () => {
  const stale = snapshots();
  stale.current.facts = stale.current.facts.map(fact => ({
    ...fact,
    freshness: { ...fact.freshness, status: 'STALE' },
  }));
  const noFreshProducts = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'large_cap_mf',
    currentSnapshot: stale.current,
    historicalSnapshot: stale.historical,
  });
  assert.equal(noFreshProducts.products.length, 0);
  assert.equal(noFreshProducts.ranking.status, 'UNAVAILABLE');

  const unsupported = rankVerifiedMutualFundProducts({
    parentInstrumentId: 'index_mf',
    currentSnapshot: snapshots().current,
    historicalSnapshot: snapshots().historical,
  });
  assert.equal(unsupported.products.length, 0);
  assert.deepEqual(unsupported.ranking.reasonCodes, ['PRODUCT_CLASS_NOT_SUPPORTED_PHASE_2']);
});

test('WTI preserves hard parent suitability before requesting any product data', async () => {
  let sourceCalls = 0;
  const dependencies = {
    fetchAmfiProductSnapshot: async () => { sourceCalls += 1; return snapshots().current; },
    fetchAmfiHistoricalNavSnapshot: async () => { sourceCalls += 1; return snapshots().historical; },
  };
  const excessiveRisk = await rankWhereToInvestBackend(
    canonicalProfile({ riskTolerance: 'Conservative' }),
    { parentInstrumentId: 'smallcap_mf' },
    dependencies,
  );
  assert.equal(excessiveRisk.length, 0);
  assert.equal(excessiveRisk.metadata.excluded[0].reasonCode, 'RISK_EXCEEDS_FINAL_SUITABILITY');
  assert.equal(sourceCalls, 0);

  const eligible = await rankWhereToInvestBackend(
    canonicalProfile(),
    { parentInstrumentId: 'large_cap_mf' },
    dependencies,
  );
  assert.equal(eligible.length, 5);
  assert.equal(eligible.metadata.ranking.status, 'EVIDENCE_RANKED');
  assert.equal(eligible.metadata.catalog.dataClass, 'REFERENCE_METADATA');
  assert.equal(sourceCalls, 2);
});
