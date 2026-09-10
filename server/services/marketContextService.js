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
const MARKET_CONTEXT_LKG_CACHE_KEY = 'market:context:last-known-good:market-snapshot-1.0.0';
const MARKET_CONTEXT_LKG_TTL_SECONDS = 7 * 24 * 60 * 60;
const MARKET_CONTEXT_CLOSED_MAX_AGE_SECONDS = 36 * 60 * 60;
const MARKET_CONTEXT_OPEN_MAX_AGE_SECONDS = 15 * 60;

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
let processLastKnownGood = null;

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

function ageSeconds(timestamp, now) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
}

function cacheDescriptor(snapshot, now) {
  const cachedAt = snapshot?.cacheMetadata?.cachedAt ?? null;
  return {
    hit: snapshot?.cache?.hit === true,
    cachedAt,
    ageSeconds: cachedAt ? ageSeconds(cachedAt, now) : null,
  };
}

function recommendationUsabilityFor(marketSnapshot, now) {
  const displayStatus = marketSnapshot?.status;
  const policyAvailable = marketSnapshot?.policyOutput?.status === 'MARKET_CONTEXT_AVAILABLE'
    && marketSnapshot?.policyAvailability !== 'UNAVAILABLE';
  if (!policyAvailable) {
    return { status: 'NOT_USABLE', reasonCodes: ['MARKET_POLICY_UNAVAILABLE'] };
  }
  if (![MARKET_DISPLAY_STATUS.CURRENT, MARKET_DISPLAY_STATUS.MARKET_CLOSED, MARKET_DISPLAY_STATUS.LAST_AVAILABLE].includes(displayStatus)) {
    return { status: 'NOT_USABLE', reasonCodes: ['MARKET_SNAPSHOT_NOT_CURRENT_OR_LAST_AVAILABLE'] };
  }
  const observedAge = ageSeconds(marketSnapshot.observedAt, now);
  const maxAgeSeconds = marketSnapshot.marketSession?.status === 'MARKET_OPEN'
    ? MARKET_CONTEXT_OPEN_MAX_AGE_SECONDS
    : MARKET_CONTEXT_CLOSED_MAX_AGE_SECONDS;
  if (observedAge === null || observedAge > maxAgeSeconds) {
    return {
      status: 'NOT_USABLE',
      reasonCodes: ['MARKET_SNAPSHOT_OBSERVATION_TOO_OLD'],
      observedAgeSeconds: observedAge,
      maxAgeSeconds,
    };
  }
  return {
    status: 'USABLE',
    reasonCodes: [],
    observedAgeSeconds: observedAge,
    maxAgeSeconds,
  };
}

/**
 * Additive DTO for the frontend. Raw provider facts, deterministic derived
 * features, and policy output remain separate so presentation cannot mistake
 * a calculation or classification for an observed market value.
 */
