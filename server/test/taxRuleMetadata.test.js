import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxRuleMetadata } from '../services/taxRuleMetadata.js';
import { computeTax, getTaxPolicyMetadata } from '../services/taxEngine.js';

test('current statute reports semantic rule IDs and isolates old labels as aliases', () => {
  const result = computeTax(1_000_000, 'new', {}, 'salary', 'FY2026-27');
  assert.equal(result.statuteMetadata.statute, 'INCOME_TAX_ACT_2025');
  assert.ok(result.rulesApplied.every(rule => !/SECTION_(?:87A|80CCD)/.test(rule)));
  assert.ok(result.taxRuleMetadata.currentRuleIds.includes('INCOME_TAX_ACT_2025_REBATE_POLICY'));
  assert.ok(result.taxRuleMetadata.legacyAliases.includes('SECTION_87A_REBATE'));
  assert.ok(result.sourceReferences.some(source => source.url.includes('incometaxindia.gov.in')));
});

test('historical statute retains historical rule labels without labeling them current', () => {
  const result = computeTax(1_000_000, 'new', {}, 'salary', 'FY2025-26');
  assert.equal(result.statuteMetadata.statute, 'INCOME_TAX_ACT_1961');
  assert.ok(result.rulesApplied.includes('SECTION_87A_REBATE'));
  assert.deepEqual(result.taxRuleMetadata.legacyAliases, []);
  assert.deepEqual(result.taxRuleMetadata.currentRuleIds, []);
});

test('legacy section names are not guessed into new statutory section numbers', () => {
  const policy = getTaxPolicyMetadata('FY2026-27');
  const metadata = buildTaxRuleMetadata({
    statuteMetadata: policy.statuteMetadata,
    identifiers: ['SECTION_112A_LTCG_SPECIAL_RATE'],
  });
  assert.deepEqual(metadata.currentRuleIds, ['INCOME_TAX_ACT_2025_EQUITY_LTCG_SPECIAL_RATE_POLICY']);
  assert.deepEqual(metadata.legacyAliases, ['SECTION_112A_LTCG_SPECIAL_RATE']);
  assert.equal(metadata.mappedStatutorySection, undefined);
});
