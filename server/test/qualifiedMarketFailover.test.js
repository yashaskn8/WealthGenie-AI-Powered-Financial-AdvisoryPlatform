import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketContextFeatures } from '../services/marketContextFeatureEngine.js';
import { fetchQualifiedMarketPair } from '../services/qualifiedMarketFailover.js';
import { MARKET_BENCHMARKS } from '../services/marketData/marketBenchmarks.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');

function quoteSnapshot(provider, { includeVix = true } = {}) {
  const facts = [
    {
      canonicalProductId: MARKET_BENCHMARKS.NIFTY_50.canonicalProductId,
      value: 160,
      availabilityStatus: 'AVAILABLE',
      observedAt: '2026-09-08T11:59:00.000Z',
      fetchedAt: NOW.toISOString(),
      dataClass: 'LIVE',
      freshness: { status: 'FRESH', ageSeconds: 60, maxAgeSeconds: 900 },
      source: { provider, instrumentId: 'NIFTY 50', url: `https://example.invalid/${provider}/quotes` },
      metrics: { previousClose: 159 },
    },
  ];
  if (includeVix) facts.push({
    canonicalProductId: MARKET_BENCHMARKS.INDIA_VIX.canonicalProductId,
    value: 14,
    availabilityStatus: 'AVAILABLE',
    observedAt: '2026-09-08T11:59:00.000Z',
    fetchedAt: NOW.toISOString(),
    dataClass: 'LIVE',
    freshness: { status: 'FRESH', ageSeconds: 60, maxAgeSeconds: 900 },
    source: { provider, instrumentId: 'INDIA VIX', url: `https://example.invalid/${provider}/quotes` },
    metrics: { previousClose: null },
  });
  return { provider, status: 'AVAILABLE', facts };
}

function historySnapshot(provider) {
  const start = Date.parse('2026-06-01T00:00:00.000Z');
  const candles = Array.from({ length: 60 }, (_, index) => {
    const close = 100 + index;
    return {
      timestamp: new Date(start + index * 86400000).toISOString(),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
    };
  });
  return {
    provider,
    status: 'AVAILABLE',
    fetchedAt: NOW.toISOString(),
    observedAt: candles.at(-1).timestamp,
    freshness: { status: 'FRESH', ageSeconds: 86400, maxAgeSeconds: 345600 },
    source: { provider, instrumentId: 'NIFTY 50', url: `https://example.invalid/${provider}/history` },
    candles,
  };
}

function provider(name, { quotes = quoteSnapshot(name), history = historySnapshot(name) } = {}) {
  return {
    name,
    fetchQuotes: async () => quotes,
    fetchHistory: async () => history,
  };
}

test('qualified preferred provider is used without invoking the secondary', async () => {
  let secondaryCalls = 0;
  const selected = await fetchQualifiedMarketPair({
    preferredProvider: 'NSE',
    providers: [provider('NSE'), {
      ...provider('UPSTOX'),
      fetchQuotes: async () => { secondaryCalls += 1; return quoteSnapshot('UPSTOX'); },
    }],
  });
  assert.equal(selected.providerSelection.selectedProvider, 'NSE');
  assert.deepEqual(selected.providerSelection.attemptedProviders, ['NSE']);
  assert.equal(selected.providerSelection.fallbackUsed, false);
  assert.equal(secondaryCalls, 0);
  assert.equal(selected.quoteSnapshot.provider, selected.historicalSnapshot.provider);
});

test('primary request failure falls back to one complete secondary provider pair', async () => {
  const selected = await fetchQualifiedMarketPair({
    preferredProvider: 'NSE',
    providers: [
      { name: 'NSE', fetchQuotes: async () => { throw new Error('network down'); }, fetchHistory: async () => { throw new Error('network down'); } },
      provider('UPSTOX'),
    ],
  });
  assert.equal(selected.providerSelection.selectedProvider, 'UPSTOX');
  assert.equal(selected.providerSelection.fallbackUsed, true);
  assert.deepEqual(selected.providerSelection.attemptedProviders, ['NSE', 'UPSTOX']);
  assert.deepEqual(selected.providerSelection.providerFailures[0].reasonCodes.sort(), [
    'MARKET_HISTORY_SOURCE_ERROR', 'MARKET_PROVIDER_IDENTITY_MISMATCH', 'MARKET_QUOTE_SOURCE_ERROR',
  ].sort());
  assert.equal(selected.quoteSnapshot.provider, 'UPSTOX');
  assert.equal(selected.historicalSnapshot.provider, 'UPSTOX');
});

