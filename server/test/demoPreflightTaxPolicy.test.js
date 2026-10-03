import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeReporter,
  qualifiesTaxPolicyMetadata,
} from '../scripts/demoPreflight.js';

const NOW = new Date('2026-10-03T16:30:00.000Z');

function response(body, ok = true) {
  return { response: { ok }, body };
}

test('tax-policy preflight accepts only verified metadata for the actual current fiscal year', () => {
  const valid = response({
    currentFiscalYear: 'FY2026-27',
    currentFiscalYearVerified: true,
  });
  assert.equal(qualifiesTaxPolicyMetadata(valid, { now: NOW }), true);

  const wrongFiscalYear = response({
    currentFiscalYear: 'FY2025-26',
    currentFiscalYearVerified: true,
  });
  assert.equal(qualifiesTaxPolicyMetadata(wrongFiscalYear, { now: NOW }), false);

  const unverified = response({
    currentFiscalYear: 'FY2026-27',
    currentFiscalYearVerified: false,
  });
  assert.equal(qualifiesTaxPolicyMetadata(unverified, { now: NOW }), false);
});

test('tax-policy preflight fails closed for missing, malformed, or unsuccessful metadata', () => {
  const cases = [
    null,
    undefined,
    {},
    { response: null, body: null },
    response(null),
    response({}, true),
    response({ currentFiscalYear: 'FY2026-27' }),
    response({ currentFiscalYear: 2026, currentFiscalYearVerified: true }),
    response({ currentFiscalYear: 'FY2026-27', currentFiscalYearVerified: true }, false),
  ];

  for (const value of cases) {
    const outcome = qualifiesTaxPolicyMetadata(value, { now: NOW });
    assert.equal(typeof outcome, 'boolean');
    assert.equal(outcome, false);
  }
});

test('tax-policy preflight never sends a non-Boolean outcome to the strict reporter', () => {
  const cases = [
    response({ currentFiscalYear: 'FY2026-27', currentFiscalYearVerified: true }),
    null,
    response({ currentFiscalYear: 'FY2025-26', currentFiscalYearVerified: true }),
    response({ currentFiscalYear: 'FY2026-27', currentFiscalYearVerified: false }),
    response({ currentFiscalYear: 2026, currentFiscalYearVerified: true }),
  ];

  for (const value of cases) {
    const reporter = makeReporter(() => {});
    const outcome = qualifiesTaxPolicyMetadata(value, { now: NOW });
    assert.doesNotThrow(() => reporter.add('Tax-policy metadata', outcome, 'focused predicate verification'));
    const recorded = reporter.checks.find(check => check.name === 'Tax-policy metadata');
    assert.equal(recorded.state, outcome ? 'PASS' : 'FAIL');
  }
});
