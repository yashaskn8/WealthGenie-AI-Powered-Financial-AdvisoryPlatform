import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStressScenarioReport, classifyStressInstrument } from '../services/stressScenarioEngine.js';

test('stress engine classifies authoritative instrument types without user-supplied category overrides', () => {
  assert.equal(classifyStressInstrument({ id: 'liquid-fund', type: 'Liquid_MF', assetClass: 'Debt' }), 'liquid_debt');
  assert.equal(classifyStressInstrument({ id: 'midcap-index', type: 'Midcap_MF', assetClass: 'Equity' }), 'midsmall_equity');
  assert.equal(classifyStressInstrument({ id: 'sgb', type: 'SGB', assetClass: 'Gold' }), 'gold');
  assert.equal(classifyStressInstrument({ id: 'reit-one', type: 'REIT', assetClass: 'Real Estate' }), 'reit');
});

test('stress engine computes every displayed currency value on the server', () => {
  const report = buildStressScenarioReport({
    instrument: { id: 'index-fund', type: 'Index_MF', assetClass: 'Equity' },
    principal: 100000,
  });

  assert.equal(report.calculation_classification, 'NON_RECOMMENDATION_STRESS_WHAT_IF');
  assert.equal(report.not_a_forecast, true);
  assert.equal(report.asset_profile.type, 'large_equity');
  assert.equal(report.scenarios[0].impact_pct, -59.5);
  assert.equal(report.scenarios[0].lost_amount, 59500);
  assert.equal(report.scenarios[0].bottom_value, 40500);
  assert.equal(report.scenarios[0].recovery_value, 120000);
  assert.equal(report.scenarios[0].recovery_delta, 20000);
});

test('stress engine validates principal bounds and rejects missing instruments', () => {
  assert.throws(() => buildStressScenarioReport({
    instrument: { id: 'ETF', type: 'ETF', assetClass: 'Equity' },
    principal: 999,
  }), /between 1,000 and 10,000,000/);
  assert.throws(() => classifyStressInstrument(null), /instrument is required/i);
});

test('penalty scenario never double-negates the displayed impact', () => {
  const report = buildStressScenarioReport({
    instrument: { id: 'ppf', type: 'PPF', assetClass: 'Debt' },
    principal: 250000,
  });
  const penalty = report.scenarios.find(scenario => scenario.impact_kind === 'penalty');

  assert.equal(penalty.impact_pct, -1);
  assert.equal(penalty.lost_amount, 2500);
  assert.equal(penalty.bottom_value, 247500);
  assert.equal(penalty.recovery_value, 247500);
  assert.equal(penalty.recovery_delta, -2500);
});
