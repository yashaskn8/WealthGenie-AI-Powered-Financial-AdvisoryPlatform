import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseIndiaPostSavingsBundle,
} from '../services/marketData/GovernmentSmallSavingsProvider.js';
import { parseSbiRetailTermDepositPage } from '../services/marketData/SbiTermDepositProvider.js';
import {
  compareVerifiedFixedIncomeProducts,
  selectCurrentEffectiveFact,
} from '../services/fixedIncomeProductRanking.js';
import { buildObservationOperations } from '../services/marketData/MarketDataRepository.js';
import { rankWhereToInvestBackend } from '../services/RecommendationPipeline.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const ROWS = [
  { slNo: '01.', instrument: 'Post Office Savings Account', interestRate: '4.0%', compoundingFrequency: 'Annually' },
  { slNo: '02.', instrument: '1 Year Time Deposit', interestRate: '6.9%', compoundingFrequency: 'Quarterly' },
  { slNo: '03.', instrument: '2 Year Time Deposit', interestRate: '7.0%', compoundingFrequency: 'Quarterly' },
  { slNo: '04.', instrument: '3 Year Time Deposit', interestRate: '7.1%', compoundingFrequency: 'Quarterly' },
  { slNo: '05.', instrument: '5 Year Time Deposit', interestRate: '7.5%', compoundingFrequency: 'Quarterly' },
  { slNo: '06.', instrument: '5 Year Recurring Deposit Scheme', interestRate: '6.7%', compoundingFrequency: 'Quarterly' },
  { slNo: '07.', instrument: 'Senior Citizen Savings Scheme', interestRate: '8.2%', compoundingFrequency: 'Quarterly and Paid' },
  { slNo: '08.', instrument: 'Monthly Income Account', interestRate: '7.4%', compoundingFrequency: 'Monthly and paid' },
  { slNo: '09.', instrument: 'National Savings Certificate (VIII Issue)', interestRate: '7.7%', compoundingFrequency: 'Annually' },
  { slNo: '10.', instrument: 'Public Provident Fund Scheme', interestRate: '7.1%', compoundingFrequency: 'Annually' },
  { slNo: '11.', instrument: 'Kisan Vikas Patra', interestRate: '7.5%', compoundingFrequency: 'Annually' },
  { slNo: '13.', instrument: 'Sukanya Samriddhi Account Scheme', interestRate: '8.2%', compoundingFrequency: 'Annually' },
];

function governmentBundle(from = '01.07.2026', to = '30.09.2026', rows = ROWS) {
  return `const w=JSON.parse('${JSON.stringify(rows)}'),S=()=>"Post Office Small Savings Schemes (w.e.f ${from} to ${to})";`;
}

const SBI_TENURES = [
  ['7 days to 45 days', '3.05', '3.05', '3.55', '3.55'],
  ['46 days to 179 days', '4.90', '4.90', '5.40', '5.40'],
  ['180 days to 210 days', '5.65', '5.65', '6.15', '6.15'],
  ['211 days to less than 1 year', '5.90', '5.90', '6.40', '6.40'],
  ['1 Year to less than 2 years', '6.25', '6.25', '6.75', '6.75'],
  ['2 years to less than 3 years', '6.45', '6.40', '6.95', '6.90'],
  ['3 years to less than 5 years', '6.30', '6.30', '6.80', '6.80'],
  ['5 years and up to 10 years', '6.05', '6.05', '7.05', '7.05'],
];

