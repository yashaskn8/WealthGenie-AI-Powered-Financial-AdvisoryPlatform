import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { boundedResearchBudget, emptyResearchBudgetUsage, stableResearchId } from './researchConstants.js';
import { validateResearchBrief } from './researchSchemas.js';
import { validatePublicUrl } from './safePublicDocumentFetcher.js';
import { extractDocumentEvidence } from './documentEvidenceExtractor.js';
import { buildResearchArtifact } from './researchArtifact.js';
import { detectResearchContradictions, verifyResearchArtifact } from './researchClaimVerifier.js';

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.code
      && !['RESEARCH_CANCELED', 'ABORT_ERR', 'RESEARCH_FETCH_ABORTED'].includes(signal.reason.code)) throw signal.reason;
  const error = new Error('Research task was canceled.');
  error.code = 'RESEARCH_CANCELED';
  error.name = 'AbortError';
  throw error;
}

function awaitWithAbort(value, signal) {
  if (!signal) return Promise.resolve(value);
  const aborted = () => signal.reason instanceof Error && signal.reason.code
      && !['RESEARCH_CANCELED', 'ABORT_ERR', 'RESEARCH_FETCH_ABORTED'].includes(signal.reason.code)
    ? signal.reason
    : Object.assign(new Error('Research task was canceled.'), { code: 'RESEARCH_CANCELED', name: 'AbortError' });
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(
      result => { signal.removeEventListener('abort', onAbort); resolve(result); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function buildQueries(brief) {
  const factTypes = brief.requestedFactTypes.join(' ');
  return [...new Set([
    `${brief.question} ${brief.jurisdiction}`,
    `${brief.topic} ${factTypes} ${brief.jurisdiction}`,
    `${brief.jurisdiction} ${brief.topic} official source`,
  ])];
}

function publisherFromUrl(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function isFresh(publicationDate, brief, now) {
  if (!publicationDate) return 'UNKNOWN';
  const published = new Date(publicationDate);
  if (!Number.isFinite(published.getTime()) || published > now) return 'UNKNOWN';
  const ageHours = (now.getTime() - published.getTime()) / 3600000;
  return ageHours <= brief.freshnessRequirement.maxAgeHours ? 'FRESH' : 'STALE';
}

function sourceFromEvidence(evidence) {
  return {
    sourceId: evidence.sourceId,
    canonicalUrl: evidence.canonicalUrl,
    title: evidence.title,
    publisher: evidence.publisher,
    publicationDate: evidence.publicationDate,
    retrievedAt: evidence.retrievedAt,
    sourceTrustTier: evidence.sourceTrustTier,
    documentHash: evidence.documentHash,
  };
}

function claimFromEvidence(evidence, brief, now) {
  const freshnessStatus = isFresh(evidence.publicationDate, brief, now);
  const trusted = evidence.sourceTrustTier !== 'UNVERIFIED';
  const supported = trusted && freshnessStatus === 'FRESH';
  return {
    claimId: stableResearchId('C', `${evidence.evidenceId}:${evidence.claimCandidate}`),
    text: evidence.claimCandidate,
    claimType: evidence.factType,
    supportingEvidenceIds: [evidence.evidenceId],
    contradictingEvidenceIds: [],
    supportStatus: supported ? 'SUPPORTED' : 'UNVERIFIED',
    confidenceBand: supported ? (evidence.sourceTrustTier === 'OFFICIAL_PRIMARY' ? 'HIGH' : 'MEDIUM') : 'NONE',
    freshnessStatus,
    sourceTrustTier: evidence.sourceTrustTier,
    asOf: evidence.publicationDate || null,
  };
}

function checkTimeAndUsageBudget(usage, budget, startedAt) {
  usage.durationMs = Date.now() - startedAt;
  if (usage.durationMs >= budget.maxDurationMs
    || usage.queryCount >= budget.maxSearchQueries
    || usage.documentCount >= budget.maxUniqueDocuments) {
    usage.exhausted = true;
    return false;
  }
  return true;
}

function buildFailureArtifact({ brief, taskId, usage, status, unresolvedGaps, claims, evidenceUnits, sources, contradictions, startedAt }) {
  return buildResearchArtifact({
    brief,
    taskId,
    status,
    claims,
    evidenceUnits,
    sources,
    contradictions,
    unresolvedGaps,
    researchBudgetUsed: usage,
    queryCount: usage.queryCount,
    documentCount: usage.documentCount,
    modelCalls: usage.modelCalls,
    tokenUsage: usage.tokenUsage,
    durationMs: Date.now() - startedAt,
  });
}

export async function runResearch({
  brief,
  taskId = null,
  provider,
  documentFetcher,
  budget: budgetOverrides = {},
  signal,
  now = new Date(),
  onProgress = async () => undefined,
} = {}) {
  const validation = validateResearchBrief(brief);
  if (validation.error) {
    const error = new Error('ResearchBrief failed validation.');
    error.code = 'INVALID_RESEARCH_BRIEF';
    error.details = validation.error.details;
    throw error;
  }
  if (!provider || typeof provider.search !== 'function') {
    const error = new Error('Research search provider is unavailable.');
    error.code = 'RESEARCH_PROVIDER_UNAVAILABLE';
    PrometheusMetrics.inc('research_provider_failures_total');
    throw error;
  }
  if (!documentFetcher || typeof documentFetcher.fetchDocument !== 'function') {
    const error = new Error('Research document fetcher is unavailable.');
    error.code = 'RESEARCH_PROVIDER_UNAVAILABLE';
    PrometheusMetrics.inc('research_provider_failures_total');
    throw error;
  }

  const safeBrief = validation.value;
  const budget = boundedResearchBudget(budgetOverrides);
  const deadlineController = new AbortController();
  const deadlineError = Object.assign(new Error('Research exceeded its hard execution deadline.'), { code: 'RESEARCH_DEADLINE_EXCEEDED' });
  const deadlineTimer = setTimeout(() => deadlineController.abort(deadlineError), budget.maxDurationMs);
  const operationSignal = signal && AbortSignal.any ? AbortSignal.any([signal, deadlineController.signal]) : (signal || deadlineController.signal);
  const usage = emptyResearchBudgetUsage();
  const startedAt = Date.now();
  try {
  const evidenceUnits = [];
  const sources = [];
  const claims = [];
  const unresolvedGaps = [];
  const seenDocuments = new Set();
  const seenClaims = new Set();
  let contradictions = [];
  const queries = buildQueries(safeBrief);

  for (let round = 0; round < budget.maxResearchRounds && round < safeBrief.maxResearchDepth; round += 1) {
    throwIfAborted(operationSignal);
    if (!checkTimeAndUsageBudget(usage, budget, startedAt)) break;
    usage.rounds += 1;
    await awaitWithAbort(onProgress({ type: 'RESEARCH_SEARCH_ROUND', round: usage.rounds }), operationSignal);
    const query = queries[round % queries.length];
    if (!query || usage.queryCount >= budget.maxSearchQueries) break;
    usage.queryCount += 1;
    PrometheusMetrics.inc('research_queries_total');
    let results;
    try {
      results = await awaitWithAbort(provider.search({ query, brief: safeBrief, maxResults: budget.maxResultsPerQuery, signal: operationSignal }), operationSignal);
    } catch (error) {
      PrometheusMetrics.inc('research_provider_failures_total');
      throw error;
    }
    const candidates = Array.isArray(results) ? results : [];
    for (const candidate of candidates) {
      throwIfAborted(operationSignal);
      if (seenDocuments.size >= budget.maxUniqueDocuments || !checkTimeAndUsageBudget(usage, budget, startedAt)) break;
      if (!candidate?.url) continue;
      let candidateUrl;
      try { candidateUrl = validatePublicUrl(candidate.url).toString(); } catch {
        unresolvedGaps.push({ gapId: stableResearchId('G', String(candidate.url).slice(0, 240)), factType: safeBrief.requestedFactTypes[0], status: 'UNRESOLVED', reasonCode: 'RESEARCH_SOURCE_URL_REJECTED' });
        continue;
      }
      if (seenDocuments.has(candidateUrl)) continue;
      seenDocuments.add(candidateUrl);
      let document = candidate;
      const fixtureInlineContent = provider.name === 'fixture' && Boolean(candidate.content);
      if (!fixtureInlineContent) {
        const fetched = await awaitWithAbort(documentFetcher.fetchDocument(candidateUrl, { signal: operationSignal }), operationSignal);
        // Search-provider labels and dates are discovery hints, not source provenance.
        // Only fixture documents may supply these fields; live evidence uses the URL
        // actually fetched and leaves legal/publication time unknown absent a parser.
        document = {
          url: fetched.url,
          content: fetched.body,
          retrievedAt: fetched.retrievedAt,
          title: null,
          publisher: publisherFromUrl(fetched.url),
          publicationDate: null,
        };
      }
      const extracted = extractDocumentEvidence({
        document: {
          ...document,
          url: document.url || candidateUrl,
          body: document.content || document.body,
          retrievedAt: document.retrievedAt || new Date().toISOString(),
        },
        factType: fixtureInlineContent && safeBrief.requestedFactTypes.includes(candidate.factType)
          ? candidate.factType
          : safeBrief.requestedFactTypes[0],
        title: fixtureInlineContent ? candidate.title : null,
        publisher: fixtureInlineContent ? candidate.publisher : publisherFromUrl(document.url || candidateUrl),
        publicationDate: fixtureInlineContent ? candidate.publicationDate : null,
      });
      if (extracted.promptInjectionDetected) {
        unresolvedGaps.push({ gapId: stableResearchId('G', candidate.url), factType: candidate.factType || 'public_fact', status: 'UNRESOLVED', reasonCode: 'PROMPT_INJECTION_IN_DOCUMENT' });
        continue;
      }
      if (!extracted.evidenceUnits.length) continue;
      usage.documentCount += 1;
      PrometheusMetrics.inc('research_documents_total');
      const units = extracted.evidenceUnits.map(unit => ({ ...unit, freshnessStatus: isFresh(unit.publicationDate, safeBrief, now) }));
      evidenceUnits.push(...units);
      sources.push(...units.filter(unit => !sources.some(source => source.sourceId === unit.sourceId)).map(sourceFromEvidence));
      for (const unit of units) {
        const claim = claimFromEvidence(unit, safeBrief, now);
        if (seenClaims.has(claim.text.toLowerCase())) continue;
        seenClaims.add(claim.text.toLowerCase());
        claims.push(claim);
      }
      await awaitWithAbort(onProgress({ type: 'RESEARCH_SOURCES_FOUND', documentCount: usage.documentCount }), operationSignal);
    }
    contradictions = detectResearchContradictions(claims, evidenceUnits);
    if (claims.length > 0 && contradictions.length === 0) break;
  }

  for (const contradiction of contradictions) {
    const ids = new Set(contradiction.claimIds);
    for (const claim of claims) {
      if (!ids.has(claim.claimId)) continue;
      claim.supportStatus = 'CONTRADICTED';
      claim.confidenceBand = 'NONE';
      claim.contradictingEvidenceIds = claims
        .filter(other => ids.has(other.claimId) && other.claimId !== claim.claimId)
        .flatMap(other => other.supportingEvidenceIds);
    }
  }

  usage.durationMs = Date.now() - startedAt;
  const status = contradictions.length > 0
    ? 'CONFLICTING_EVIDENCE'
    : claims.length === 0
      ? (usage.exhausted ? 'BUDGET_EXHAUSTED' : 'INSUFFICIENT_EVIDENCE')
      : 'COMPLETED';
  const artifact = buildFailureArtifact({
    brief: safeBrief,
    taskId,
    usage,
    status,
    unresolvedGaps,
    claims,
    evidenceUnits,
    sources,
    contradictions,
    startedAt,
  });
  await awaitWithAbort(onProgress({ type: 'RESEARCH_VERIFYING', claimCount: claims.length }), operationSignal);
  throwIfAborted(operationSignal);
  const verification = verifyResearchArtifact(artifact, { brief: safeBrief, now });
  if (!verification.valid) {
    PrometheusMetrics.inc('research_verification_failures_total');
    const error = new Error('Research artifact failed independent verification.');
    error.code = 'RESEARCH_ARTIFACT_REJECTED';
    error.details = verification.errors;
    error.verification = verification;
    throw error;
  }
  if (usage.exhausted) PrometheusMetrics.inc('research_budget_exhausted_total');
  PrometheusMetrics.inc('research_duration_seconds_total', usage.durationMs / 1000);
  await awaitWithAbort(onProgress({ type: 'RESEARCH_COMPLETED', status: artifact.status, claimCount: verification.verifiedClaims.length }), operationSignal);
  throwIfAborted(operationSignal);
  return { artifact, verification, budget, usage };
  } finally {
    clearTimeout(deadlineTimer);
  }
}
