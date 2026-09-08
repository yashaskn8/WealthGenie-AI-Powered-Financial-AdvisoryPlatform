import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveWeights,
  enforceAllocationTargets,
  filterEligible,
  getInstrumentRisk,
  instrumentRiskTier,
  normaliseConfidenceScores,
  parseProfile,
  rankWhereToInvestBackend,
  reconcileRisk,
  resolveBackendType,
  runPipeline,
} from '../services/RecommendationPipeline.js';
import { investmentDatabase } from '../data/investmentDatabase.js';
import whereToInvestCatalog from '../data/whereToInvestCatalog.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

test('instrument mapping and risk classification return explicit unknown states', () => {
  assert.equal(resolveBackendType({ id: 'ppf' }), 'PPF');
  assert.equal(resolveBackendType({ recommendationType: 'Index_MF', name: 'Nifty Index Mutual Fund' }), 'Index_MF');
  assert.equal(resolveBackendType({ name: 'Nifty Index Mutual Fund' }), null);
  assert.equal(resolveBackendType({ name: 'Unmapped product' }), null);
  assert.equal(getInstrumentRisk({}), null);
  assert.equal(instrumentRiskTier({}), 'UNKNOWN');
  assert.equal(instrumentRiskTier({ riskLevel: 5 }), 'HIGH');
});

test('eligibility fails closed and recognizes a fully established eligible instrument', () => {
  const established = {
    id: 'fixture', type: 'FD', name: 'Fixture Instrument', riskLevel: 2, expectedReturn: 7,
    liquidityScore: 4, expenseRatio: 0.001, goalTags: ['Wealth Growth'],
    idealHorizon: { min: 1, max: 20 }, lockIn: 0,
    eligibility: {
      minAge: 18, maxAge: null, minAnnualIncome: 0, minMonthlySavings: 500,
      hasGirlChild: null, requiresDemat: null,
    },
  };
  const result = filterEligible([
    established,
    { ...established, id: 'unknown', eligibility: undefined },
    { ...established, id: 'partial', eligibility: { minAge: 18, minMonthlySavings: 500 } },
  ], canonicalProfile(), 3);
  assert.deepEqual(result.eligible.map(item => item.id), ['fixture']);
  assert.deepEqual(result.excluded, [
    { id: 'unknown', name: 'Fixture Instrument', reasonCode: 'ELIGIBILITY_NOT_ESTABLISHED' },
    { id: 'partial', name: 'Fixture Instrument', reasonCode: 'ELIGIBILITY_NOT_ESTABLISHED' },
  ]);
});

test('gross-income, family, and demat eligibility that is not in the profile is excluded explicitly', () => {
  const base = {
    name: 'Fixture', type: 'FD', riskLevel: 1, expectedReturn: 7, liquidityScore: 4, expenseRatio: 0,
    goalTags: ['Wealth Growth'], idealHorizon: { min: 1, max: 20 }, lockIn: 0,
    eligibility: {
      minAge: 18, maxAge: null, minAnnualIncome: 0, minMonthlySavings: 500,
      hasGirlChild: null, requiresDemat: null,
    },
  };
  const variants = [
    { id: 'income', eligibility: { ...base.eligibility, minAnnualIncome: 1 } },
    { id: 'girl', eligibility: { ...base.eligibility, hasGirlChild: true } },
    { id: 'demat', eligibility: { ...base.eligibility, requiresDemat: true } },
  ].map(item => ({ ...base, ...item }));
  assert.deepEqual(filterEligible(variants, canonicalProfile(), 3).excluded.map(item => item.reasonCode), [
    'GROSS_INCOME_ELIGIBILITY_NOT_ESTABLISHED',
    'GIRL_CHILD_ELIGIBILITY_NOT_ESTABLISHED',
    'DEMAT_ELIGIBILITY_NOT_ESTABLISHED',
  ]);
});

test('profile parsing and weights use only canonical profile facts', () => {
  const parsed = parseProfile(canonicalProfile());
  assert.deepEqual(Object.keys(parsed).sort(), [
    'age', 'emiBurdenPct', 'emergencyFundMonths', 'financialDependents', 'goals',
    'horizon', 'liquidSavings', 'monthlySavings', 'monthlyTakeHome', 'risk', 'riskLevel',
  ].sort());
  const weights = deriveWeights(parsed);
  assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal('tax' in weights, false);
});

test('risk reconciliation preserves the hard preference ceiling', () => {
  const result = reconcileRisk(canonicalProfile({ riskTolerance: 'Conservative' }));
  assert.equal(result.preference_score, 1);
  assert.equal(result.final_score, 1);
  assert.ok(result.reason_codes.includes('RISK_PREFERENCE_CONSERVATIVE'));
});

test('allocation normalization respects aggregate concentration caps and sums to one', () => {
  const result = enforceAllocationTargets([
    { id: 'smallcap_mf', type: 'Smallcap_MF', name: 'Smallcap A', score: 100 },
    { id: 'smallcap_b', type: 'Smallcap_MF', name: 'Smallcap B', score: 80 },
    { id: 'fd', type: 'FD', name: 'FD', score: 20 },
  ]);
  const smallcap = result.filter(item => item.type === 'Smallcap_MF')
    .reduce((sum, item) => sum + item.allocation_pct, 0);
  assert.ok(smallcap <= 15.01);
  assert.ok(Math.abs(result.reduce((sum, item) => sum + item.allocationWeight, 0) - 1) <= 0.0002);
  assert.throws(() => enforceAllocationTargets([
    { id: 'smallcap_mf', type: 'Smallcap_MF', name: 'Smallcap A', score: 100 },
    { id: 'smallcap_b', type: 'Smallcap_MF', name: 'Smallcap B', score: 80 },
  ]), /no uncapped instrument/);
});

