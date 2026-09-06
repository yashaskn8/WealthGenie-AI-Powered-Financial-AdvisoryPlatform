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
import { canonicalProfile } from './helpers/canonicalProfile.js';

test('instrument mapping and risk classification return explicit unknown states', () => {
  assert.equal(resolveBackendType({ id: 'ppf' }), 'PPF');
  assert.equal(resolveBackendType({ name: 'Nifty Index Mutual Fund' }), 'Index_MF');
  assert.equal(resolveBackendType({ name: 'Unmapped product' }), null);
  assert.equal(getInstrumentRisk({}), null);
  assert.equal(instrumentRiskTier({}), 'UNKNOWN');
  assert.equal(instrumentRiskTier({ riskLevel: 5 }), 'HIGH');
});

test('eligibility fails closed and recognizes a fully established eligible instrument', () => {
  const established = {
    id: 'fixture', name: 'Fixture Instrument', riskLevel: 2, expectedReturn: 7,
    liquidityScore: 4, expenseRatio: 0.001, goalTags: ['Wealth Growth'],
    idealHorizon: { min: 1, max: 20 }, lockIn: 0,
    eligibility: {
      minAge: 18, maxAge: null, minAnnualIncome: 0, minMonthlySavings: 500,
      hasGirlChild: null, requiresDemat: null,
    },
  };
  const result = filterEligible([established, { ...established, id: 'unknown', eligibility: undefined }], canonicalProfile(), 3);
  assert.deepEqual(result.eligible.map(item => item.id), ['fixture']);
  assert.deepEqual(result.excluded, [{
    id: 'unknown', name: 'Fixture Instrument', reasonCode: 'ELIGIBILITY_NOT_ESTABLISHED',
  }]);
});

test('gross-income, family, and demat eligibility that is not in the profile is excluded explicitly', () => {
  const base = {
    name: 'Fixture', riskLevel: 1, expectedReturn: 7, liquidityScore: 4, expenseRatio: 0,
    goalTags: ['Wealth Growth'], idealHorizon: { min: 1, max: 20 }, lockIn: 0,
  };
  const variants = [
    { id: 'income', eligibility: { minAnnualIncome: 1, minMonthlySavings: 500 } },
    { id: 'girl', eligibility: { minAnnualIncome: 0, minMonthlySavings: 500, hasGirlChild: true } },
    { id: 'demat', eligibility: { minAnnualIncome: 0, minMonthlySavings: 500, requiresDemat: true } },
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
});

test('pipeline output is backend-owned, pre-tax nominal, suitable, and capacity-bounded', () => {
  const profile = canonicalProfile();
  const output = runPipeline(profile, { confidence_scores: { Index_MF: 0.9 } });
  assert.ok(output.instruments.length > 0);
  assert.ok(output.instruments.every(item => item.returnBasis === 'PRE_TAX_NOMINAL'));
  assert.ok(output.instruments.every(item => item.postTaxReturn === null));
  assert.ok(output.instruments.every(item => item.riskScore <= output.riskReconciliation.final_score));
  assert.ok(Math.abs(output.instruments.reduce((sum, item) => sum + item.allocationWeight, 0) - 1) <= 0.001);
});

test('WTI accepts provider presentation data only and inherits the authoritative parent decision', () => {
  const products = rankWhereToInvestBackend(
    [{ id: 'provider-1', name: 'Provider Option', highlight: 'Direct plan' }],
    canonicalProfile(),
    { parentInstrumentId: 'index_mf' },
  );
  assert.equal(products.length, 1);
  assert.equal(products[0].parentInstrumentId, 'index_mf');
  assert.equal(products[0].returnBasis, 'PRE_TAX_NOMINAL');
  assert.equal(products[0].postTaxReturn, null);
  assert.equal('annualIncome' in products[0], false);
  const unknown = rankWhereToInvestBackend([{ name: 'Anything' }], canonicalProfile(), { parentInstrumentId: 'missing' });
  assert.equal(unknown.length, 0);
  assert.equal(unknown.metadata.excluded[0].reasonCode, 'CATALOG_INSTRUMENT_NOT_ESTABLISHED');
});

test('ML confidence normalization rejects non-finite values and clamps explicit probabilities', () => {
  assert.deepEqual(normaliseConfidenceScores({
    confidence_scores: { FD: 0.8, Index_MF: 2, bad: 'not-a-number' },
  }), { FD: 0.8, Index_MF: 1 });
});