test('incomplete primary semantic evidence is recorded before qualified secondary selection', async () => {
  const selected = await fetchQualifiedMarketPair({
    preferredProvider: 'NSE',
    providers: [provider('NSE', { quotes: quoteSnapshot('NSE', { includeVix: false }) }), provider('UPSTOX')],
  });
  assert.equal(selected.providerSelection.selectedProvider, 'UPSTOX');
  assert(selected.providerSelection.providerFailures[0].reasonCodes.includes('INDIA_VIX_UNAVAILABLE'));
  assert.equal(selected.quoteSnapshot.facts.every(fact => fact.source.provider === 'UPSTOX'), true);
  assert.equal(selected.historicalSnapshot.source.provider, 'UPSTOX');
});

test('all providers unavailable remains unavailable and reports attempts without invented values', async () => {
  const broken = name => ({
    provider: name,
    status: 'SOURCE_ERROR',
    facts: [],
    candles: [],
    error: { code: `${name}_FAILED` },
  });
  const selected = await fetchQualifiedMarketPair({
    preferredProvider: 'NSE',
    providers: ['NSE', 'UPSTOX'].map(name => provider(name, {
      quotes: broken(name),
      history: { ...broken(name), source: { provider: name } },
    })),
  });
  assert.equal(selected.providerSelection.selectedProvider, null);
  assert.deepEqual(selected.providerSelection.attemptedProviders, ['NSE', 'UPSTOX']);
  assert.equal(selected.quoteSnapshot.facts.length, 0);
  assert.equal(selected.historicalSnapshot.candles.length, 0);
});

test('all rejected provider identities cannot leak complete-looking facts into the market feature engine', async () => {
  const forgedProviderPair = name => {
    const quotes = quoteSnapshot(name);
    quotes.facts.forEach(fact => { fact.source.provider = 'UNEXPECTED_PROVIDER'; });
    const history = historySnapshot(name);
    history.source.provider = 'UNEXPECTED_PROVIDER';
    return provider(name, { quotes, history });
  };
  const selected = await fetchQualifiedMarketPair({
    preferredProvider: 'NSE',
    providers: [forgedProviderPair('NSE'), forgedProviderPair('UPSTOX')],
  });

  assert.equal(selected.providerSelection.selectedProvider, null);
  assert.deepEqual(selected.quoteSnapshot.facts, []);
  assert.deepEqual(selected.historicalSnapshot.candles, []);
  assert.equal(selected.quoteSnapshot.status, 'SOURCE_ERROR');
  assert.equal(selected.historicalSnapshot.status, 'SOURCE_ERROR');
  assert(selected.quoteSnapshot.reasonCodes.includes('MARKET_PROVIDER_IDENTITY_MISMATCH'));
  assert(selected.historicalSnapshot.reasonCodes.includes('MARKET_PROVIDER_IDENTITY_MISMATCH'));
  assert.equal(computeMarketContextFeatures(selected).status, 'FEATURES_UNAVAILABLE');
});

test('provider exception details are not copied into persisted/displayable market snapshots', async () => {
  const secretUrl = 'https://provider.example/quotes?access_token=do-not-copy';
  const selected = await fetchQualifiedMarketPair({
    preferredProvider: 'NSE',
    providers: [{
      name: 'NSE',
      fetchQuotes: async () => { throw new Error(secretUrl); },
      fetchHistory: async () => { throw new Error(secretUrl); },
    }],
  });

  assert.equal(selected.quoteSnapshot.error.message, 'Market quote provider request failed.');
  assert.equal(selected.historicalSnapshot.error.message, 'Market history provider request failed.');
  assert.equal(JSON.stringify(selected).includes('do-not-copy'), false);
});
