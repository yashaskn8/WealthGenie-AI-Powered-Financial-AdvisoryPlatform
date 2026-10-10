import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceEntryFromOfficialRate, evidenceEntryFromProjectionAssumption } from '../services/groundedEvidence.js';
import { validateTypedFinancialClaims } from '../services/typedFinancialClaims.js';

function productRateEvidence(overrides = {}) {
  const evidence = evidenceEntryFromOfficialRate({
    id: 'deposit:sbi:retail-domestic:1y:public',
    name: 'SBI Retail Domestic Term Deposit',
    source: { provider: 'SBI', url: 'https://sbi.bank.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits' },
    officialRate: {
      value: 7.25,
      basis: 'OFFICIAL_NOMINAL_CARD_RATE_PER_ANNUM',
      effectiveFrom: '2026-10-01',
      effectiveTo: '2026-12-31',
      dataClass: 'OFFICIAL_BANK_PUBLISHED_RATE',
    },
  });
  return { ...evidence, id: 'E_RATE', ...overrides };
}

function rateClaim(overrides = {}) {
  return {
    type: 'CURRENT_RATE',
    value: 7.25,
    unit: 'PERCENT_PER_ANNUM',
    timePeriod: '2026-10-01/2026-12-31',
    source: 'SBI',
    evidenceId: 'E_RATE',
    jurisdiction: 'IN',
    effectivePeriod: { from: '2026-10-01', to: '2026-12-31' },
    statement: 'The current rate is 7.25% p.a. [E_RATE].',
    ...overrides,
  };
}

function verify(claim, evidence = productRateEvidence(), narrative = claim.statement) {
  return validateTypedFinancialClaims({ claims: [claim], narrative, evidenceEntries: [evidence] });
}

