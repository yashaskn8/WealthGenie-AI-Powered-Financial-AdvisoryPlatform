import {
  assertPortfolioSuitable,
  resolveConcentrationCap,
} from './RecommendationPipeline.js';
import { buildRecommendationProfile } from './recommendationProfile.js';

export const MARKET_CONTEXT_ADJUSTMENT_VERSION = 'market-context-adjustment-1.0.0';

export const MARKET_CONTEXT_MAX_TOTAL_TILT_PCT = Object.freeze({
  NORMAL: 0,
  CAUTIOUS: 2,
  HIGH_VOLATILITY: 4,
  RISK_OFF: 5,
});

function validateAuthoritativeInstruments(instruments) {
  if (!Array.isArray(instruments) || instruments.length === 0) {
    throw new TypeError('An authoritative recommendation with instruments is required.');
  }
  const ids = instruments.map(item => String(item?.id || '').trim());
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new TypeError('Authoritative recommendation instrument ids must be non-empty and unique.');
  }
  const weights = instruments.map(item => Number(item?.allocationWeight));
  if (weights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1)) {
    throw new TypeError('Authoritative recommendation weights must be finite values from 0 to 1.');
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw new RangeError('Authoritative recommendation weights must sum to 1.');
  }
  if (instruments.some(item => !Number.isFinite(Number(item?.riskScore))
      || Number(item.riskScore) < 1 || Number(item.riskScore) > 5)) {
    throw new TypeError('Every authoritative recommendation instrument requires an established riskScore from 1 to 5.');
  }
}

function normalizedAllocations(instruments, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) throw new RangeError('Adjusted allocation has no positive total.');
  const normalized = weights.map(weight => weight / total);
  return instruments.map((item, index) => ({
    ...item,
    allocationWeight: Number(normalized[index].toFixed(8)),
    allocation_pct: Number((normalized[index] * 100).toFixed(6)),
  }));
}

function groupedWeight(instruments, weights, capKey, capResolver) {
  return instruments.reduce((sum, item, index) => {
    const cap = capResolver(item);
    return cap?.key === capKey ? sum + weights[index] : sum;
  }, 0);
}

function assertConcentrationCaps(instruments, weights, capResolver) {
  const checked = new Set();
  instruments.forEach((item) => {
    const cap = capResolver(item);
    if (!cap || checked.has(cap.key)) return;
    checked.add(cap.key);
    const totalPct = groupedWeight(instruments, weights, cap.key, capResolver) * 100;
    if (totalPct > cap.maxPct + 0.001) {
      const error = new Error(`Adjusted allocation exceeds the ${cap.key} concentration cap.`);
      error.code = 'MARKET_CONTEXT_CONCENTRATION_CAP_VIOLATION';
      throw error;
    }
  });
}

function unchangedResult(instruments, marketContext, reasonCode) {
  const weights = Object.fromEntries(instruments.map(item => [item.id, Number(item.allocationWeight)]));
  return {
    classification: 'PROFILE_SAFE_MARKET_CONTEXT_ADJUSTMENT',
    adjustmentVersion: MARKET_CONTEXT_ADJUSTMENT_VERSION,
    context: marketContext?.context ?? null,
    contextStatus: marketContext?.status ?? 'MARKET_CONTEXT_UNAVAILABLE',
    applied: false,
    maxTotalTiltPct: marketContext?.context
      ? MARKET_CONTEXT_MAX_TOTAL_TILT_PCT[marketContext.context] ?? 0
      : 0,
    actualTotalTiltPct: 0,
    baseWeights: weights,
    adjustedWeights: weights,
    adjustedInstruments: instruments.map(item => ({ ...item })),
    introducedInstrumentIds: [],
    reasonCodes: [reasonCode],
    explanations: [],
    suitabilityRevalidated: true,
    concentrationCapsRevalidated: true,
  };
}

/**
 * Applies a small, deterministic risk-reducing transfer to the server-owned
 * recommendation. It cannot add instruments, increase the highest-risk sleeve,
 * or cross suitability/concentration boundaries.
 */
