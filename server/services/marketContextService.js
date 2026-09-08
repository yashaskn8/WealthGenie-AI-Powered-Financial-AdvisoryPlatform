import { getCache, setCache } from '../config/redis.js';
import {
  fetchBenchmarkQuotes,
  fetchNiftyHistoricalCandles,
} from './marketDataService.js';
import { AVAILABILITY } from './marketData/contracts.js';
import { computeMarketContextFeatures } from './marketContextFeatureEngine.js';
import {
  MARKET_CONTEXT_POLICY_VERSION,
  applyMarketContextHysteresis,
  classifyDeterministicMarketContext,
} from './marketContextPolicy.js';

const MARKET_CONTEXT_STATE_CACHE_KEY = `market:context:state:${MARKET_CONTEXT_POLICY_VERSION}`;
const MARKET_CONTEXT_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

let processState = null;

function sourceFailureSnapshot(code, message) {
  return {
    status: AVAILABILITY.SOURCE_ERROR,
    facts: [],
    candles: [],
    fetchedAt: new Date().toISOString(),
    freshness: null,
    error: { code, message },
  };
}

async function readState(getState) {
  try {
    const cached = await getState(MARKET_CONTEXT_STATE_CACHE_KEY);
    if (cached && typeof cached === 'object') {
      processState = cached;
      return { state: cached, storage: 'REDIS' };
    }
  } catch {
    // Redis is an optimisation. Process state preserves bounded hysteresis
    // continuity for this instance when the cache is unavailable.
  }
  return { state: processState, storage: processState ? 'PROCESS_MEMORY' : 'NONE' };
}

async function writeState(state, setState) {
  processState = state;
  try {
    const persisted = await setState(MARKET_CONTEXT_STATE_CACHE_KEY, state, MARKET_CONTEXT_STATE_TTL_SECONDS);
    return persisted === true ? 'REDIS_WITH_PROCESS_FALLBACK' : 'PROCESS_MEMORY';
  } catch {
    return 'PROCESS_MEMORY';
  }
}

/**
 * Builds the sole authoritative market-context response from verified Upstox
 * observations. Missing, stale, malformed, or failed data never receives a
 * numeric or classification fallback and never mutates hysteresis state.
 */
export async function getLiveMarketContext(options = {}, dependencies = {}) {
  const fetchQuotes = dependencies.fetchBenchmarkQuotes || fetchBenchmarkQuotes;
  const fetchHistory = dependencies.fetchNiftyHistoricalCandles || fetchNiftyHistoricalCandles;
  const getState = dependencies.getCache || getCache;
  const setState = dependencies.setCache || setCache;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date.');

  const [quoteResult, historyResult] = await Promise.allSettled([
    fetchQuotes({ forceRefresh: options.forceQuoteRefresh === true, persist: true }),
    fetchHistory({ forceRefresh: options.forceHistoryRefresh === true, now }),
  ]);
  const quoteSnapshot = quoteResult.status === 'fulfilled'
    ? quoteResult.value
    : sourceFailureSnapshot('UPSTOX_QUOTE_REQUEST_FAILED', quoteResult.reason?.message || 'Quote request failed.');
  const historicalSnapshot = historyResult.status === 'fulfilled'
    ? historyResult.value
    : sourceFailureSnapshot('UPSTOX_HISTORY_REQUEST_FAILED', historyResult.reason?.message || 'History request failed.');

  const features = computeMarketContextFeatures({ quoteSnapshot, historicalSnapshot });
  const candidate = classifyDeterministicMarketContext(features);
  const evaluatedAt = now.toISOString();
  if (candidate.status !== 'MARKET_CONTEXT_AVAILABLE') {
    return {
      ...candidate,
      evaluatedAt,
      candidateContext: null,
      hysteresis: { status: 'NOT_APPLIED_MARKET_CONTEXT_UNAVAILABLE' },
      statePersistence: 'NOT_WRITTEN_UNAVAILABLE_OBSERVATION',
    };
  }

  const prior = await readState(getState);
  const transition = applyMarketContextHysteresis(candidate, prior.state, now);
  const statePersistence = transition.changed
    ? await writeState(transition.state, setState)
    : prior.storage;
  return {
    ...transition.result,
    evaluatedAt,
    statePersistence,
  };
}

export function resetMarketContextProcessStateForTest() {
  processState = null;
}

export {
  MARKET_CONTEXT_STATE_CACHE_KEY,
  MARKET_CONTEXT_STATE_TTL_SECONDS,
};
