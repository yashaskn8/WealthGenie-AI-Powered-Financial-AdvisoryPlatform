import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_CONTEXT_MAX_TOTAL_TILT_PCT,
  applyProfileSafeMarketContextAdjustment,
} from '../services/regimeRotationEngine.js';

const PROFILE = Object.freeze({
  monthlyTakeHome: 100000,
  monthlySavings: 30000,
  age: 25,
  riskTolerance: 'Aggressive',
  soldPropertyProceeds: 0,
  hasLumpSum: false,
  lumpSumAmount: 0,
  liquidSavings: 600000,
  emiBurdenPct: 0,
  financialDependents: 0,
  emergencyFundMonths: 12,
  investmentGoals: ['Wealth Growth'],
  investmentHorizonYears: 30,
});

function instrument(id, riskScore, allocationWeight, overrides = {}) {
  return {
    id,
    name: id,
    type: id,
    assetClass: id,
    riskScore,
    allocationWeight,
    allocation_pct: allocationWeight * 100,
    ...overrides,
  };
}

test('risk-off adjustment stays inside the authoritative eligible set and maximum tilt', () => {
  const instruments = [
    instrument('ppf', 1, 0.85),
    instrument('smallcap_mf', 5, 0.15),
  ];
  const result = applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments,
    marketContext: { status: 'MARKET_CONTEXT_AVAILABLE', context: 'RISK_OFF' },
  });
  assert.equal(result.applied, true);
  assert.equal(result.actualTotalTiltPct, MARKET_CONTEXT_MAX_TOTAL_TILT_PCT.RISK_OFF);
  assert.deepEqual(Object.keys(result.adjustedWeights).sort(), ['ppf', 'smallcap_mf']);
  assert.deepEqual(result.introducedInstrumentIds, []);
  assert.equal(result.adjustedWeights.ppf, 0.9);
  assert.equal(result.adjustedWeights.smallcap_mf, 0.1);
  assert.equal(result.suitabilityRevalidated, true);
  assert.equal(result.concentrationCapsRevalidated, true);
});

test('unavailable and normal contexts never change the recommendation', () => {
  const instruments = [instrument('ppf', 1, 0.85), instrument('smallcap_mf', 5, 0.15)];
  const unavailable = applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments,
    marketContext: { status: 'MARKET_CONTEXT_UNAVAILABLE', context: null },
  });
  const normal = applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments,
    marketContext: { status: 'MARKET_CONTEXT_AVAILABLE', context: 'NORMAL' },
  });
  assert.equal(unavailable.applied, false);
  assert.equal(normal.applied, false);
  assert.deepEqual(unavailable.adjustedWeights, unavailable.baseWeights);
  assert.deepEqual(normal.adjustedWeights, normal.baseWeights);
});

test('a policy context without recommendation-safe freshness cannot change the recommendation', () => {
  const result = applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments: [instrument('ppf', 1, 0.85), instrument('smallcap_mf', 5, 0.15)],
    marketContext: {
      status: 'MARKET_CONTEXT_AVAILABLE',
      context: 'RISK_OFF',
      recommendationUsability: { status: 'NOT_USABLE', reasonCodes: ['MARKET_SNAPSHOT_OBSERVATION_TOO_OLD'] },
    },
  });
  assert.equal(result.applied, false);
  assert(result.reasonCodes.includes('MARKET_CONTEXT_NOT_USABLE_FOR_RECOMMENDATION'));
});

test('an ML shadow state cannot become an allocation context', () => {
  const instruments = [instrument('ppf', 1, 0.85), instrument('smallcap_mf', 5, 0.15)];
  const result = applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments,
    marketContext: {
      status: 'MODEL_CONTEXT_AVAILABLE',
      role: 'SHADOW',
      state: 'STATE_1',
      semanticContext: null,
    },
  });
  assert.equal(result.applied, false);
  assert.equal(result.contextStatus, 'MODEL_CONTEXT_AVAILABLE');
  assert.deepEqual(result.adjustedInstruments, instruments);
  assert.deepEqual(result.introducedInstrumentIds, []);
  assert(result.reasonCodes.includes('MARKET_CONTEXT_UNAVAILABLE_NO_ADJUSTMENT'));
});

test('suitability validation remains a hard pre-adjustment boundary', () => {
  const expected = new Error('blocked by suitability');
  assert.throws(() => applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments: [instrument('safe', 1, 0.5), instrument('unsafe', 5, 0.5)],
    marketContext: { status: 'MARKET_CONTEXT_AVAILABLE', context: 'RISK_OFF' },
  }, {
    assertPortfolioSuitable: () => { throw expected; },
    resolveConcentrationCap: () => null,
  }), error => error === expected);
});

test('recipient concentration caps prevent an otherwise available transfer', () => {
  const instruments = [instrument('low', 1, 0.6), instrument('high', 5, 0.4)];
  const result = applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments,
    marketContext: { status: 'MARKET_CONTEXT_AVAILABLE', context: 'RISK_OFF' },
  }, {
    assertPortfolioSuitable: () => ({ finalLevel: 5 }),
    resolveConcentrationCap: item => item.id === 'low' ? { key: 'low_group', maxPct: 60 } : null,
  });
  assert.equal(result.applied, false);
  assert.deepEqual(result.adjustedWeights, { low: 0.6, high: 0.4 });
  assert.deepEqual(result.reasonCodes, ['CONCENTRATION_CAPS_PREVENT_LOWER_RISK_TRANSFER']);
});

test('an authoritative recommendation already outside concentration limits fails closed', () => {
  assert.throws(() => applyProfileSafeMarketContextAdjustment({
    profile: PROFILE,
    instruments: [instrument('low', 1, 0.7), instrument('high', 5, 0.3)],
    marketContext: { status: 'MARKET_CONTEXT_AVAILABLE', context: 'CAUTIOUS' },
  }, {
    assertPortfolioSuitable: () => ({ finalLevel: 5 }),
    resolveConcentrationCap: item => item.id === 'low' ? { key: 'low_group', maxPct: 60 } : null,
  }), error => error.code === 'MARKET_CONTEXT_CONCENTRATION_CAP_VIOLATION');
});
