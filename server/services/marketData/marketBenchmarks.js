export const MARKET_BENCHMARKS = Object.freeze({
  NIFTY_50: Object.freeze({
    canonicalProductId: 'market:index:nifty-50',
    displayName: 'NIFTY 50',
    nseIndexName: 'NIFTY 50',
    upstoxInstrumentKey: 'NSE_INDEX|Nifty 50',
  }),
  INDIA_VIX: Object.freeze({
    canonicalProductId: 'market:index:india-vix',
    displayName: 'India VIX',
    nseIndexName: 'INDIA VIX',
    upstoxInstrumentKey: 'NSE_INDEX|India VIX',
  }),
});

export const DEFAULT_BENCHMARK_IDS = Object.freeze([
  MARKET_BENCHMARKS.NIFTY_50.canonicalProductId,
  MARKET_BENCHMARKS.INDIA_VIX.canonicalProductId,
]);

export function benchmarkByCanonicalId(canonicalProductId) {
  return Object.values(MARKET_BENCHMARKS).find(
    benchmark => benchmark.canonicalProductId === canonicalProductId,
  ) || null;
}

export function benchmarkByNseIndexName(indexName) {
  return Object.values(MARKET_BENCHMARKS).find(
    benchmark => benchmark.nseIndexName === indexName,
  ) || null;
}

export function benchmarkByUpstoxInstrumentKey(instrumentKey) {
  return Object.values(MARKET_BENCHMARKS).find(
    benchmark => benchmark.upstoxInstrumentKey === instrumentKey,
  ) || null;
}