test('typed financial claim supports all declared types only with their exact evidence contract', () => {
  const fixtures = [
    ['CURRENT_RATE', productRateEvidence(), { value: 7.25, unit: 'PERCENT_PER_ANNUM', timePeriod: '2026-10-01/2026-12-31', source: 'SBI', jurisdiction: 'IN', effectivePeriod: { from: '2026-10-01', to: '2026-12-31' }, statement: 'The current rate is 7.25% p.a. [E_RATE].' }],
    ['HISTORICAL_RETURN', {
      id: 'E_HISTORY', kind: 'HISTORICAL_RETURN', dataClass: 'VERIFIED_HISTORICAL_FACT',
      value: { historicalReturnPct: 12, periodStart: '2025-10-01', periodEnd: '2026-10-01', basis: 'VERIFIED_NAV_PAIR' },
      source: { provider: 'AMFI' },
    }, { value: 12, unit: 'PERCENT', timePeriod: '2025-10-01/2026-10-01', source: 'AMFI', jurisdiction: 'IN', effectivePeriod: { from: '2025-10-01', to: '2026-10-01' }, statement: 'The historical return was 12% [E_HISTORY].' }],
    ['EXPECTED_RETURN', evidenceEntryFromProjectionAssumption('balanced', {
      mean: 0.08,
      stdDev: 0.16,
      source: 'WEALTHGENIE_MODEL_POLICY',
      assumptionVersion: 'wealthgenie-projection-assumptions-test',
      providerForecast: false,
    }), { value: 8, unit: 'PERCENT', timePeriod: 'ANNUAL_MODEL_ASSUMPTION', source: 'WEALTHGENIE_MODEL_POLICY', jurisdiction: null, effectivePeriod: null, statement: 'The expected return assumption is 8% [E_PROJECTION_ASSUMPTION_BALANCED].' }],
    ['PROJECTED_RETURN', {
      id: 'E_PROJECTED', kind: 'PROJECTION_RESULT', dataClass: 'SIMULATION',
      value: { projectedReturnPct: 6, horizonYears: 5 }, source: { provider: 'SIMULATION' },
    }, { value: 6, unit: 'PERCENT', timePeriod: 'HORIZON:5Y', source: 'SIMULATION', jurisdiction: null, effectivePeriod: null, statement: 'The projected return is 6% [E_PROJECTED].' }],
    ['POST_TAX_RETURN', {
      id: 'E_POST_TAX', kind: 'POST_TAX_RESULT', dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
      value: { postTaxReturnPct: 5, calculationClass: 'CURRENT_RATE_POST_TAX_ILLUSTRATION', fiscalYear: 'FY2026-27', jurisdiction: 'IN' },
      authority: 'WEALTHGENIE_TAX_ENGINE',
    }, { value: 5, unit: 'PERCENT', timePeriod: 'FY2026-27', source: 'WEALTHGENIE_TAX_ENGINE', jurisdiction: 'IN', effectivePeriod: null, statement: 'The post-tax return illustration is 5% for FY2026-27 [E_POST_TAX].' }],
    ['ALLOCATION_WEIGHT', {
      id: 'E_ALLOCATION', kind: 'RECOMMENDATION', dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
      value: { allocationPct: 60 }, authority: 'WEALTHGENIE_BACKEND',
    }, { value: 60, unit: 'PERCENT', timePeriod: 'CURRENT_PLAN', source: 'WEALTHGENIE_BACKEND', jurisdiction: null, effectivePeriod: null, statement: 'The current plan allocation weight is 60% [E_ALLOCATION].' }],
    ['TAX_RATE', {
      id: 'E_TAX_RATE', kind: 'TAX_POLICY', dataClass: 'DETERMINISTIC_BACKEND_RESULT',
      value: { taxRatePct: 20, fiscalYear: 'FY2026-27', jurisdiction: 'IN' }, authority: 'WEALTHGENIE_TAX_ENGINE',
    }, { value: 20, unit: 'PERCENT', timePeriod: 'FY2026-27', source: 'WEALTHGENIE_TAX_ENGINE', jurisdiction: 'IN', effectivePeriod: null, statement: 'The tax rate is 20% for FY2026-27 [E_TAX_RATE].' }],
    ['CURRENT_COUPON', evidenceEntryFromOfficialRate({
      id: 'government:rbi:frsb-2020-taxable',
      name: 'Government of India / RBI Floating Rate Savings Bond',
      source: { provider: 'RBI', url: 'https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11924' },
      officialRate: {
        value: 7.1,
        basis: 'NSC_REFERENCE_RATE_PLUS_35_BPS',
        effectiveFrom: '2026-07-01',
        effectiveTo: '2026-12-31',
        dataClass: 'OFFICIAL_RBI_FLOATING_COUPON_RATE',
      },
    }), { value: 7.1, unit: 'PERCENT_PER_ANNUM', timePeriod: '2026-07-01/2026-12-31', source: 'RBI', jurisdiction: 'IN', effectivePeriod: { from: '2026-07-01', to: '2026-12-31' }, statement: 'The current coupon is 7.1% p.a. [E_OFFICIAL_RATE_001].' }],
    ['MATURITY_AMOUNT', {
      id: 'E_MATURITY', kind: 'MATURITY_RESULT', dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
      value: { maturityAmount: 150000, maturityDate: '2031-10-01', jurisdiction: 'IN' }, authority: 'WEALTHGENIE_FIXED_INCOME_ENGINE',
    }, { value: 150000, unit: 'INR', timePeriod: 'MATURITY:2031-10-01', source: 'WEALTHGENIE_FIXED_INCOME_ENGINE', jurisdiction: 'IN', effectivePeriod: null, statement: 'The maturity amount is ₹150,000 on maturity [E_MATURITY].' }],
    ['CONTRIBUTION', {
      id: 'E_PROFILE_SAVINGS', kind: 'PROFILE', dataClass: 'USER_INPUT', value: 15000,
    }, { value: 15000, unit: 'INR_PER_MONTH', timePeriod: 'MONTHLY', source: 'USER_INPUT', jurisdiction: null, effectivePeriod: null, statement: 'The monthly contribution is ₹15,000 per month [E_PROFILE_SAVINGS].' }],
    ['RISK_SCORE', {
      id: 'E_RISK_SCORE', kind: 'SUITABILITY', dataClass: 'DERIVED_VALUE',
      value: { riskScore: 4 }, authority: 'WEALTHGENIE_BACKEND',
    }, { value: 4, unit: 'SCORE', timePeriod: 'CURRENT_PROFILE', source: 'WEALTHGENIE_BACKEND', jurisdiction: null, effectivePeriod: null, statement: 'The current profile risk score is 4 [E_RISK_SCORE].' }],
  ];

  for (const [type, evidence, fields] of fixtures) {
    const claim = { type, evidenceId: evidence.id, ...fields };
    const result = validateTypedFinancialClaims({ claims: [claim], narrative: claim.statement, evidenceEntries: [evidence] });
    assert.equal(result.passed, true, `${type}: ${result.errors.join(', ')}`);
    assert.equal(result.claimCount, 1);
  }
});

