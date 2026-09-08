import crypto from 'node:crypto';
import { AVAILABILITY, MARKET_DATA_SCHEMA_VERSION, PROVIDERS } from './contracts.js';
import { MARKET_BENCHMARKS } from './marketBenchmarks.js';

export const MARKET_REGIME_DATASET_SCHEMA_VERSION = 'market-regime-dataset-1.0.0';

function requireAvailableSnapshot(snapshot, benchmark) {
  if (snapshot?.status !== AVAILABILITY.AVAILABLE || !Array.isArray(snapshot.candles)) {
    throw new Error(`${benchmark.displayName} normalized history is unavailable.`);
  }
  if (snapshot.provider !== PROVIDERS.NSE
      || snapshot.instrumentKey !== benchmark.canonicalProductId
      || snapshot.source?.instrumentId !== benchmark.nseIndexName) {
    throw new Error(`${benchmark.displayName} history does not match the qualified NSE identity.`);
  }
}

function normalizedLeg(candle) {
  return {
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    observedAt: candle.timestamp,
  };
}

/**
 * Joins two already-normalized NSE histories without forward filling or
 * inventing observations. The resulting rows are the sole Phase-4 dataset
 * boundary consumed by the ML service.
 */
export function buildMarketRegimeDataset({ niftySnapshot, vixSnapshot, retrievedAt }) {
  requireAvailableSnapshot(niftySnapshot, MARKET_BENCHMARKS.NIFTY_50);
  requireAvailableSnapshot(vixSnapshot, MARKET_BENCHMARKS.INDIA_VIX);
  const normalizedRetrievedAt = new Date(retrievedAt);
  if (Number.isNaN(normalizedRetrievedAt.getTime())) {
    throw new TypeError('retrievedAt must be a valid timestamp.');
  }

  const niftyByDate = new Map(niftySnapshot.candles.map(candle => [candle.effectiveTradingDate, candle]));
  const vixByDate = new Map(vixSnapshot.candles.map(candle => [candle.effectiveTradingDate, candle]));
  const commonDates = [...niftyByDate.keys()]
    .filter(date => vixByDate.has(date))
    .sort();
  if (!commonDates.length) throw new Error('NIFTY 50 and India VIX histories have no common trading sessions.');

  const rows = commonDates.map(effectiveTradingDate => ({
    effectiveTradingDate,
    nifty50: normalizedLeg(niftyByDate.get(effectiveTradingDate)),
    indiaVix: normalizedLeg(vixByDate.get(effectiveTradingDate)),
  }));
  const hashInput = {
    schemaVersion: MARKET_REGIME_DATASET_SCHEMA_VERSION,
    marketDataSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    source: PROVIDERS.NSE,
    rows,
  };
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');

  return {
    schemaVersion: MARKET_REGIME_DATASET_SCHEMA_VERSION,
    marketDataSchemaVersion: MARKET_DATA_SCHEMA_VERSION,
    datasetVersion: `${MARKET_REGIME_DATASET_SCHEMA_VERSION}+sha256:${contentHash.slice(0, 16)}`,
    contentHash,
    retrievedAt: normalizedRetrievedAt.toISOString(),
    period: {
      start: commonDates[0],
      end: commonDates.at(-1),
    },
    rowCount: rows.length,
    missingObservations: {
      nifty50WithoutIndiaVix: niftySnapshot.candles.length - commonDates.length,
      indiaVixWithoutNifty50: vixSnapshot.candles.length - commonDates.length,
      policy: 'INNER_JOIN_NO_IMPUTATION_NO_FORWARD_FILL',
    },
    source: {
      provider: PROVIDERS.NSE,
      qualification: niftySnapshot.qualification,
      dataClass: niftySnapshot.dataClass,
      instruments: [
        {
          canonicalProductId: MARKET_BENCHMARKS.NIFTY_50.canonicalProductId,
          sourceInstrumentId: MARKET_BENCHMARKS.NIFTY_50.nseIndexName,
          sourceUrl: niftySnapshot.source.url,
        },
        {
          canonicalProductId: MARKET_BENCHMARKS.INDIA_VIX.canonicalProductId,
          sourceInstrumentId: MARKET_BENCHMARKS.INDIA_VIX.nseIndexName,
          sourceUrl: vixSnapshot.source.url,
        },
      ],
    },
    rows,
  };
}
