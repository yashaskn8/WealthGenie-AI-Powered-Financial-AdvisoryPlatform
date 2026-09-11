import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentFiscalYear,
  getCurrentRegulatoryRuleVersion,
} from '../services/taxEngine.js';
import { canonicalAuditInputs } from '../routes/recommend.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const beforeIndiaMidnight = new Date('2027-03-31T17:59:59.999Z');
const afterIndiaMidnight = new Date('2027-03-31T18:30:00.001Z');

test('fiscal-year authority uses India time before and after the April 1 boundary', () => {
  assert.equal(getCurrentFiscalYear(beforeIndiaMidnight), 'FY2026-27');
  assert.equal(getCurrentFiscalYear(afterIndiaMidnight), 'FY2027-28');
});

test('regulatory version lookup is dynamic without reloading the tax module', () => {
  assert.equal(getCurrentRegulatoryRuleVersion(beforeIndiaMidnight), 'tax-policy-FY2026-27-v2');
  assert.equal(getCurrentRegulatoryRuleVersion(afterIndiaMidnight), null);
});

test('unsupported future fiscal years never reuse the previous verified version', () => {
  const previousVersion = getCurrentRegulatoryRuleVersion(beforeIndiaMidnight);
  const futureVersion = getCurrentRegulatoryRuleVersion(afterIndiaMidnight);

  assert.equal(previousVersion, 'tax-policy-FY2026-27-v2');
  assert.equal(futureVersion, null);
  assert.notEqual(futureVersion, previousVersion);
});

test('canonical audit metadata uses the version resolved for that request', () => {
  const requestVersion = getCurrentRegulatoryRuleVersion(beforeIndiaMidnight);
  const inputs = canonicalAuditInputs(
    canonicalProfile(),
    { capacityScore: 55, finalRisk: 'Moderate', reasonCodes: [] },
    'model-version-under-test',
    requestVersion,
  );

  assert.equal(inputs.regulatory_rule_version, requestVersion);
  assert.equal(inputs.model_version, 'model-version-under-test');
});
