import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEquityCapitalGainsTax,
  getTaxPolicyCatalog,
  getTaxPolicyMetadata,
} from '../services/taxEngine.js';
import {
  getProductTaxMetadata,
  NIFTYBEES_PRODUCT_TAX_EVIDENCE,
  PRODUCT_TAX_CLASSES,
} from '../services/productTaxAuthority.js';
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

function exactNiftyBeesProduct() {
  return {
    id: 'etf:isin:INF204KB14I2',
    canonicalProductId: 'etf:isin:INF204KB14I2',
    parentInstrumentId: 'nifty_etf',
    productType: 'ETF',
    isin: 'INF204KB14I2',
    exchange: 'NSE',
    ticker: 'NIFTYBEES',
    externalIds: [
      { source: 'ISIN', value: 'INF204KB14I2' },
      { source: 'AMFI_SCHEME_CODE', value: '140084' },
      { source: 'NSE_TRADING_SYMBOL', value: 'NIFTYBEES' },
    ],
    benchmark: {
      id: 'NIFTY_50',
      name: 'NIFTY 50',
      returnVariant: 'NIFTY 50 TRI',
      source: { url: 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf' },
    },
    identityEvidence: [
      { url: 'https://nsearchives.nseindia.com/trading_security/mf/pdf/Nippon_20032026171200_NipponMutualFund.pdf' },
      { url: 'https://nsearchives.nseindia.com/content/circulars/CMPT74390.pdf' },
    ],
  };
}

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
  assert.equal(result.taxClassificationMetadata.statute, 'INCOME_TAX_ACT_2025');
  assert.equal(result.taxClassificationMetadata.classificationId, 'INCOME_TAX_ACT_2025_EQUITY_LTCG_TAX_CLASSIFICATION');
  assert.equal(result.taxClassificationMetadata.legacyClassificationAlias, 'EQUITY_LTCG_SECTION_112A');
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

test('NIFTYBEES equity-oriented tax classification is bound to exact identifiers and the Nippon SID', () => {
  const product = exactNiftyBeesProduct();
  const metadata = getProductTaxMetadata(product, 'nifty_etf');
  assert.equal(metadata.sourceQualified, true);
  assert.equal(metadata.taxClass, PRODUCT_TAX_CLASSES.EQUITY_MF_112A);
  assert.deepEqual(metadata.productEvidence, NIFTYBEES_PRODUCT_TAX_EVIDENCE);
  assert.equal(metadata.productEvidence.documentDate, '2025-11-28');
  assert.equal(metadata.productEvidence.classification, 'EQUITY_ORIENTED_FUND');
  assert.equal(metadata.sourceReferences[0].role, 'PRODUCT_RULE');
  assert.equal(metadata.sourceReferences[0].url, NIFTYBEES_PRODUCT_TAX_EVIDENCE.officialSourceUrl);

  const mutations = [
    candidate => { candidate.canonicalProductId = 'etf:isin:OTHER'; },
    candidate => { candidate.isin = 'OTHER'; },
    candidate => { candidate.externalIds[1].value = '999999'; },
    candidate => { candidate.ticker = 'OTHER'; },
    candidate => { candidate.externalIds[2].value = 'OTHER'; },
    candidate => { candidate.identityEvidence[0].url = 'https://example.org/nippon.pdf'; },
    candidate => { candidate.benchmark.source.url = 'https://example.org/benchmark.pdf'; },
    candidate => { candidate.parentInstrumentId = 'liquid_etf'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(product);
    mutate(changed);
    const result = getProductTaxMetadata(changed, changed.parentInstrumentId);
    assert.equal(result.sourceQualified, false);
    assert.equal(result.taxClass, null);
  }

  const copiedEvidence = {
    ...product,
    parentInstrumentId: 'liquid_etf',
    taxMetadata: {
      sourceQualified: true,
      taxClass: PRODUCT_TAX_CLASSES.EQUITY_MF_112A,
      sourceReferences: metadata.sourceReferences,
    },
  };
  assert.equal(getProductTaxMetadata(copiedEvidence, 'liquid_etf').sourceQualified, false);
  assert.equal(getProductTaxMetadata({ name: 'Nifty 50 ETF', parentInstrumentId: 'nifty_etf' }, 'nifty_etf').sourceQualified, false);
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
