import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { boundedResearchBudget, emptyResearchBudgetUsage, stableResearchId } from './researchConstants.js';
import { validateResearchBrief } from './researchSchemas.js';
import { validatePublicUrl } from './safePublicDocumentFetcher.js';
import { extractDocumentEvidence } from './documentEvidenceExtractor.js';
import { buildResearchArtifact } from './researchArtifact.js';
import { detectResearchContradictions, verifyResearchArtifact } from './researchClaimVerifier.js';

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Research task was canceled.');
  error.code = 'RESEARCH_CANCELED';
  error.name = 'AbortError';
  throw error;
}

function buildQueries(brief) {
  const factTypes = brief.requestedFactTypes.join(' ');
  return [...new Set([
    `${brief.question} ${brief.jurisdiction}`,
    `${brief.topic} ${factTypes} ${brief.jurisdiction}`,
    `${brief.jurisdiction} ${brief.topic} official source`,
  ])];
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
  const usage = emptyResearchBudgetUsage();
  const startedAt = Date.now();
  const evidenceUnits = [];
  const sources = [];
  const claims = [];
  const unresolvedGaps = [];
  const seenDocuments = new Set();
  const seenClaims = new Set();
  let contradictions = [];
  const queries = buildQueries(safeBrief);

  for (let round = 0; round < budget.maxResearchRounds && round < safeBrief.maxResearchDepth; round += 1) {
    throwIfAborted(signal);
    if (!checkTimeAndUsageBudget(usage, budget, startedAt)) break;
    usage.rounds += 1;
    await onProgress({ type: 'RESEARCH_SEARCH_ROUND', round: usage.rounds });
    const query = queries[round % queries.length];
    if (!query || usage.queryCount >= budget.maxSearchQueries) break;
    usage.queryCount += 1;
    PrometheusMetrics.inc('research_queries_total');
    let results;
    try {
      results = await provider.search({ query, brief: safeBrief, maxResults: budget.maxResultsPerQuery, signal });
    } catch (error) {
      PrometheusMetrics.inc('research_provider_failures_total');
      throw error;
    }
    const candidates = Array.isArray(results) ? results : [];
    for (const candidate of candidates) {
      throwIfAborted(signal);
      if (seenDocuments.size >= budget.maxUniqueDocuments || !checkTimeAndUsageBudget(usage, budget, startedAt)) break;
      if (!candidate?.url || seenDocuments.has(candidate.url)) continue;
      seenDocuments.add(candidate.url);
      let document = candidate;
      const fixtureInlineContent = provider.name === 'fixture' && Boolean(candidate.content);
      if (!fixtureInlineContent) {
        document = await documentFetcher.fetchDocument(candidate.url, { signal });
        document = { ...candidate, ...document, content: document.body };
      } else {
        validatePublicUrl(candidate.url);
      }
      const extracted = extractDocumentEvidence({
        document: {
          ...document,
          url: document.url || candidate.url,
          body: document.content || document.body,
          retrievedAt: document.retrievedAt || new Date().toISOString(),
        },
        factType: candidate.factType || safeBrief.requestedFactTypes[0],
        title: candidate.title,
        publisher: candidate.publisher,
        publicationDate: candidate.publicationDate,
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
      await onProgress({ type: 'RESEARCH_SOURCES_FOUND', documentCount: usage.documentCount });
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
  await onProgress({ type: 'RESEARCH_VERIFYING', claimCount: claims.length });
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
  await onProgress({ type: 'RESEARCH_COMPLETED', status: artifact.status, claimCount: verification.verifiedClaims.length });
  return { artifact, verification, budget, usage };
}
