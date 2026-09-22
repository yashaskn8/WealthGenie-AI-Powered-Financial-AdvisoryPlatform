import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTaxPolicyMetadata,
  getCurrentFiscalYear,
  getTaxSlabsForFY,
} from '../services/taxEngine.js';
import { calculatePostTaxReturn } from '../services/postTaxCalculator.js';

test('FY2026-27 is explicitly governed by the Income-tax Act, 2025', () => {
  const policy = getTaxPolicyMetadata('FY2026-27');
  assert.equal(policy.verified, true);
  assert.equal(policy.statuteMetadata.statute, 'INCOME_TAX_ACT_2025');
  assert.equal(policy.statuteMetadata.effectiveFrom, '2026-04-01');
  assert.equal(policy.statuteMetadata.taxYear, 'TY2026-27');
  assert.ok(policy.sourceReferences.some(source => /income.?tax act, 2025/i.test(source.title)));
  assert.ok(policy.verifiedRuleIds.includes('FY2026-27_SGB_MATURITY_QUALIFICATION'));
});

test('historical FY2025-26 retains prior-law provenance', () => {
  const policy = getTaxPolicyMetadata('FY2025-26');
  assert.equal(policy.statuteMetadata.statute, 'INCOME_TAX_ACT_1961');
  assert.equal(policy.statuteMetadata.policyStatus, 'HISTORICAL_PRIOR_LAW');
});

test('unsupported future fiscal years fail closed', () => {
  assert.throws(() => getTaxSlabsForFY('FY2027-28'), /unavailable/i);
});

test('SGB current-law maturity exemption requires acquisition facts', () => {
  const base = ['SGB', 0.13, 1_500_000, 8, 'new', 10_000, 35, 'salary', undefined, 'FY2026-27'];
  const missing = calculatePostTaxReturn(...base, { redemptionChannel: 'MATURITY_REDEMPTION', couponRate: 0.025 });
  assert.equal(missing.status, 'REQUIRES_TAX_INPUTS');
  assert.ok(missing.unavailableReasons.includes('SGB_MATURITY_EXEMPTION_NOT_ESTABLISHED'));
  const secondary = calculatePostTaxReturn(...base, {
    redemptionChannel: 'SECONDARY_MARKET_SALE', couponRate: 0.025,
    acquisitionDate: '2020-01-01', redemptionDate: '2028-01-02',
  });
  assert.equal(secondary.status, 'CALCULATED');
  const qualified = calculatePostTaxReturn(...base, {
    redemptionChannel: 'MATURITY_REDEMPTION', couponRate: 0.025,
    acquiredAtOriginalIssue: true, heldContinuously: true,
  });
  assert.equal(qualified.status, 'CALCULATED');
});

test('fiscal rollover is evaluated in Asia/Kolkata', () => {
  assert.equal(getCurrentFiscalYear(new Date('2026-03-31T18:29:59.000Z')), 'FY2025-26');
  assert.equal(getCurrentFiscalYear(new Date('2026-03-31T18:30:00.000Z')), 'FY2026-27');
});
