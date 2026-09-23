import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProductTaxType,
  calculateProductPostTaxOutcome,
  generateBeginnerSuitability,
  enrichProductsWithPostTaxAndSuitability,
} from '../services/productPostTaxCalculator.js';

test('classifyProductTaxType identifies correct tax categories', () => {
  assert.equal(classifyProductTaxType({}, 'ppf'), 'PPF_ACCOUNT_EXCLUSION_CONDITIONAL');
  assert.equal(classifyProductTaxType({}, 'sukanya'), 'SSY_ACCOUNT_EXCLUSION_CONDITIONAL');
  assert.equal(classifyProductTaxType({}, 'rbi_bonds'), 'RBI_FRSB_INTEREST');
  assert.equal(classifyProductTaxType({}, 'fd'), 'BANK_DEPOSIT_INTEREST');
  assert.equal(classifyProductTaxType({}, 'sbi_fd'), 'BANK_DEPOSIT_INTEREST');
  assert.equal(classifyProductTaxType({}, 'scss'), 'TAX_CLASSIFICATION_UNAVAILABLE');
  assert.equal(classifyProductTaxType({}, 'nsc'), 'TAX_CLASSIFICATION_UNAVAILABLE');
  assert.equal(classifyProductTaxType({}, 'corporate_bond_mf'), 'TAX_CLASSIFICATION_UNAVAILABLE');
  assert.equal(classifyProductTaxType({}, 'large_cap_mf'), 'TAX_CLASSIFICATION_UNAVAILABLE');
  assert.equal(classifyProductTaxType({ name: 'Public Provident Fund' }, 'unknown'), 'TAX_CLASSIFICATION_UNAVAILABLE');
});

test('PPF and SSY tax outcomes fail closed unless account and payment facts are established', () => {
  for (const [parentInstrumentId, requiredInputs] of [
    ['ppf', ['verifiedAccountEligibility', 'contributionHistory', 'withdrawalOrMaturityFacts']],
    ['sukanya', ['verifiedAccountEligibility', 'eligibleBeneficiary', 'paymentFacts']],
  ]) {
    const outcome = calculateProductPostTaxOutcome({
      product: { id: `${parentInstrumentId}:fact`, name: parentInstrumentId, parentInstrumentId, officialRate: { value: 7.1 } },
      profile: { age: 30 },
      taxCalculationContext: null,
    });

    assert.equal(outcome.status, 'TAX_CLASSIFICATION_REQUIRES_ACQUISITION_FACTS');
    assert.equal(outcome.incrementalTax, null);
    assert.equal(outcome.postTaxRatePct, null);
    assert.equal(outcome.netGain, null);
    assert.deepEqual(outcome.requiredTaxInputs, requiredInputs);
    assert.match(outcome.disclosure, /No tax-free result/);
  }
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
  assert.equal(outcome.message, 'Additional tax inputs are required for this product.');
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
      userAge: 35,
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
  assert.deepEqual(
    [...new Set(outcome.sourceReferences.map(source => source.role))].sort(),
    ['PRODUCT_RULE', 'TAX_POLICY'],
  );
  assert.equal(
    outcome.sourceReferences.length,
    new Set(outcome.sourceReferences.map(source => [source.authority, source.title, source.url, source.role].join('|'))).size,
  );
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
      userAge: 40,
      illustrativePrincipal: 10000,
    },
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.metricLabel, 'Current coupon after tax');
  assert.ok(outcome.disclosure.includes('resets every six months'));
  assert.ok(outcome.disclosure.includes('not a fixed 7-year return'));
  assert.equal(outcome.isHistoricalEstimate, false);
});

