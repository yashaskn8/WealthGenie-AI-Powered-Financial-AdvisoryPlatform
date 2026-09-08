import crypto from 'node:crypto';

export const MARKET_CONTEXT_CLASSIFICATION = 'DETERMINISTIC_POLICY_HEURISTIC';
export const MARKET_CONTEXT_POLICY_VERSION = 'market-context-policy-1.0.0';

/**
 * Transparent MVP engineering thresholds. They are policy choices, not ML,
 * statistically fitted boundaries, forecasts, or claims of optimality.
 */
export const MARKET_CONTEXT_THRESHOLDS = Object.freeze({
  riskOffDrawdownPct: -10,
  riskOffReturn20DayPct: -5,
  highVolatilityIndiaVix: 25,
  highVolatilityRealizedVolatilityPct: 30,
  cautiousIndiaVix: 20,
  cautiousDrawdownPct: -5,
  cautiousReturn20DayPct: -3,
});

export const MARKET_CONTEXT_HYSTERESIS = Object.freeze({
  worseningConfirmations: 2,
  recoveryConfirmations: 3,
});

const CONTEXT_SEVERITY = Object.freeze({
  NORMAL: 0,
  CAUTIOUS: 1,
  HIGH_VOLATILITY: 2,
  RISK_OFF: 3,
});

function value(signals, key) {
  const number = signals?.[key]?.value;
  return Number.isFinite(number) ? number : null;
}

export function classifyDeterministicMarketContext(features) {
  const base = {
    status: 'MARKET_CONTEXT_UNAVAILABLE',
    context: null,
    confidence: null,
    classification: MARKET_CONTEXT_CLASSIFICATION,
    policyVersion: MARKET_CONTEXT_POLICY_VERSION,
    thresholdBasis: 'DETERMINISTIC_MVP_ENGINEERING_HEURISTIC_NOT_LEARNED',
    thresholds: MARKET_CONTEXT_THRESHOLDS,
    signals: features?.signals ?? {},
    reasonCodes: features?.reasonCodes ?? ['MARKET_FEATURES_UNAVAILABLE'],
    observedAt: features?.observedAt ?? null,
    freshness: features?.freshness ?? null,
    sources: features?.sources ?? [],
  };
  if (features?.status !== 'FEATURES_AVAILABLE') return base;

  const signals = features.signals;
  const vix = value(signals, 'indiaVixCurrent');
  const return20 = value(signals, 'return20DayPct');
  const drawdown = value(signals, 'drawdownFromRecentHighPct');
  const realizedVolatility = value(signals, 'realizedVolatility20DayAnnualizedPct');
  const priceVsMa50 = value(signals, 'priceVsMovingAverage50Pct');
  if ([vix, return20, drawdown, realizedVolatility, priceVsMa50].some(item => item === null)) {
    return { ...base, reasonCodes: ['REQUIRED_POLICY_SIGNAL_UNAVAILABLE'] };
  }

  let context;
  let reasonCodes;
  if (drawdown <= MARKET_CONTEXT_THRESHOLDS.riskOffDrawdownPct
      && return20 <= MARKET_CONTEXT_THRESHOLDS.riskOffReturn20DayPct
      && priceVsMa50 < 0) {
    context = 'RISK_OFF';
    reasonCodes = [
      'DRAWDOWN_AT_OR_BELOW_RISK_OFF_THRESHOLD',
      'RETURN_20D_AT_OR_BELOW_RISK_OFF_THRESHOLD',
      'PRICE_BELOW_MA50',
    ];
  } else if (vix >= MARKET_CONTEXT_THRESHOLDS.highVolatilityIndiaVix
      || realizedVolatility >= MARKET_CONTEXT_THRESHOLDS.highVolatilityRealizedVolatilityPct) {
    context = 'HIGH_VOLATILITY';
    reasonCodes = [
      ...(vix >= MARKET_CONTEXT_THRESHOLDS.highVolatilityIndiaVix ? ['INDIA_VIX_AT_OR_ABOVE_HIGH_VOLATILITY_THRESHOLD'] : []),
      ...(realizedVolatility >= MARKET_CONTEXT_THRESHOLDS.highVolatilityRealizedVolatilityPct ? ['REALIZED_VOLATILITY_AT_OR_ABOVE_HIGH_THRESHOLD'] : []),
    ];
  } else {
    const cautiousReasons = [
      ...(vix >= MARKET_CONTEXT_THRESHOLDS.cautiousIndiaVix ? ['INDIA_VIX_AT_OR_ABOVE_CAUTIOUS_THRESHOLD'] : []),
      ...(drawdown <= MARKET_CONTEXT_THRESHOLDS.cautiousDrawdownPct ? ['DRAWDOWN_AT_OR_BELOW_CAUTIOUS_THRESHOLD'] : []),
      ...(return20 <= MARKET_CONTEXT_THRESHOLDS.cautiousReturn20DayPct ? ['RETURN_20D_AT_OR_BELOW_CAUTIOUS_THRESHOLD'] : []),
      ...(priceVsMa50 < 0 ? ['PRICE_BELOW_MA50'] : []),
    ];
    context = cautiousReasons.length > 0 ? 'CAUTIOUS' : 'NORMAL';
    reasonCodes = cautiousReasons.length > 0 ? cautiousReasons : ['NO_CAUTION_OR_RISK_OFF_POLICY_THRESHOLD_MET'];
  }

  return {
    ...base,
    status: 'MARKET_CONTEXT_AVAILABLE',
    context,
    reasonCodes: [...new Set([...features.reasonCodes, ...reasonCodes])],
  };
}