test('pipeline output is backend-owned, pre-tax nominal, suitable, and capacity-bounded', () => {
  const profile = canonicalProfile();
  const output = runPipeline(profile, { confidence_scores: { Index_MF: 0.9 } });
  const forbiddenNoise = runPipeline({
    ...profile, annualIncome: 999999999, totalCTC: 999999999,
    taxRegime: 'old', goal_type: 'house purchase',
  }, { confidence_scores: { Index_MF: 0.9 } });
  assert.ok(output.instruments.length > 0);
  assert.ok(output.instruments.every(item => item.returnBasis === 'PRE_TAX_NOMINAL'));
  assert.ok(output.instruments.every(item => item.postTaxReturn === null));
  assert.ok(output.instruments.every(item => item.tags.every(tag => [
    'Retirement', 'Wealth Growth', 'Tax Saving', 'Emergency Fund',
  ].includes(tag))));
  assert.ok(output.instruments.every(item => item.riskScore <= output.riskReconciliation.final_score));
  assert.ok(Math.abs(output.instruments.reduce((sum, item) => sum + item.allocationWeight, 0) - 1) <= 0.001);
  assert.deepEqual(forbiddenNoise, output, 'forbidden profile fields cannot change ranking or allocation');
});

test('WTI reference metadata passes suitability without pretending catalog order is a ranking', () => {
  const products = rankWhereToInvestBackend(canonicalProfile(), { parentInstrumentId: 'index_mf' });
  assert.equal(products.length, 5);
  assert.equal(products[0].parentInstrumentId, 'index_mf');
  assert.equal(products[0].listingPosition, 1);
  assert.equal(products[0].returnBasis, null);
  assert.equal(products[0].nominalReturn, null);
  assert.equal(products[0].effectiveYield, null);
  assert.equal(products[0].expenseRatio, null);
  assert.equal(products[0].postTaxReturn, null);
  assert.equal(products[0].rankingBasis, 'REFERENCE_METADATA_ONLY_NOT_RANKED');
  assert.equal(products[0].badge, null);
  assert.equal(typeof products[0].platform, 'string');
  assert.equal(products[0].minInvestment, null);
  assert.equal(products.metadata.catalog.title.length > 0, true);
  assert.equal(products.metadata.ranking.status, 'NOT_RANKED');
  assert.equal(products.metadata.ranking.authority, 'REFERENCE_METADATA_ONLY');
  assert.equal('annualIncome' in products[0], false);
  const unknown = rankWhereToInvestBackend(canonicalProfile(), { parentInstrumentId: 'missing' });
  assert.equal(unknown.length, 0);
  assert.equal(unknown.metadata.excluded[0].reasonCode, 'CATALOG_INSTRUMENT_NOT_ESTABLISHED');
  const excessiveRisk = rankWhereToInvestBackend(
    canonicalProfile({ riskTolerance: 'Conservative' }),
    { parentInstrumentId: 'smallcap_mf' },
  );
  assert.equal(excessiveRisk.length, 0);
  assert.equal(excessiveRisk.metadata.excluded[0].reasonCode, 'RISK_EXCEEDS_FINAL_SUITABILITY');
});

test('WTI catalog covers every parent instrument with exactly five complete, distinct placements', () => {
  const instrumentIds = investmentDatabase.map(instrument => instrument.id);
  assert.equal(instrumentIds.length, 155);
  assert.deepEqual(Object.keys(whereToInvestCatalog).sort(), [...instrumentIds].sort());

  for (const instrumentId of instrumentIds) {
    const entry = whereToInvestCatalog[instrumentId];
    assert.equal(typeof entry.title, 'string', `${instrumentId} must have a title`);
    assert.equal(typeof entry.note, 'string', `${instrumentId} must have a note`);
    assert.equal(typeof entry.howToStart, 'string', `${instrumentId} must explain how to start`);
    assert.equal(entry.products.length, 5, `${instrumentId} must expose exactly five providers`);
    for (const product of entry.products) {
      for (const field of ['name', 'provider', 'highlight', 'platform', 'minInvestment']) {
        assert.equal(
          typeof product[field] === 'string' && product[field].trim().length > 0,
          true,
          `${instrumentId} provider ${field} must be a non-empty string`,
        );
      }
    }
    assert.equal(
      new Set(entry.products.map(product => (
        [product.name, product.provider, product.platform]
          .map(value => value.trim().toLowerCase())
          .join('::')
      ))).size,
      5,
      `${instrumentId} must expose five distinct product/provider/platform placements`,
    );
  }
});

test('ML confidence normalization rejects non-finite and out-of-range values', () => {
  assert.deepEqual(normaliseConfidenceScores({ confidence_scores: { FD: 0.8 } }), { FD: 0.8 });
  assert.throws(() => normaliseConfidenceScores({ confidence_scores: { Index_MF: 2 } }), /between 0 and 1/);
  assert.throws(() => normaliseConfidenceScores({ confidence_scores: { bad: 'not-a-number' } }), /between 0 and 1/);
  assert.throws(() => normaliseConfidenceScores({ confidence_scores: { FD: '0.8' } }), /between 0 and 1/);
});