export function buildMarketSnapshot({ quoteSnapshot, historicalSnapshot, features, policy, evaluatedAt, now = new Date(evaluatedAt || Date.now()) }) {
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
    policyAvailability: policy?.policyAvailability ?? features?.policyAvailability ?? 'UNAVAILABLE',
    dataCompleteness: features?.dataCompleteness ?? 'UNAVAILABLE',
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
    cache: {
      quotes: cacheDescriptor(quoteSnapshot, now),
      history: cacheDescriptor(historicalSnapshot, now),
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

async function readLastKnownGood(getLkg) {
  try {
    const cached = await getLkg(MARKET_CONTEXT_LKG_CACHE_KEY);
    if (cached?.marketContext?.marketSnapshot) {
      processLastKnownGood = cached;
      return { value: cached, storage: 'REDIS' };
    }
  } catch {
    // Last-known-good is an optimisation and must never make an unavailable
    // provider look current.
  }
  return { value: processLastKnownGood, storage: processLastKnownGood ? 'PROCESS_MEMORY' : 'NONE' };
}

async function writeLastKnownGood(value, setLkg) {
  processLastKnownGood = value;
  try {
    const persisted = await setLkg(MARKET_CONTEXT_LKG_CACHE_KEY, value, MARKET_CONTEXT_LKG_TTL_SECONDS);
    return persisted === true ? 'REDIS_WITH_PROCESS_FALLBACK' : 'PROCESS_MEMORY';
  } catch {
    return 'PROCESS_MEMORY';
  }
}

function recoverLastKnownGood(lastKnownGood, now, liveReasonCodes = []) {
  if (!lastKnownGood?.marketContext?.marketSnapshot) return null;
  const saved = lastKnownGood.marketContext;
  const savedSnapshot = saved.marketSnapshot;
  const observedAge = ageSeconds(savedSnapshot.observedAt, now);
  const recoveredStatus = observedAge !== null && observedAge <= MARKET_CONTEXT_CLOSED_MAX_AGE_SECONDS
    ? MARKET_DISPLAY_STATUS.LAST_AVAILABLE
    : MARKET_DISPLAY_STATUS.STALE;
  const marketSnapshot = {
    ...savedSnapshot,
    status: recoveredStatus,
    recoveredFromLastKnownGood: true,
    evaluatedAt: now.toISOString(),
    policyOutput: {
      ...savedSnapshot.policyOutput,
      reasonCodes: [...new Set([
        ...(savedSnapshot.policyOutput?.reasonCodes || []),
        ...liveReasonCodes,
        'LIVE_MARKET_CONTEXT_UNAVAILABLE_RECOVERED_LAST_KNOWN_GOOD',
      ])],
    },
  };
  const recommendationUsability = recommendationUsabilityFor(marketSnapshot, now);
  return {
    ...saved,
    evaluatedAt: now.toISOString(),
    reasonCodes: [...new Set([...(saved.reasonCodes || []), ...liveReasonCodes, 'RECOVERED_LAST_KNOWN_GOOD'])],
    marketSnapshot: { ...marketSnapshot, recommendationUsability },
    recommendationUsability,
    recoveredFromLastKnownGood: true,
    statePersistence: 'NOT_MUTATED_UNAVAILABLE_OBSERVATION',
  };
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
  const getLkg = dependencies.getLkgCache || getState;
  const setLkg = dependencies.setLkgCache || setState;
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
      now,
    });
    const currentEvidencePresent = availableFactCount(quoteSnapshot) > 0
      || (Array.isArray(historicalSnapshot?.candles) && historicalSnapshot.candles.length > 0);
    const recovered = currentEvidencePresent ? null : recoverLastKnownGood(
      await readLastKnownGood(getLkg).then(result => result.value),
      now,
      candidate.reasonCodes,
    );
    if (recovered) return recovered;
    const recommendationUsability = recommendationUsabilityFor(marketSnapshot, now);
    return {
      ...candidate,
      evaluatedAt,
      marketSnapshot: { ...marketSnapshot, recommendationUsability },
      recommendationUsability,
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
    now,
  });
  const recommendationUsability = recommendationUsabilityFor(marketSnapshot, now);
  const published = {
    ...transition.result,
    evaluatedAt,
    marketSnapshot: { ...marketSnapshot, recommendationUsability },
    recommendationUsability,
    statePersistence,
  };
  if (recommendationUsability.status === 'USABLE') {
    await writeLastKnownGood({
      schemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION,
      storedAt: evaluatedAt,
      marketContext: published,
    }, setLkg);
  }
  return published;
}

export function resetMarketContextProcessStateForTest() {
  processState = null;
  processLastKnownGood = null;
}

/**
 * Recommendation path read: returns only a previously qualified snapshot and
 * never calls NSE or another external provider. Freshness is recomputed from
 * observed time; Redis hot-cache age is only observability metadata.
 */
export async function getLatestQualifiedMarketContextForRecommendation(options = {}, dependencies = {}) {
  const getLkg = dependencies.getLkgCache || dependencies.getCache || getCache;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date.');
  const stored = await readLastKnownGood(getLkg);
  const recovered = recoverLastKnownGood(stored.value, now);
  if (!recovered) {
    return {
      status: 'MARKET_CONTEXT_UNAVAILABLE',
      context: null,
      policyVersion: MARKET_CONTEXT_POLICY_VERSION,
      reasonCodes: ['NO_LAST_KNOWN_GOOD_MARKET_CONTEXT'],
      evaluatedAt: now.toISOString(),
      recommendationUsability: { status: 'NOT_USABLE', reasonCodes: ['NO_LAST_KNOWN_GOOD_MARKET_CONTEXT'] },
      marketSnapshot: buildMarketSnapshot({
        quoteSnapshot: null,
        historicalSnapshot: null,
        features: null,
        policy: null,
        evaluatedAt: now.toISOString(),
        now,
      }),
    };
  }
  return recovered;
}

export {
  MARKET_CONTEXT_STATE_CACHE_KEY,
  MARKET_CONTEXT_STATE_TTL_SECONDS,
  MARKET_CONTEXT_LKG_CACHE_KEY,
  MARKET_CONTEXT_LKG_TTL_SECONDS,
};