function sbiPage(rows = SBI_TENURES) {
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<html><table><tr><th>Tenors</th><th>Existing Rates for Public w.e.f. 15/07/2025</th><th>Revised Rates for Public w.e.f.15/12/2025</th><th>Existing Rates for Senior Citizen w.e.f. 15/07/2025</th><th>Revised Rates for Senior Citizen w.e.f. 15/12/2025</th></tr>${body}</table><p>Last Updated On : Tuesday, 16-06-2026 Interest Rates Quick Links</p></html>`;
}

test('official India Post parser preserves rate semantics and effective interval', () => {
  const snapshot = parseIndiaPostSavingsBundle(governmentBundle(), {
    fetchedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(snapshot.status, 'AVAILABLE');
  assert.equal(snapshot.dataClass, 'QUARTERLY_OFFICIAL_RATE');
  assert.equal(snapshot.effectiveFrom, '2026-07-01');
  assert.equal(snapshot.effectiveTo, '2026-09-30');
  const ppf = snapshot.facts.find(fact => fact.canonicalProductId.endsWith(':ppf'));
  assert.equal(ppf.value, 7.1);
  assert.equal(ppf.unit, 'PERCENT_PER_ANNUM');
  assert.equal(ppf.compoundingBasis, 'Annually');
  assert.equal(ppf.freshness.status, 'FRESH');
  assert.equal(ppf.source.provider, 'GOVERNMENT_OF_INDIA');
});

test('multiple official intervals remain distinct and latest current fact is selected', () => {
  const prior = parseIndiaPostSavingsBundle(governmentBundle('01.04.2026', '30.06.2026'), {
    fetchedAt: '2026-06-01T00:00:00.000Z', now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const current = parseIndiaPostSavingsBundle(governmentBundle(), {
    fetchedAt: NOW.toISOString(), now: NOW,
  });
  const id = 'government:india-post:ppf';
  const selected = selectCurrentEffectiveFact([...prior.facts, ...current.facts], id);
  assert.equal(selected.effectiveFrom, '2026-07-01');
  assert.equal(buildObservationOperations(prior).length, ROWS.length);
  assert.equal(buildObservationOperations(current).length, ROWS.length);
});

test('stale or missing government source facts never become recommendations', () => {
  const stale = parseIndiaPostSavingsBundle(governmentBundle('01.04.2026', '30.06.2026'), {
    fetchedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(stale.facts[0].freshness.status, 'STALE');
  const result = compareVerifiedFixedIncomeProducts({
    parentInstrumentId: 'ppf', snapshot: stale, profile: canonicalProfile(),
  });
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.ranking.reasonCodes, ['CURRENT_EFFECTIVE_SCHEME_RATE_UNAVAILABLE']);
  assert.throws(
    () => parseIndiaPostSavingsBundle(governmentBundle(undefined, undefined, ROWS.slice(0, -1)), { now: NOW }),
    /incomplete_rate_table/,
  );
  assert.throws(() => parseIndiaPostSavingsBundle('not the official schema', { now: NOW }), /effective_interval/);
});

test('SBI parser uses only revised official columns and preserves depositor and tenure classes', () => {
  const snapshot = parseSbiRetailTermDepositPage(sbiPage(), {
    fetchedAt: NOW.toISOString(), now: NOW,
  });
  assert.equal(snapshot.status, 'AVAILABLE');
  assert.equal(snapshot.productCount, 16);
  assert.equal(snapshot.publicationDate, '2026-06-16');
  const publicTwoYear = snapshot.products.find(product => product.canonicalProductId.includes('2y-lt3y:public'));
  const seniorTwoYear = snapshot.products.find(product => product.canonicalProductId.includes('2y-lt3y:senior'));
  assert.equal(snapshot.facts.find(fact => fact.canonicalProductId === publicTwoYear.canonicalProductId).value, 6.4);
  assert.equal(snapshot.facts.find(fact => fact.canonicalProductId === seniorTwoYear.canonicalProductId).value, 6.9);
  assert.equal(publicTwoYear.depositorType, 'GENERAL_PUBLIC');
  assert.equal(publicTwoYear.depositType, 'RETAIL_DOMESTIC_TERM_DEPOSIT_BELOW_INR_3_CRORE');
  assert.equal(publicTwoYear.riskQuality, null);
});

test('FD comparison never crosses tenure/depositor classes or pads to five', () => {
  const snapshot = parseSbiRetailTermDepositPage(sbiPage(), {
    fetchedAt: NOW.toISOString(), now: NOW,
  });
  const result = compareVerifiedFixedIncomeProducts({
    parentInstrumentId: 'fd', snapshot, profile: canonicalProfile({ age: 35, investmentHorizonYears: 2 }),
  });
  assert.equal(result.products.length, 1);
  assert.equal(result.ranking.status, 'VERIFIED_COMPARABLE_OPTIONS');
  assert.equal(result.ranking.hasUniqueLeader, false);
  assert.equal(result.products[0].depositorType, 'GENERAL_PUBLIC');
  assert.equal(result.products[0].tenure.label, '2 years to less than 3 years');
  assert.equal(result.products[0].officialRate.value, 6.4);
  assert.equal(result.products[0].expectedReturn, null);
  assert.equal(result.products[0].riskQuality, null);
});

test('SBI missing tenure and schema drift fail closed without static rates', () => {
  assert.throws(() => parseSbiRetailTermDepositPage(sbiPage(SBI_TENURES.slice(0, -1)), {
    fetchedAt: NOW.toISOString(), now: NOW,
  }), /tenure_rows/);
  assert.throws(() => parseSbiRetailTermDepositPage('<html>changed</html>'), /rate_header/);
});

test('WTI runs the hard suitability gate before official fixed-income provider access', async () => {
  let calls = 0;
  const rejected = await rankWhereToInvestBackend(
    canonicalProfile({ investmentHorizonYears: 1 }),
    { parentInstrumentId: 'ppf' },
    { fetchGovernmentSavingsSnapshot: async () => { calls += 1; return null; } },
  );
  assert.equal(rejected.length, 0);
  assert.equal(rejected.metadata.excluded[0].reasonCode, 'HORIZON_BELOW_MINIMUM');
  assert.equal(calls, 0);

  const snapshot = parseIndiaPostSavingsBundle(governmentBundle(), {
    fetchedAt: NOW.toISOString(), now: NOW,
  });
  const accepted = await rankWhereToInvestBackend(
    canonicalProfile({ investmentHorizonYears: 15 }),
    { parentInstrumentId: 'ppf' },
    { fetchGovernmentSavingsSnapshot: async () => { calls += 1; return snapshot; } },
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].officialRate.value, 7.1);
  assert.equal(accepted[0].expectedReturn, null);
  assert.equal(calls, 1);
});
