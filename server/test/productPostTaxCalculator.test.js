import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProductTaxType,
  calculateProductPostTaxOutcome,
  generateBeginnerSuitability,
  enrichProductsWithPostTaxAndSuitability,
} from '../services/productPostTaxCalculator.js';

test('classifyProductTaxType identifies correct tax categories', () => {
  assert.equal(classifyProductTaxType({}, 'ppf'), 'EEE_TAX_FREE');
  assert.equal(classifyProductTaxType({}, 'sukanya'), 'EEE_TAX_FREE');
  assert.equal(classifyProductTaxType({}, 'rbi_bonds'), 'RBI_FLOATING_RATE_BOND');
  assert.equal(classifyProductTaxType({}, 'fd'), 'BANK_FIXED_DEPOSIT');
  assert.equal(classifyProductTaxType({}, 'sbi_fd'), 'BANK_FIXED_DEPOSIT');
  assert.equal(classifyProductTaxType({}, 'scss'), 'GOVERNMENT_TAXABLE_SAVINGS');
  assert.equal(classifyProductTaxType({}, 'nsc'), 'GOVERNMENT_TAXABLE_SAVINGS');
  assert.equal(classifyProductTaxType({}, 'corporate_bond_mf'), 'DEBT_MF_SECTION_50AA');
  assert.equal(classifyProductTaxType({}, 'large_cap_mf'), 'EQUITY_MF_SECTION_112A');
});

