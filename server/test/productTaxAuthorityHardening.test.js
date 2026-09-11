import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEquityCapitalGainsTax,
  getTaxPolicyCatalog,
  getTaxPolicyMetadata,
} from '../services/taxEngine.js';
import {
  calculateProductPostTaxOutcome,
  classifyProductTaxType,
} from '../services/productPostTaxCalculator.js';

const taxContext = {
  annualGrossIncome: 500000,
  incomeSource: 'salary',
  regime: 'new',
  fiscalYear: 'FY2026-27',
  userAge: 35,
  holdingPeriodMonths: 12,
  section112AExemptionUsed: 125000,
  illustrativePrincipal: 1000000,
};

test('policy metadata exposes the current authority and future years fail closed', () => {
  const catalog = getTaxPolicyCatalog();
  assert.equal(catalog.currentFiscalYear, 'FY2026-27');
  assert.ok(catalog.verifiedFiscalYears.includes('FY2026-27'));
  assert.equal(getTaxPolicyMetadata('FY2026-27').rules.newRegime87ARebate, 60000);
  assert.equal(getTaxPolicyMetadata('FY2025-26').rules.newRegime87ALimit, 1200000);
  assert.equal(getTaxPolicyMetadata('FY2025-26').rules.newRegime87ARebate, 60000);
  assert.throws(() => getTaxPolicyMetadata('FY2027-28'), error => error.code === 'FISCAL_YEAR_UNSUPPORTED');
});

test('special-rate equity tax is separate from ordinary slabs and does not consume 87A', () => {
  const result = computeEquityCapitalGainsTax({
    grossGain: 100000,
    holdingPeriodMonths: 13,
    annualIncome: 500000,
    regime: 'new',
    incomeSource: 'salary',
    fiscalYear: 'FY2026-27',
    section112AExemptionUsed: 125000,
  });
  assert.equal(result.status, 'CALCULATED');
  assert.equal(result.taxClass, 'EQUITY_LTCG_SECTION_112A');
  assert.equal(result.exemptionApplied, 0);
  assert.equal(result.rebateApplied, false);
  assert.equal(result.taxAmount, 13000);
  assert.equal(result.cess, 500);
});

test('Section 112A exemption usage is order-independent across product what-ifs', () => {
  const first = computeProduct(100000, taxContext);
  const second = computeProduct(200000, taxContext);
  const reversedFirst = computeProduct(200000, taxContext);
  const reversedSecond = computeProduct(100000, taxContext);

  assert.equal(first.exemptionApplied, 0);
  assert.equal(second.exemptionApplied, 0);
  assert.equal(first.incrementalTax, reversedSecond.incrementalTax);
  assert.equal(second.incrementalTax, reversedFirst.incrementalTax);
});

test('WTI does not infer mutual-fund tax class from name or category', () => {
  assert.equal(classifyProductTaxType({ name: 'ELSS Tax Saver Fund', productType: 'MUTUAL_FUND' }, 'large_cap_mf'), 'TAX_CLASSIFICATION_UNAVAILABLE');
  const outcome = calculateProductPostTaxOutcome({
    product: {
      name: 'ELSS Tax Saver Fund',
      productType: 'MUTUAL_FUND',
      parentInstrumentId: 'large_cap_mf',
      historicalReturn: { valuePct: 20 },
    },
    taxCalculationContext: taxContext,
  });
  assert.equal(outcome.status, 'TAX_CLASSIFICATION_UNAVAILABLE');
  assert.equal(outcome.postTaxRatePct, null);
});

function computeProduct(grossGain, context) {
  return computeEquityCapitalGainsTax({
    grossGain,
    holdingPeriodMonths: context.holdingPeriodMonths,
    annualIncome: context.annualGrossIncome,
    regime: context.regime,
    incomeSource: context.incomeSource,
    fiscalYear: context.fiscalYear,
    section112AExemptionUsed: context.section112AExemptionUsed,
  });
}