test('a historical fact cannot be relabelled expected or projected return', () => {
  const evidence = {
    id: 'E_HISTORY', kind: 'HISTORICAL_RETURN', dataClass: 'VERIFIED_HISTORICAL_FACT',
    value: { historicalReturnPct: 12, periodStart: '2025-10-01', periodEnd: '2026-10-01', basis: 'VERIFIED_NAV_PAIR' },
    source: { provider: 'AMFI' },
  };
  const expected = {
    ...rateClaim(), type: 'EXPECTED_RETURN', value: 12, unit: 'PERCENT',
    timePeriod: '2025-10-01/2026-10-01', source: 'AMFI', evidenceId: 'E_HISTORY',
    effectivePeriod: { from: '2025-10-01', to: '2026-10-01' },
    statement: 'The expected return is 12% [E_HISTORY].',
  };
  const projected = { ...expected, type: 'PROJECTED_RETURN', statement: 'The projected return is 12% [E_HISTORY].' };
  for (const claim of [expected, projected]) {
    const result = verify(claim, evidence);
    assert.equal(result.passed, false);
    assert.ok(result.errors.includes('CLAIM_AUTHORITY_MISMATCH'));
  }
});

test('provider-qualified current-rate classes and the RBI reset coupon retain distinct meaning', () => {
  const governmentRate = evidenceEntryFromOfficialRate({
    id: 'government:india-post:ppf',
    name: 'Public Provident Fund',
    source: { provider: 'GOVERNMENT_OF_INDIA' },
    officialRate: {
      value: 7.1,
      basis: 'OFFICIAL_NOMINAL_RATE_PER_ANNUM',
      effectiveFrom: '2026-10-01',
      effectiveTo: '2026-12-31',
      dataClass: 'QUARTERLY_OFFICIAL_RATE',
    },
  });
  const governmentClaim = {
    ...rateClaim(),
    value: 7.1,
    source: 'GOVERNMENT_OF_INDIA',
    evidenceId: governmentRate.id,
    statement: `The current rate is 7.1% p.a. [${governmentRate.id}].`,
  };
  assert.equal(validateTypedFinancialClaims({
    claims: [governmentClaim], narrative: governmentClaim.statement, evidenceEntries: [governmentRate],
  }).passed, true);

  const genericClassEvidence = { ...productRateEvidence(), dataClass: 'VERIFIED_PRODUCT_FACT' };
  assert.equal(verify(rateClaim(), genericClassEvidence).passed, false);

  const rbiCoupon = evidenceEntryFromOfficialRate({
    id: 'government:rbi:frsb-2020-taxable',
    name: 'Government of India / RBI Floating Rate Savings Bond',
    source: { provider: 'RBI' },
    officialRate: {
      value: 7.1,
      basis: 'NSC_REFERENCE_RATE_PLUS_35_BPS',
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-12-31',
      dataClass: 'OFFICIAL_RBI_FLOATING_COUPON_RATE',
    },
  });
  const mislabeled = {
    ...rateClaim(),
    value: 7.1,
    source: 'RBI',
    evidenceId: rbiCoupon.id,
    timePeriod: '2026-07-01/2026-12-31',
    effectivePeriod: { from: '2026-07-01', to: '2026-12-31' },
    statement: `The current rate is 7.1% p.a. [${rbiCoupon.id}].`,
  };
  assert.equal(validateTypedFinancialClaims({
    claims: [mislabeled], narrative: mislabeled.statement, evidenceEntries: [rbiCoupon],
  }).passed, false);
});

