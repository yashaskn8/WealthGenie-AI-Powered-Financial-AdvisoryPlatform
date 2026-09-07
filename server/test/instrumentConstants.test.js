import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENT_PARAMS, RISK_FREE_RATE, CESS_RATE } from '../services/instrumentConstants.js';
import { investmentDatabase } from '../data/investmentDatabase.js';
import { resolveBackendType } from '../services/RecommendationPipeline.js';

test('WG-015: Single source of truth for instrument parameters and rates', () => {
  assert.ok(INSTRUMENT_PARAMS, 'INSTRUMENT_PARAMS must be defined');
  assert.ok(INSTRUMENT_PARAMS.Equity_MF, 'Equity_MF parameters must exist in single source of truth');
  assert.equal(typeof RISK_FREE_RATE, 'number', 'RISK_FREE_RATE must be a number');
  assert.equal(CESS_RATE, 0.04, 'CESS_RATE must equal 0.04 (4% Health & Education Cess)');
  assert.equal(INSTRUMENT_PARAMS.Equity_MF.nominalRate, 15.0, 'Equity_MF nominal rate must match the explicit recommendation-type catalog average (15.0%)');
});

test('Automated Drift Detection: instrumentConstants matches catalog category expectedReturn within tolerance', () => {
  const categoryGroups = {};
  for (const inst of investmentDatabase) {
    const bType = resolveBackendType(inst);
    if (!categoryGroups[bType]) categoryGroups[bType] = [];
    categoryGroups[bType].push(inst);
  }

  const allKeys = Object.keys(INSTRUMENT_PARAMS);
  const TOLERANCE = 0.15; // 0.15pp tolerance for 1-decimal rounding

  for (const key of allKeys) {
    const items = categoryGroups[key];
    const staticRate = INSTRUMENT_PARAMS[key]?.nominalRate;
    assert.ok(typeof staticRate === 'number', `Static rate must exist for key ${key}`);

    if (items && items.length > 0) {
      const avgReturn = items.reduce((s, i) => s + (i.expectedReturn || 0), 0) / items.length;
      const roundedAvg = parseFloat(avgReturn.toFixed(1));
      const delta = Math.abs(roundedAvg - staticRate);

      assert.ok(
        delta <= TOLERANCE,
        `Rate drift detected for category '${key}': staticParams has ${staticRate}%, but catalog average across ${items.length} items is ${roundedAvg}% (delta: ${delta.toFixed(3)}pp > ${TOLERANCE}pp). Run reconciliation if catalog updated.`
      );
    } else {
      // Category has no catalog items (e.g. G-Sec) — verify it has a safe defined rate
      assert.ok(staticRate > 0, `Unmapped category ${key} must still have valid static rate`);
    }
  }
});
