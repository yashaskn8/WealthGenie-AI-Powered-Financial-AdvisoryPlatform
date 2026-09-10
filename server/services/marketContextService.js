import { getCache, setCache } from '../config/redis.js';
import {
  fetchBenchmarkQuotes,
  fetchNiftyHistoricalCandles,
} from './marketDataService.js';
import {
  AVAILABILITY,
  FRESHNESS,
  MARKET_FACT_SEMANTIC_CLASSES,
} from './marketData/contracts.js';
import { computeMarketContextFeatures } from './marketContextFeatureEngine.js';
import {
  MARKET_CONTEXT_POLICY_VERSION,
  applyMarketContextHysteresis,
  classifyDeterministicMarketContext,
} from './marketContextPolicy.js';

const MARKET_CONTEXT_STATE_CACHE_KEY = `market:context:state:${MARKET_CONTEXT_POLICY_VERSION}`;
const MARKET_CONTEXT_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const MARKET_SNAPSHOT_SCHEMA_VERSION = 'market-snapshot-1.0.0';
export const MARKET_DISPLAY_STATUS = Object.freeze({
  CURRENT: 'CURRENT',
  MARKET_CLOSED: 'MARKET_CLOSED',
  LAST_AVAILABLE: 'LAST_AVAILABLE',
  STALE: 'STALE',
  PARTIAL_DATA: 'PARTIAL_DATA',
  UNAVAILABLE: 'UNAVAILABLE',
});

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

function availableFactCount(snapshot) {
  return (snapshot?.facts || []).filter(fact => (
    fact?.availabilityStatus === AVAILABILITY.AVAILABLE && Number.isFinite(fact.value)
  )).length;
}

function hasStaleEvidence(quoteSnapshot, historicalSnapshot) {
  return [
    ...(quoteSnapshot?.facts || []).map(fact => fact?.freshness?.status),
    historicalSnapshot?.freshness?.status,
  ].includes(FRESHNESS.STALE);
}

function displayStatusFor({ quoteSnapshot, historicalSnapshot, features }) {
  const availableQuotes = availableFactCount(quoteSnapshot);
  const availableHistory = historicalSnapshot?.status === AVAILABILITY.AVAILABLE
    && Array.isArray(historicalSnapshot?.candles)
    && historicalSnapshot.candles.length > 0;
  const anyAvailable = availableQuotes > 0 || availableHistory;
  if (features?.status !== 'FEATURES_AVAILABLE') {
    if (hasStaleEvidence(quoteSnapshot, historicalSnapshot)) return MARKET_DISPLAY_STATUS.STALE;
    return anyAvailable ? MARKET_DISPLAY_STATUS.PARTIAL_DATA : MARKET_DISPLAY_STATUS.UNAVAILABLE;
  }

  const session = quoteSnapshot?.marketSession?.status
    || quoteSnapshot?.facts?.find(fact => fact?.freshness?.marketSession)?.freshness?.marketSession;
  if (session === 'MARKET_OPEN') return MARKET_DISPLAY_STATUS.CURRENT;
  if (session === 'MARKET_CLOSED' || session === 'MARKET_HOLIDAY') return MARKET_DISPLAY_STATUS.MARKET_CLOSED;
  return MARKET_DISPLAY_STATUS.LAST_AVAILABLE;
}

/**
 * Additive DTO for the frontend. Raw provider facts, deterministic derived
 * features, and policy output remain separate so presentation cannot mistake
 * a calculation or classification for an observed market value.
 */
export function buildMarketSnapshot({ quoteSnapshot, historicalSnapshot, features, policy, evaluatedAt }) {
  const displayStatus = displayStatusFor({ quoteSnapshot, historicalSnapshot, features });
  const policyOutput = {
    semanticClass: MARKET_FACT_SEMANTIC_CLASSES.POLICY_OUTPUT,
    dataClass: MARKET_FACT_SEMANTIC_CLASSES.POLICY_OUTPUT,
    status: policy?.status ?? 'MARKET_CONTEXT_UNAVAILABLE',
    context: policy?.context ?? null,
    classification: policy?.classification ?? null,
    policyVersion: policy?.policyVersion ?? null,
    reasonCodes: policy?.reasonCodes ?? [],
    observedAt: policy?.observedAt ?? null,
    evaluatedAt: evaluatedAt ?? null,
  };
  return {
    schemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
    status: displayStatus,
    availability: features?.status === 'FEATURES_AVAILABLE'
      ? AVAILABILITY.AVAILABLE
      : (displayStatus === MARKET_DISPLAY_STATUS.PARTIAL_DATA || displayStatus === MARKET_DISPLAY_STATUS.STALE)
        ? AVAILABILITY.PARTIAL
        : AVAILABILITY.UNAVAILABLE,
    providerStatus: features?.providerStatus ?? {
      quotes: { provider: quoteSnapshot?.provider ?? null, status: quoteSnapshot?.status ?? AVAILABILITY.UNAVAILABLE },
      history: { provider: historicalSnapshot?.provider ?? null, status: historicalSnapshot?.status ?? AVAILABILITY.UNAVAILABLE },
    },
    observedFacts: features?.observedFacts ?? [],
    derivedFacts: features?.derivedFacts ?? [],
    policyOutput,
    freshness: features?.freshness ?? null,
    provenance: {
      sources: policy?.sources ?? features?.sources ?? [],
      qualification: quoteSnapshot?.qualification ?? null,
    },
    observedAt: policy?.observedAt ?? features?.observedAt ?? null,
    evaluatedAt: evaluatedAt ?? null,
    marketSession: quoteSnapshot?.marketSession ?? {
      status: 'UNKNOWN',
      tradingDate: null,
      checkedAt: evaluatedAt ?? null,
    },
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
 * Builds the sole authoritative market-context response from verified normalized
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
    : sourceFailureSnapshot('MARKET_QUOTE_REQUEST_FAILED', quoteResult.reason?.message || 'Quote request failed.');
  const historicalSnapshot = historyResult.status === 'fulfilled'
    ? historyResult.value
    : sourceFailureSnapshot('MARKET_HISTORY_REQUEST_FAILED', historyResult.reason?.message || 'History request failed.');

  const features = computeMarketContextFeatures({ quoteSnapshot, historicalSnapshot });
  const candidate = classifyDeterministicMarketContext(features);
  const evaluatedAt = now.toISOString();
  if (candidate.status !== 'MARKET_CONTEXT_AVAILABLE') {
    const marketSnapshot = buildMarketSnapshot({
      quoteSnapshot,
      historicalSnapshot,
      features,
      policy: candidate,
      evaluatedAt,
    });
    return {
      ...candidate,
      evaluatedAt,
      marketSnapshot,
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
  const marketSnapshot = buildMarketSnapshot({
    quoteSnapshot,
    historicalSnapshot,
    features,
    policy: transition.result,
    evaluatedAt,
  });
  return {
    ...transition.result,
    evaluatedAt,
    marketSnapshot,
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
