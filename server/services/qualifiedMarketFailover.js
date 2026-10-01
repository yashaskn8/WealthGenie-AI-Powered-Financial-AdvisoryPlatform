import { computeMarketContextFeatures } from './marketContextFeatureEngine.js';
import { AVAILABILITY } from './marketData/contracts.js';

function unavailableSnapshot(provider, kind) {
  return {
    provider,
    status: AVAILABILITY.SOURCE_ERROR,
    facts: [],
    candles: [],
    fetchedAt: new Date().toISOString(),
    error: { code: 'MARKET_PROVIDER_REQUEST_FAILED', message: `Market ${kind} provider request failed.` },
  };
}

function identityMatches(snapshot, provider, kind) {
  if (snapshot?.provider !== provider) return false;
  if (kind === 'quotes') {
    const facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
    return facts.length > 0 && facts.every(fact => fact?.source?.provider === provider);
  }
  return snapshot?.source?.provider === provider;
}

function diagnosticsFor(attemptedProviders, selectedProvider, failures, preferredProvider) {
  return {
    attemptedProviders,
    selectedProvider,
    providerFailures: failures,
    fallbackUsed: Boolean(selectedProvider && selectedProvider !== preferredProvider),
  };
}

/**
 * Try coherent quote+history pairs in server-configured order. A provider is
 * selected only when both of its snapshots have matching source identity and
 * together yield the verified inputs required by the market feature engine.
 * Partial/invalid evidence is recorded and never combined with another source.
 */
export async function fetchQualifiedMarketPair({
  providers,
  preferredProvider,
  quoteOptions = {},
  historyOptions = {},
} = {}) {
  if (!Array.isArray(providers) || providers.length < 1) {
    throw new TypeError('At least one configured market provider pair is required.');
  }
  const byName = new Map(providers.map(provider => [provider.name, provider]));
  const providerOrder = [preferredProvider, ...providers.map(provider => provider.name)
    .filter(name => name !== preferredProvider)].filter((name, index, list) => (
    byName.has(name) && list.indexOf(name) === index
  ));
  if (providerOrder.length === 0) throw new TypeError('preferredProvider must match a configured provider pair.');

  const attemptedProviders = [];
  const providerFailures = [];
  let preferredAttempt = null;
  for (const name of providerOrder) {
    const provider = byName.get(name);
    attemptedProviders.push(name);
    const [quoteResult, historyResult] = await Promise.allSettled([
      provider.fetchQuotes(quoteOptions),
      provider.fetchHistory(historyOptions),
    ]);
    const quoteSnapshot = quoteResult.status === 'fulfilled'
      ? quoteResult.value
      : unavailableSnapshot(name, 'quote');
    const historicalSnapshot = historyResult.status === 'fulfilled'
      ? historyResult.value
      : unavailableSnapshot(name, 'history');
    const identityValid = identityMatches(quoteSnapshot, name, 'quotes')
      && identityMatches(historicalSnapshot, name, 'history');
    const features = identityValid
      ? computeMarketContextFeatures({ quoteSnapshot, historicalSnapshot })
      : { status: 'FEATURES_UNAVAILABLE', reasonCodes: ['MARKET_PROVIDER_IDENTITY_MISMATCH'] };
    const reasonCodes = [...new Set([
      ...(!identityValid ? ['MARKET_PROVIDER_IDENTITY_MISMATCH'] : []),
      ...(features.reasonCodes || []),
      ...(quoteResult.status === 'rejected' ? ['MARKET_QUOTE_SOURCE_ERROR'] : []),
      ...(historyResult.status === 'rejected' ? ['MARKET_HISTORY_SOURCE_ERROR'] : []),
    ])];
    const attempt = { provider: name, quoteSnapshot, historicalSnapshot, identityValid };
    if (!preferredAttempt) preferredAttempt = attempt;

    if (identityValid && features.status === 'FEATURES_AVAILABLE') {
      const providerSelection = diagnosticsFor(attemptedProviders, name, providerFailures, preferredProvider);
      return {
        quoteSnapshot: { ...quoteSnapshot, providerSelection },
        historicalSnapshot: { ...historicalSnapshot, providerSelection },
        providerSelection,
      };
    }

    providerFailures.push({
      provider: name,
      reasonCodes: reasonCodes.length ? reasonCodes : ['MARKET_PROVIDER_PAIR_UNQUALIFIED'],
    });
  }

  const providerSelection = diagnosticsFor(attemptedProviders, null, providerFailures, preferredProvider);
  const rejectedProviderReasonCodes = [...new Set(providerFailures.flatMap(failure => failure.reasonCodes))];
  const quoteSnapshot = preferredAttempt.identityValid
    ? preferredAttempt.quoteSnapshot
    : unavailableSnapshot(preferredAttempt.provider, 'quote');
  const historicalSnapshot = preferredAttempt.identityValid
    ? preferredAttempt.historicalSnapshot
    : unavailableSnapshot(preferredAttempt.provider, 'history');
  return {
    quoteSnapshot: { ...quoteSnapshot, reasonCodes: rejectedProviderReasonCodes, providerSelection },
    historicalSnapshot: { ...historicalSnapshot, reasonCodes: rejectedProviderReasonCodes, providerSelection },
    providerSelection,
  };
}