test('Mutual fund returns are labelled HISTORICAL and NOT A FORECAST', () => {
  const equityMf = {
    id: 'amfi:101',
    name: 'Nifty 50 Index Fund',
    productType: 'MUTUAL_FUND',
    parentInstrumentId: 'large_cap_mf',
    historicalReturn: { valuePct: 15.0 },
    taxMetadata: {
      sourceQualified: true,
      taxClass: 'EQUITY_MF_SECTION_112A',
      sourceReferences: [{ authority: 'AMFI', title: 'Qualified product tax adapter', url: 'https://www.amfiindia.com/' }],
      rulesApplied: ['SECTION_112A_LTCG_SPECIAL_RATE'],
    },
  };
  const outcome = calculateProductPostTaxOutcome({
    product: equityMf,
    profile: { age: 30 },
    taxCalculationContext: {
      annualGrossIncome: 1000000,
      regime: 'new',
      fiscalYear: 'FY2025-26',
      incomeSource: 'salary',
      userAge: 30,
      holdingPeriodMonths: 13,
      section112AExemptionUsed: 0,
      illustrativePrincipal: 10000,
    },
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.metricLabel, 'Historical 1Y after-tax return');
  assert.ok(outcome.disclosure.includes('HISTORICAL — NOT A FORECAST'));
  assert.equal(outcome.isHistoricalEstimate, true);
  assert.ok(outcome.postTaxRatePct <= 15.0);
  assert.ok(outcome.sourceReferences.some(source => source.role === 'TAX_POLICY'));
  assert.ok(outcome.sourceReferences.some(source => source.authority === 'AMFI' && source.role === 'PRODUCT_RULE'));
});

test('exact-date WTI tax classification keeps the anniversary short-term without fake month conversion', () => {
  const outcome = calculateProductPostTaxOutcome({
    product: {
      name: 'Qualified equity fund',
      parentInstrumentId: 'large_cap_mf',
      historicalReturn: { valuePct: 15 },
      taxMetadata: {
        sourceQualified: true,
        taxClass: 'EQUITY_MF_SECTION_112A',
        sourceReferences: [{ authority: 'AMFI', title: 'Qualified product tax adapter', url: 'https://www.amfiindia.com/' }],
      },
    },
    taxCalculationContext: {
      annualGrossIncome: 1500000,
      regime: 'new',
      fiscalYear: 'FY2026-27',
      incomeSource: 'salary',
      userAge: 35,
      acquisitionDate: '2024-04-01',
      redemptionDate: '2025-04-01',
      section112AExemptionUsed: 125000,
      illustrativePrincipal: 10000,
    },
  });

  assert.equal(outcome.status, 'CALCULATED');
  assert.equal(outcome.holdingPeriodBasis, 'EXACT_TRANSACTION_DATES');
  assert.ok(outcome.rulesApplied.includes('INCOME_TAX_ACT_2025_EQUITY_STCG_SPECIAL_RATE_POLICY'));
  assert.ok(!outcome.rulesApplied.includes('INCOME_TAX_ACT_2025_EQUITY_LTCG_SPECIAL_RATE_POLICY'));
  assert.ok(outcome.taxRuleMetadata.legacyAliases.includes('SECTION_111A_STCG_SPECIAL_RATE'));
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
    taxMetadata: {
      sourceQualified: true,
      taxClass: 'EQUITY_MF_SECTION_112A',
      sourceReferences: [{ authority: 'AMFI', title: 'Qualified product tax adapter', url: 'https://www.amfiindia.com/' }],
      rulesApplied: ['SECTION_112A_LTCG_SPECIAL_RATE'],
    },
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
      incomeSource: 'salary',
      userAge: 30,
      holdingPeriodMonths: 12,
      section112AExemptionUsed: 0,
    },
  });

  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].historicalReturn.valuePct, 18.25); // Invariant: historicalReturn is untouched
  assert.ok(enriched[0].beginnerSuitability);
  assert.ok(enriched[0].postTaxAnalysis);
  assert.equal(enriched[0].postTaxReturn, null);
  assert.equal(enriched[0].postTaxAnalysis.calculationClass, 'HISTORICAL_RETURN_POST_TAX_ILLUSTRATION');
});