test('PPF & SSY EEE tax-exemption yields 0 incremental tax and postTaxRatePct = officialRate', () => {
  const ppfProduct = {
    id: 'ppf:fact',
    name: 'Public Provident Fund',
    parentInstrumentId: 'ppf',
    officialRate: { value: 7.1 },
  };
  const outcome = calculateProductPostTaxOutcome({
    product: ppfProduct,
    profile: { age: 30 },
    taxCalculationContext: null, // Should work even without tax context because EEE is 100% tax free
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.incrementalTax, 0);
  assert.equal(outcome.postTaxRatePct, 7.1);
  assert.equal(outcome.grossGain, 710);
  assert.equal(outcome.netGain, 710);
  assert.equal(outcome.taxClassification, 'EEE_TAX_FREE');
  assert.equal(outcome.isHistoricalEstimate, false);
});

test('Taxable product without explicit tax context returns REQUIRES_TAX_INPUTS without crashing or showing fake 0%', () => {
  const fdProduct = {
    id: 'sbi:fd:1y',
    name: 'SBI 1-Year Term Deposit',
    parentInstrumentId: 'sbi_fd',
    officialRate: { value: 6.8 },
  };
  const outcome = calculateProductPostTaxOutcome({
    product: fdProduct,
    profile: { age: 35 },
    taxCalculationContext: null,
  });

  assert.equal(outcome.status, 'REQUIRES_TAX_INPUTS');
  assert.equal(outcome.postTaxRatePct, null);
  assert.equal(outcome.message, 'Add tax details to calculate your after-tax return');
});

test('Taxable SBI FD calculates incremental tax using versioned taxEngine', () => {
  const fdProduct = {
    id: 'sbi:fd:1y',
    name: 'SBI 1-Year Term Deposit',
    parentInstrumentId: 'sbi_fd',
    officialRate: { value: 7.0 },
  };
  const outcome = calculateProductPostTaxOutcome({
    product: fdProduct,
    profile: { age: 35 },
    taxCalculationContext: {
      annualGrossIncome: 1500000,
      regime: 'new',
      fiscalYear: 'FY2025-26',
      incomeSource: 'salary',
      illustrativePrincipal: 10000,
    },
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.illustrativePrincipal, 10000);
  assert.equal(outcome.grossGain, 700);
  assert.ok(outcome.incrementalTax > 0);
  assert.ok(outcome.netGain < 700);
  assert.ok(outcome.postTaxRatePct < 7.0);
  assert.ok(outcome.postTaxRatePct > 0);
  assert.equal(outcome.isHistoricalEstimate, false);
});

test('RBI FRSB labels outcome as Current coupon after tax and disclaims 6-month reset without 7-year guarantee', () => {
  const rbiBond = {
    id: 'rbi:frsb:current',
    name: 'RBI Floating Rate Savings Bond',
    parentInstrumentId: 'rbi_bonds',
    officialRate: { value: 8.05 },
  };
  const outcome = calculateProductPostTaxOutcome({
    product: rbiBond,
    profile: { age: 40 },
    taxCalculationContext: {
      annualGrossIncome: 1200000,
      regime: 'new',
      fiscalYear: 'FY2025-26',
      incomeSource: 'salary',
      illustrativePrincipal: 10000,
    },
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.metricLabel, 'Current coupon after tax');
  assert.ok(outcome.disclosure.includes('resets every six months'));
  assert.ok(outcome.disclosure.includes('Not a guaranteed 7-year return'));
  assert.equal(outcome.isHistoricalEstimate, false);
});

test('Mutual fund returns are labelled HISTORICAL and NOT A FORECAST', () => {
  const equityMf = {
    id: 'amfi:101',
    name: 'Nifty 50 Index Fund',
    productType: 'MUTUAL_FUND',
    parentInstrumentId: 'large_cap_mf',
    historicalReturn: { valuePct: 15.0 },
  };
  const outcome = calculateProductPostTaxOutcome({
    product: equityMf,
    profile: { age: 30 },
    taxCalculationContext: {
      annualGrossIncome: 1000000,
      regime: 'new',
      fiscalYear: 'FY2025-26',
      incomeSource: 'salary',
      illustrativePrincipal: 10000,
    },
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.metricLabel, 'Historical 1Y after-tax return');
  assert.ok(outcome.disclosure.includes('HISTORICAL — NOT A FORECAST'));
  assert.equal(outcome.isHistoricalEstimate, true);
  assert.ok(outcome.postTaxRatePct <= 15.0);
});

test('generateBeginnerSuitability produces deterministic plain-English reasons, risk tiers, and liquidity copy', () => {
  const ppf = {
    id: 'ppf:fact',
    name: 'Public Provident Fund',
    parentInstrumentId: 'ppf',
    officialRate: { value: 7.1 },
  };
  const suitability = generateBeginnerSuitability({
    product: ppf,
    profile: {
      investmentGoals: ['Retirement', 'Wealth Growth'],
      investmentHorizonYears: 15,
      riskTolerance: 'Conservative',
    },
  });

  assert.equal(suitability.riskTier, 'Very Low Risk');
  assert.ok(suitability.accessToMoney.includes('15-year term'));
  assert.ok(suitability.whyThisFitsYou.includes('Retirement and Wealth Growth'));
  assert.equal(suitability.verifiedFactLabel, 'Current official rate');
  assert.equal(suitability.verifiedFactValue, '7.10% p.a.');
});

test('enrichProductsWithPostTaxAndSuitability enriches product array without mutating historicalReturn', () => {
  const products = [
    {
      id: 'amfi:101',
      name: 'Test Fund',
      productType: 'MUTUAL_FUND',
      parentInstrumentId: 'large_cap_mf',
      historicalReturn: { valuePct: 18.25 },
      postTaxReturn: null,
    },
  ];
  const enriched = enrichProductsWithPostTaxAndSuitability(products, {
    profile: { investmentGoals: ['Wealth Growth'], investmentHorizonYears: 10 },
    parentCatalog: { id: 'large_cap_mf' },
    taxCalculationContext: {
      annualGrossIncome: 1200000,
      regime: 'new',
      fiscalYear: 'FY2025-26',
    },
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].historicalReturn.valuePct, 18.25); // Invariant: historicalReturn is untouched
  assert.ok(enriched[0].beginnerSuitability);
  assert.ok(enriched[0].postTaxAnalysis);
  assert.ok(enriched[0].postTaxReturn > 0);
  assert.ok(enriched[0].postTaxReturn <= 18.25);
});
