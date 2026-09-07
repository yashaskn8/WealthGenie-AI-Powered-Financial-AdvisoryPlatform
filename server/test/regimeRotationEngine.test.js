import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentRegime, getRegimeTilts, calculateTiltAdjustedAllocation, MACRO_REGIMES } from '../services/regimeRotationEngine.js';

test('1. getCurrentRegime returns the explicit/default regime and rejects unknown states', () => {
  const currentDefault = getCurrentRegime('normal');
  assert.equal(currentDefault.key, 'normal');
  assert.equal(currentDefault.title, 'Normal Market Environment');

  const override = getCurrentRegime('pandemic_health_crisis');
  assert.equal(override.key, 'pandemic_health_crisis');
  assert.equal(override.title, 'Health Emergency & Lockdown Shock');
  assert.throws(() => getCurrentRegime('invented'), /Unknown macro regime/);
  assert.throws(() => getRegimeTilts('invented'), /Unknown macro regime/);
});

test('2. getRegimeTilts returns correct tilt mappings', () => {
  const conflictTilts = getRegimeTilts('geopolitical_conflict');
  assert(conflictTilts.tilts.defence, 'Geopolitical conflict must include defence tilt');
  assert.equal(conflictTilts.tilts.defence.weightDelta, 0.15);

  const crashTilts = getRegimeTilts('broad_market_crash');
  assert(crashTilts.tilts.liquid_mf, 'Market crash must include liquid fund tilt');
  assert.equal(crashTilts.tilts.liquid_mf.weightDelta, 0.25);
});

test('3. calculateTiltAdjustedAllocation applies sector weight adjustments and normalizes', () => {
  const baseWeights = {
    defence: 0.10,
    energy_oil_gas: 0.10,
    auto: 0.20,
    other: 0.60
  };

  const result = calculateTiltAdjustedAllocation(baseWeights, 'geopolitical_conflict');

  assert.equal(result.regime, 'geopolitical_conflict');
  assert.equal(result.classification, 'NON_RECOMMENDATION_MACRO_WHAT_IF');
  assert(result.adjustedWeights.defence > baseWeights.defence, 'Defence weight must increase in conflict regime');
  assert(result.adjustedWeights.auto < baseWeights.auto, 'Auto weight must decrease in conflict regime');

  // Verify normalized weights sum to 1.0 (with floating-point precision tolerance)
  const sum = Object.values(result.adjustedWeights).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1.0) < 0.02, `Normalized weights sum (${sum}) must be approximately 1.0`);
  assert.throws(() => calculateTiltAdjustedAllocation({}, 'normal'), /non-empty/);
  assert.throws(() => calculateTiltAdjustedAllocation({ equity: 0.9 }, 'normal'), /sum to 1/);
});