test('model return assumptions must be described as assumptions, never provider forecasts', () => {
  const evidence = evidenceEntryFromProjectionAssumption('balanced', {
    mean: 0.08,
    stdDev: 0.16,
    source: 'WEALTHGENIE_MODEL_POLICY',
    assumptionVersion: 'wealthgenie-projection-assumptions-test',
    providerForecast: false,
  });
  const claim = {
    type: 'EXPECTED_RETURN',
    value: 8,
    unit: 'PERCENT',
    timePeriod: 'ANNUAL_MODEL_ASSUMPTION',
    source: 'WEALTHGENIE_MODEL_POLICY',
    evidenceId: evidence.id,
    jurisdiction: null,
    effectivePeriod: null,
    statement: `The expected return is 8% [${evidence.id}].`,
  };
  const result = validateTypedFinancialClaims({ claims: [claim], narrative: claim.statement, evidenceEntries: [evidence] });
  assert.equal(result.passed, false);
  assert.ok(result.errors.includes('CLAIM_SEMANTIC_TYPE_MISMATCH'));
});

test('model return assumptions cannot be presented as guaranteed or certain outcomes', () => {
  const evidence = evidenceEntryFromProjectionAssumption('balanced', {
    mean: 0.08,
    stdDev: 0.16,
    source: 'WEALTHGENIE_MODEL_POLICY',
    assumptionVersion: 'wealthgenie-projection-assumptions-test',
    providerForecast: false,
  });
  const statements = [
    `The expected return assumption is guaranteed at 8% [${evidence.id}].`,
    `The expected return assumption will deliver 8% [${evidence.id}].`,
    `The expected return assumption is risk-free at 8% [${evidence.id}].`,
  ];
  for (const statement of statements) {
    const claim = {
      type: 'EXPECTED_RETURN',
      value: 8,
      unit: 'PERCENT',
      timePeriod: 'ANNUAL_MODEL_ASSUMPTION',
      source: 'WEALTHGENIE_MODEL_POLICY',
      evidenceId: evidence.id,
      jurisdiction: null,
      effectivePeriod: null,
      statement,
    };
    const result = validateTypedFinancialClaims({ claims: [claim], narrative: statement, evidenceEntries: [evidence] });
    assert.equal(result.passed, false, statement);
    assert.ok(result.errors.includes('CLAIM_SEMANTIC_TYPE_MISMATCH'), statement);
  }
});

test('signed historical return mentions must match the signed evidence value', () => {
  const positiveEvidence = {
    id: 'E_HISTORY_POSITIVE', kind: 'HISTORICAL_RETURN', dataClass: 'VERIFIED_HISTORICAL_FACT',
    value: { historicalReturnPct: 7.25, periodStart: '2025-10-01', periodEnd: '2026-10-01', basis: 'VERIFIED_NAV_PAIR' },
    source: { provider: 'AMFI' },
  };
  const negativeStatement = `The historical return was -7.25% [${positiveEvidence.id}].`;
  const mismatched = {
    type: 'HISTORICAL_RETURN',
    value: 7.25,
    unit: 'PERCENT',
    timePeriod: '2025-10-01/2026-10-01',
    source: 'AMFI',
    evidenceId: positiveEvidence.id,
    jurisdiction: 'IN',
    effectivePeriod: { from: '2025-10-01', to: '2026-10-01' },
    statement: negativeStatement,
  };
  const mismatchResult = validateTypedFinancialClaims({
    claims: [mismatched], narrative: negativeStatement, evidenceEntries: [positiveEvidence],
  });
  assert.equal(mismatchResult.passed, false);
  assert.ok(mismatchResult.errors.includes('CLAIM_VALUE_OR_UNIT_MISMATCH'));

  const negativeEvidence = {
    ...positiveEvidence,
    id: 'E_HISTORY_NEGATIVE',
    value: { ...positiveEvidence.value, historicalReturnPct: -7.25 },
  };
  const validStatement = `The historical return was −7.25% [${negativeEvidence.id}].`;
  const validClaim = {
    ...mismatched,
    value: -7.25,
    evidenceId: negativeEvidence.id,
    statement: validStatement,
  };
  const negativeResult = validateTypedFinancialClaims({
    claims: [validClaim], narrative: validStatement, evidenceEntries: [negativeEvidence],
  });
  assert.equal(negativeResult.passed, true, negativeResult.errors.join(', '));
});