export function applyProfileSafeMarketContextAdjustment({
  profile,
  instruments,
  marketContext,
}, dependencies = {}) {
  const validateSuitability = dependencies.assertPortfolioSuitable || assertPortfolioSuitable;
  const capResolver = dependencies.resolveConcentrationCap || resolveConcentrationCap;
  const canonicalProfile = buildRecommendationProfile(profile);
  validateAuthoritativeInstruments(instruments);
  const ids = instruments.map(item => item.id);
  const suitability = validateSuitability(canonicalProfile, ids);
  if (instruments.some(item => Number(item.riskScore) > Number(suitability.finalLevel))) {
    const error = new Error('Authoritative recommendation exceeds the profile suitability risk ceiling.');
    error.code = 'MARKET_CONTEXT_RISK_CEILING_VIOLATION';
    throw error;
  }
  const baseWeightsArray = instruments.map(item => Number(item.allocationWeight));
  assertConcentrationCaps(instruments, baseWeightsArray, capResolver);

  if (marketContext?.status !== 'MARKET_CONTEXT_AVAILABLE' || !marketContext.context) {
    return unchangedResult(instruments, marketContext, 'MARKET_CONTEXT_UNAVAILABLE_NO_ADJUSTMENT');
  }
  const maxTotalTiltPct = MARKET_CONTEXT_MAX_TOTAL_TILT_PCT[marketContext.context];
  if (!Number.isFinite(maxTotalTiltPct)) {
    throw new TypeError(`Unsupported market context: ${marketContext.context}`);
  }
  if (maxTotalTiltPct === 0) {
    return unchangedResult(instruments, marketContext, 'NORMAL_CONTEXT_NO_TACTICAL_ADJUSTMENT');
  }

  const minimumRisk = Math.min(...instruments.map(item => Number(item.riskScore)));
  const recipientIndexes = instruments
    .map((item, index) => ({ index, risk: Number(item.riskScore), id: String(item.id) }))
    .filter(item => item.risk === minimumRisk)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(item => item.index);
  const donorIndexes = instruments
    .map((item, index) => ({ index, risk: Number(item.riskScore), id: String(item.id) }))
    .filter(item => item.risk > minimumRisk && baseWeightsArray[item.index] > 0)
    .sort((left, right) => right.risk - left.risk || left.id.localeCompare(right.id))
    .map(item => item.index);
  if (!recipientIndexes.length || !donorIndexes.length) {
    return unchangedResult(instruments, marketContext, 'NO_LOWER_RISK_ELIGIBLE_TRANSFER_PATH');
  }

  const targetTransfer = maxTotalTiltPct / 100;
  const adjusted = [...baseWeightsArray];
  const removedByDonor = new Map();
  let remainingRemoval = targetTransfer;
  donorIndexes.forEach((index) => {
    if (remainingRemoval <= 1e-12) return;
    const removed = Math.min(adjusted[index], remainingRemoval);
    adjusted[index] -= removed;
    removedByDonor.set(index, removed);
    remainingRemoval -= removed;
  });
  const removedTotal = targetTransfer - remainingRemoval;

  let remainingAllocation = removedTotal;
  const addedByRecipient = new Map();
  recipientIndexes.forEach((index) => {
    if (remainingAllocation <= 1e-12) return;
    const cap = capResolver(instruments[index]);
    const groupRoom = cap
      ? Math.max(0, (cap.maxPct / 100) - groupedWeight(instruments, adjusted, cap.key, capResolver))
      : Number.POSITIVE_INFINITY;
    const individualRoom = Math.max(0, 1 - adjusted[index]);
    const added = Math.min(remainingAllocation, groupRoom, individualRoom);
    adjusted[index] += added;
    addedByRecipient.set(index, added);
    remainingAllocation -= added;
  });

  if (remainingAllocation > 1e-12) {
    [...removedByDonor.entries()].reverse().forEach(([index, removed]) => {
      if (remainingAllocation <= 1e-12) return;
      const restored = Math.min(removed, remainingAllocation);
      adjusted[index] += restored;
      removedByDonor.set(index, removed - restored);
      remainingAllocation -= restored;
    });
  }
  const actualTransfer = [...addedByRecipient.values()].reduce((sum, value) => sum + value, 0);
  if (actualTransfer <= 1e-12) {
    return unchangedResult(instruments, marketContext, 'CONCENTRATION_CAPS_PREVENT_LOWER_RISK_TRANSFER');
  }

  const adjustedInstruments = normalizedAllocations(instruments, adjusted);
  const normalizedWeights = adjustedInstruments.map(item => item.allocationWeight);
  validateSuitability(canonicalProfile, adjustedInstruments.map(item => item.id));
  if (adjustedInstruments.some(item => Number(item.riskScore) > Number(suitability.finalLevel))) {
    const error = new Error('Market-context adjustment breached the profile suitability risk ceiling.');
    error.code = 'MARKET_CONTEXT_RISK_CEILING_VIOLATION';
    throw error;
  }
  assertConcentrationCaps(adjustedInstruments, normalizedWeights, capResolver);
  const adjustedIds = new Set(adjustedInstruments.map(item => item.id));
  const introducedInstrumentIds = [...adjustedIds].filter(id => !ids.includes(id));
  if (introducedInstrumentIds.length) {
    throw new Error('Market-context adjustment introduced an unauthorised instrument.');
  }

  const explanations = [
    ...[...removedByDonor.entries()]
      .filter(([, amount]) => amount > 1e-12)
      .map(([index, amount]) => ({
        instrumentId: instruments[index].id,
        direction: 'REDUCE',
        deltaPct: Number((-amount * 100).toFixed(6)),
        reasonCode: 'BOUNDED_REDUCTION_FROM_HIGHER_RISK_ELIGIBLE_INSTRUMENT',
      })),
    ...[...addedByRecipient.entries()]
      .filter(([, amount]) => amount > 1e-12)
      .map(([index, amount]) => ({
        instrumentId: instruments[index].id,
        direction: 'INCREASE',
        deltaPct: Number((amount * 100).toFixed(6)),
        reasonCode: 'BOUNDED_TRANSFER_TO_LOWEST_RISK_ALREADY_ELIGIBLE_INSTRUMENT',
      })),
  ];

  return {
    classification: 'PROFILE_SAFE_MARKET_CONTEXT_ADJUSTMENT',
    adjustmentVersion: MARKET_CONTEXT_ADJUSTMENT_VERSION,
    context: marketContext.context,
    contextStatus: marketContext.status,
    applied: true,
    maxTotalTiltPct,
    actualTotalTiltPct: Number((actualTransfer * 100).toFixed(6)),
    baseWeights: Object.fromEntries(instruments.map((item, index) => [item.id, baseWeightsArray[index]])),
    adjustedWeights: Object.fromEntries(adjustedInstruments.map(item => [item.id, item.allocationWeight])),
    adjustedInstruments,
    introducedInstrumentIds,
    reasonCodes: [
      'SERVER_AUTHORITATIVE_RECOMMENDATION_ONLY',
      'PROFILE_SUITABILITY_REVALIDATED',
      'CONCENTRATION_CAPS_REVALIDATED',
      `MAX_TOTAL_TILT_${maxTotalTiltPct}_PCT`,
    ],
    explanations,
    suitabilityRevalidated: true,
    concentrationCapsRevalidated: true,
  };
}
