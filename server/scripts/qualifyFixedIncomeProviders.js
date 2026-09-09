import GovernmentSmallSavingsProvider from '../services/marketData/GovernmentSmallSavingsProvider.js';
import SbiTermDepositProvider from '../services/marketData/SbiTermDepositProvider.js';

function assertAvailableSnapshot(snapshot, expectedProvider, minimumProducts) {
  if (snapshot?.provider !== expectedProvider) throw new Error(`${expectedProvider}: unexpected provider identity`);
  if (snapshot?.status !== 'AVAILABLE') {
    throw new Error(`${expectedProvider}: ${snapshot?.error?.code || snapshot?.status || 'UNAVAILABLE'} ${snapshot?.error?.message || ''}`.trim());
  }
  if (!Array.isArray(snapshot.products) || snapshot.products.length < minimumProducts) {
    throw new Error(`${expectedProvider}: incomplete product universe`);
  }
  if (!Array.isArray(snapshot.facts) || snapshot.facts.length !== snapshot.products.length) {
    throw new Error(`${expectedProvider}: normalized product/fact count mismatch`);
  }
  for (const fact of snapshot.facts) {
    if (!Number.isFinite(fact.value) || !fact.source?.url || !fact.providerTimestamp || !fact.fetchedAt) {
      throw new Error(`${expectedProvider}: incomplete normalized fact`);
    }
  }
}

function summarizeGovernment(snapshot) {
  return snapshot.products.map(product => {
    const fact = snapshot.facts.find(candidate => candidate.canonicalProductId === product.canonicalProductId);
    return {
      scheme: product.name,
      ratePercentPerAnnum: fact.value,
      effectiveFrom: fact.effectiveFrom,
      effectiveTo: fact.effectiveTo,
      source: fact.source.url,
      fetchedAt: fact.fetchedAt,
      freshness: fact.freshness.status,
    };
  });
}

function summarizeDeposits(snapshot) {
  return snapshot.products.map(product => {
    const fact = snapshot.facts.find(candidate => candidate.canonicalProductId === product.canonicalProductId);
    return {
      bank: product.providerName,
      tenure: product.tenureLabel,
      depositorType: product.depositorType,
      ratePercentPerAnnum: fact.value,
      effectiveFrom: fact.effectiveFrom,
      publicationDate: fact.publicationDate,
      source: fact.source.url,
      fetchedAt: fact.fetchedAt,
      freshness: fact.freshness.status,
    };
  });
}

const government = await new GovernmentSmallSavingsProvider().getSnapshot({ forceRefresh: true });
assertAvailableSnapshot(government, 'GOVERNMENT_OF_INDIA', 10);

const deposits = await new SbiTermDepositProvider().getSnapshot({ forceRefresh: true });
assertAvailableSnapshot(deposits, 'SBI', 16);

console.log(JSON.stringify({
  qualification: 'PASS',
  government: {
    provider: government.provider,
    dataClass: government.dataClass,
    products: summarizeGovernment(government),
  },
  fixedDeposits: {
    provider: deposits.provider,
    dataClass: deposits.dataClass,
    products: summarizeDeposits(deposits),
  },
}, null, 2));