export function marketContextFingerprint(classifiedContext) {
  const material = {
    context: classifiedContext?.context ?? null,
    observedAt: classifiedContext?.observedAt ?? null,
    signals: Object.fromEntries(Object.entries(classifiedContext?.signals || {}).map(([key, item]) => [key, item?.value ?? null])),
  };
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export function applyMarketContextHysteresis(candidate, previousState = null, now = new Date()) {
  if (candidate?.status !== 'MARKET_CONTEXT_AVAILABLE' || !candidate.context) {
    return {
      result: {
        ...candidate,
        hysteresis: { status: 'NOT_APPLIED_MARKET_CONTEXT_UNAVAILABLE' },
      },
      state: previousState,
      changed: false,
    };
  }
  const evaluatedAt = now.toISOString();
  const fingerprint = marketContextFingerprint(candidate);
  const previousContext = CONTEXT_SEVERITY[previousState?.currentContext] === undefined
    ? null
    : previousState.currentContext;

  if (!previousContext) {
    const state = {
      currentContext: candidate.context,
      pendingContext: null,
      pendingConfirmations: 0,
      lastFingerprint: fingerprint,
      lastTransitionAt: evaluatedAt,
      updatedAt: evaluatedAt,
    };
    return {
      result: {
        ...candidate,
        candidateContext: candidate.context,
        candidateReasonCodes: candidate.reasonCodes,
        reasonCodes: [...candidate.reasonCodes, 'HYSTERESIS_INITIAL_CONTEXT_ACCEPTED'],
        hysteresis: { status: 'INITIAL_CONTEXT_ACCEPTED', confirmationsRequired: 1, confirmationsObserved: 1 },
      },
      state,
      changed: true,
    };
  }

  if (candidate.context === previousContext) {
    const changed = previousState.lastFingerprint !== fingerprint
      || previousState.pendingContext !== null
      || previousState.pendingConfirmations !== 0;
    const state = {
      ...previousState,
      pendingContext: null,
      pendingConfirmations: 0,
      lastFingerprint: fingerprint,
      updatedAt: evaluatedAt,
    };
    return {
      result: {
        ...candidate,
        candidateContext: candidate.context,
        candidateReasonCodes: candidate.reasonCodes,
        reasonCodes: [...candidate.reasonCodes, 'HYSTERESIS_CONTEXT_CONFIRMED'],
        hysteresis: { status: 'STABLE_CONTEXT_CONFIRMED', confirmationsRequired: 1, confirmationsObserved: 1 },
      },
      state,
      changed,
    };
  }

  const worsening = CONTEXT_SEVERITY[candidate.context] > CONTEXT_SEVERITY[previousContext];
  const confirmationsRequired = worsening
    ? MARKET_CONTEXT_HYSTERESIS.worseningConfirmations
    : MARKET_CONTEXT_HYSTERESIS.recoveryConfirmations;
  const duplicateObservation = previousState.lastFingerprint === fingerprint;
  const pendingConfirmations = duplicateObservation
    ? previousState.pendingConfirmations || 0
    : previousState.pendingContext === candidate.context
      ? (previousState.pendingConfirmations || 0) + 1
      : 1;

  if (pendingConfirmations >= confirmationsRequired) {
    const state = {
      currentContext: candidate.context,
      pendingContext: null,
      pendingConfirmations: 0,
      lastFingerprint: fingerprint,
      lastTransitionAt: evaluatedAt,
      updatedAt: evaluatedAt,
    };
    return {
      result: {
        ...candidate,
        candidateContext: candidate.context,
        candidateReasonCodes: candidate.reasonCodes,
        reasonCodes: [...candidate.reasonCodes, 'HYSTERESIS_TRANSITION_CONFIRMED'],
        hysteresis: {
          status: 'TRANSITION_CONFIRMED',
          previousContext,
          confirmationsRequired,
          confirmationsObserved: pendingConfirmations,
        },
      },
      state,
      changed: true,
    };
  }

  const state = duplicateObservation ? previousState : {
    ...previousState,
    pendingContext: candidate.context,
    pendingConfirmations,
    lastFingerprint: fingerprint,
    updatedAt: evaluatedAt,
  };
  return {
    result: {
      ...candidate,
      context: previousContext,
      candidateContext: candidate.context,
      candidateReasonCodes: candidate.reasonCodes,
      reasonCodes: ['HYSTERESIS_HOLDING_PREVIOUS_CONTEXT'],
      hysteresis: {
        status: duplicateObservation ? 'DUPLICATE_OBSERVATION_IGNORED' : 'AWAITING_CONFIRMATION',
        previousContext,
        confirmationsRequired,
        confirmationsObserved: pendingConfirmations,
      },
    },
    state,
    changed: !duplicateObservation,
  };
}