test('missing model assumptions stay unavailable and cannot be claimed as zero', () => {
  const evidence = evidenceEntryFromProjectionAssumption('balanced', {
    mean: null,
    stdDev: null,
    source: 'WEALTHGENIE_MODEL_POLICY',
    assumptionVersion: 'wealthgenie-projection-assumptions-test',
    providerForecast: false,
  });
  assert.equal(evidence.value.annualReturnAssumptionPct, null);
  assert.equal(evidence.value.annualVolatilityAssumptionPct, null);
  const claim = {
    type: 'EXPECTED_RETURN',
    value: 0,
    unit: 'PERCENT',
    timePeriod: 'ANNUAL_MODEL_ASSUMPTION',
    source: 'WEALTHGENIE_MODEL_POLICY',
    evidenceId: evidence.id,
    jurisdiction: null,
    effectivePeriod: null,
    statement: `The expected return assumption is 0% [${evidence.id}].`,
  };
  const result = validateTypedFinancialClaims({ claims: [claim], narrative: claim.statement, evidenceEntries: [evidence] });
  assert.equal(result.passed, false);
  assert.ok(result.errors.includes('CLAIM_AUTHORITY_MISMATCH'));
});

test('correct-looking values fail on wrong value, unit, source, evidence, period, or jurisdiction', () => {
  const invalidClaims = [
    rateClaim({ value: 7.2 }),
    rateClaim({ unit: 'PERCENT' }),
    rateClaim({ source: 'attacker-controlled' }),
    rateClaim({ evidenceId: 'E_UNKNOWN' }),
    rateClaim({ timePeriod: '2025-10-01/2026-10-01' }),
    rateClaim({ jurisdiction: 'US' }),
    rateClaim({ effectivePeriod: { from: '2025-10-01', to: '2026-10-01' } }),
    rateClaim({ statement: 'The current rate is 7.25% [E_RATE].' }),
  ];
  for (const claim of invalidClaims) assert.equal(verify(claim).passed, false, JSON.stringify(claim));
  assert.ok(verify(rateClaim({ source: 'attacker-controlled' })).errors.includes('CLAIM_AUTHORITY_MISMATCH'),
    'a complete-looking typed claim with an incorrect source is rejected against evidence provenance');
});

test('numeric text requires an exact typed claim and every numeric mention must be covered', () => {
  const missing = validateTypedFinancialClaims({
    claims: [],
    narrative: 'The current rate is 7.25% p.a. [E_RATE].',
    evidenceEntries: [productRateEvidence()],
  });
  assert.equal(missing.passed, false);
  assert.ok(missing.errors.includes('TYPED_CLAIM_REQUIRED'));

  const extraNumber = verify(rateClaim(), productRateEvidence(),
    `${rateClaim().statement} The expected return is 9% [E_MISSING].`);
  assert.equal(extraNumber.passed, false);
  assert.ok(extraNumber.errors.includes('UNBOUND_FINANCIAL_NUMBER'));

  const quiet = validateTypedFinancialClaims({ claims: [], narrative: 'The review is ready.', evidenceEntries: [] });
  assert.equal(quiet.passed, true);
  assert.equal(quiet.status, 'NO_FINANCIAL_CLAIM');
});
