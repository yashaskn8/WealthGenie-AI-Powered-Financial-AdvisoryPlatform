import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { TaskState } from '@a2a-js/sdk';
import { createResearchSourceAttestor, verifyResearchSourceAttestation } from '../agents/research/researchSourceAttestation.js';
import { extractDocumentEvidence } from '../agents/research/documentEvidenceExtractor.js';
import { createResearchBrief } from '../agents/research/researchSchemas.js';
import { runResearch } from '../agents/research/researchLoop.js';
import { hashResearchArtifact, hashResearchBrief, hashResearchExecutionBinding } from '../agents/research/researchArtifact.js';
import { RESEARCH_POLICY_VERSION } from '../agents/research/researchConstants.js';
import { verifyResearchArtifact } from '../agents/research/researchClaimVerifier.js';
import { ResearchMeshClient } from '../agents/research/researchMeshClient.js';
import { evaluateProductionAgentRun } from '../agents/evals/productionEvaluator.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';

const observedAt = new Date().toISOString();

function keys() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'research-test-key', alg: 'RS256', use: 'sig' };
  const attestor = createResearchSourceAttestor({ privateKey: pair.privateKey, keyId: publicJwk.kid });
  return { attestor, publicJwk };
}

function rawBodySha256(body) {
  return crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
}

function makeBrief({ runId = 'source-attestation-plan-review-run', executionGeneration = 1, traceId = 'trace-source-attestation' } = {}) {
  return createResearchBrief({
    researchBriefId: 'source-attestation-brief',
    topic: 'RBI public policy',
    question: 'Which published RBI policy fact is currently available?',
    jurisdiction: 'IN',
    asOf: observedAt,
    requestedFactTypes: ['regulatory_context'],
    freshnessRequirement: { maxAgeHours: 24, requiredSourceTier: 'OFFICIAL_PRIMARY' },
    executionBindingHash: hashResearchExecutionBinding({ runId, executionGeneration, traceId }),
    maxResearchDepth: 1,
  });
}

test('live ResearchMesh fetch is signed and independently bound to URL, time, bytes, jurisdiction, and freshness policy', async () => {
  const { attestor, publicJwk } = keys();
  const brief = makeBrief();
  const fetched = {
    requestedUrl: 'https://rbi.org.in/press-release/source-attestation',
    url: 'https://rbi.org.in/press-release/source-attestation',
    contentType: 'text/plain',
    statusCode: 200,
    redirectCount: 0,
    body: 'The Reserve Bank of India published a policy note on monetary conditions.',
    retrievedAt: observedAt,
  };
  fetched.rawBodySha256 = rawBodySha256(fetched.body);
  const result = await runResearch({
    brief,
    taskId: 'source-attestation-task',
    now: new Date(observedAt),
    provider: { name: 'configured', search: async () => [{ url: fetched.requestedUrl }] },
    documentFetcher: { fetchDocument: async () => fetched },
    attestSourceFetch: attestor.attest,
  });

  assert.equal(result.artifact.status, 'INSUFFICIENT_EVIDENCE', 'a fetch signature must not manufacture a publication date');
  assert.equal(result.artifact.sources.length, 1);
  assert.equal(result.artifact.version, '1.3.0');
  const source = result.artifact.sources[0];
  assert.equal(source.fetchAttestation.jurisdiction, 'IN');
  assert.equal(source.fetchAttestation.freshnessMaxAgeHours, 24);
  assert.equal(source.fetchAttestation.executionBindingHash, brief.executionBindingHash);
  assert.equal(source.fetchAttestation.taskId, 'source-attestation-task');
  assert.equal(source.fetchAttestation.publicationDate, null);
  const strict = verifyResearchArtifact(result.artifact, {
    brief,
    now: new Date(observedAt),
    requireSourceAttestation: true,
    requireFreshSourceFetch: true,
    trustedSourceAttestationJwk: publicJwk,
  });
  assert.equal(strict.valid, true, strict.errors.join(', '));

  const client = new ResearchMeshClient({
    baseUrl: 'https://research.example.test',
    requireSignedCard: true,
    configuredJwk: publicJwk,
    env: { NODE_ENV: 'production' },
  });
  let deliveredArtifact = result.artifact;
  client.resolve = async () => ({
    card: {},
    client: {
      sendMessage: async () => ({
        id: 'source-attestation-task',
        status: { state: TaskState.TASK_STATE_COMPLETED },
        artifacts: [{ parts: [{ content: { $case: 'data', value: deliveredArtifact } }] }],
      }),
    },
  });
  assert.equal((await client.sendResearch({ brief })).artifact.contentHash, result.artifact.contentHash);

  const tampered = structuredClone(result.artifact);
  tampered.sources[0].fetchAttestation.rawBodySha256 = 'd'.repeat(64);
  tampered.contentHash = hashResearchArtifact(Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== 'contentHash')));
  const rejected = verifyResearchArtifact(tampered, {
    brief,
    now: new Date(observedAt),
    requireSourceAttestation: true,
    trustedSourceAttestationJwk: publicJwk,
  });
  assert.ok(rejected.errors.some(code => code.startsWith('SOURCE_FETCH_ATTESTATION_ATTESTATION_SIGNATURE_INVALID_')));
  deliveredArtifact = tampered;
  await assert.rejects(() => client.sendResearch({ brief }), error => error.code === 'RESEARCH_ARTIFACT_INVALID');
});

test('source-fetch verification rejects a missing trust anchor, wrong key, jurisdiction mismatch, and stale observation', () => {
  const { attestor, publicJwk } = keys();
  const other = keys();
  const document = {
    url: 'https://www.rbi.org.in/Scripts/BS_ViewBulletin.aspx',
    contentType: 'text/html',
    statusCode: 200,
    redirectCount: 1,
    body: 'Official RBI public source.',
    retrievedAt: observedAt,
      rawBodySha256: rawBodySha256('Official RBI public source.'),
  };
  const brief = makeBrief();
  const evidenceUnits = extractDocumentEvidence({
    document: { url: document.url, body: document.body, retrievedAt: document.retrievedAt },
    publisher: new URL(document.url).hostname,
  }).evidenceUnits;
  const attest = (documentHash = evidenceUnits[0].documentHash) => attestor.attest({
    requestedUrl: 'https://rbi.org.in/public',
    document,
    documentHash,
    evidenceUnits,
    taskId: 'source-attestation-task',
    researchBriefHash: hashResearchBrief(brief),
    executionBindingHash: brief.executionBindingHash,
    researchPolicyVersion: RESEARCH_POLICY_VERSION,
    freshnessRequiredSourceTier: brief.freshnessRequirement.requiredSourceTier,
    jurisdiction: 'IN',
    freshnessMaxAgeHours: 1,
  });
  assert.throws(() => attest('a'.repeat(64)), error => error.code === 'RESEARCH_SOURCE_ATTESTATION_INPUT_INVALID');
  const attestation = attest();
  const expectedSource = {
    canonicalUrl: document.url,
    retrievedAt: observedAt,
    documentHash: evidenceUnits[0].documentHash,
    evidenceBindings: evidenceUnits.map(item => ({ evidenceId: item.evidenceId, supportingExcerptHash: item.supportingExcerptHash })),
  };

  assert.equal(verifyResearchSourceAttestation(attestation, { expectedSource }).valid, false);
  assert.equal(verifyResearchSourceAttestation(attestation, { publicJwk: other.publicJwk, expectedSource }).valid, false);
  assert.equal(verifyResearchSourceAttestation(attestation, { publicJwk, expectedSource, expectedJurisdiction: 'US' }).valid, false);
  assert.equal(verifyResearchSourceAttestation(attestation, {
    publicJwk,
    expectedSource,
    expectedFreshnessMaxAgeHours: 1,
    expectedExecutionBindingHash: hashResearchExecutionBinding({ runId: 'other-run', executionGeneration: 1, traceId: 'other-trace' }),
  }).reason, 'ATTESTATION_EXECUTION_BINDING_MISMATCH');
  assert.equal(verifyResearchSourceAttestation(attestation, {
    publicJwk,
    expectedSource,
    expectedFreshnessMaxAgeHours: 1,
    now: new Date('2026-10-06T14:00:00.000Z'),
    requireFreshFetch: true,
  }).reason, 'ATTESTATION_FETCH_NOT_CURRENT');
  assert.equal(verifyResearchSourceAttestation(attestation, {
    publicJwk,
    expectedSource,
    expectedFreshnessMaxAgeHours: 24,
  }).reason, 'ATTESTATION_FRESHNESS_POLICY_MISMATCH');
});

test('production evaluator verifies source-fetch signatures but keeps publication freshness unverified', () => {
  const { attestor, publicJwk } = keys();
  const sourceUrl = 'https://www.rbi.org.in/Scripts/BS_ViewBulletin.aspx';
  const runId = 'e5b3c13d-03d8-40ed-87d4-ecf1e6c6a90a';
  const traceId = 'trace-source-attestation';
  const brief = makeBrief({ runId, executionGeneration: 2, traceId });
  const document = {
    url: sourceUrl,
    contentType: 'text/html',
    statusCode: 200,
    redirectCount: 0,
    body: 'An RBI source document.',
    retrievedAt: observedAt,
    rawBodySha256: rawBodySha256('An RBI source document.'),
  };
  const evidenceUnits = extractDocumentEvidence({
    document: { url: sourceUrl, body: document.body, retrievedAt: observedAt },
    publisher: new URL(sourceUrl).hostname,
  }).evidenceUnits;
  const taskId = 'research-task-for-evaluator';
  const attestation = attestor.attest({
    requestedUrl: sourceUrl,
    document,
    documentHash: evidenceUnits[0].documentHash,
    evidenceUnits,
    taskId,
    researchBriefHash: hashResearchBrief(brief),
    executionBindingHash: brief.executionBindingHash,
    researchPolicyVersion: RESEARCH_POLICY_VERSION,
    freshnessRequiredSourceTier: brief.freshnessRequirement.requiredSourceTier,
    jurisdiction: 'IN',
    freshnessMaxAgeHours: 24,
  });
  const previous = process.env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK;
  process.env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK = JSON.stringify(publicJwk);
  const sourceBinding = { financialProfileStateRevision: 7 };
  const sourceBindingHash = canonicalSha256(sourceBinding);
  try {
    const result = evaluateProductionAgentRun({
      run: {
        runId,
        userId: '64b000000000000000000010',
        executionGeneration: 2,
        eventSequence: 1,
        status: 'COMPLETED',
        traceId,
        correlationId: 'correlation-source-attestation',
        agentVersion: 'plan-review-agent-2.0.0',
        graphVersion: 'plan-review-graph-1.1.0',
        plannerVersion: 'plan-review-planner-1.0.0',
        policyVersion: 'plan-review-policy-1.0.0',
        toolCatalogVersion: 'plan-review-tools-1.1.0',
        promptScaffoldHash: 'a'.repeat(64),
        sourceBinding,
        planReviewSnapshotHash: sourceBindingHash,
        completedAt: new Date(observedAt),
        trajectory: [],
        toolExecutionLedger: [],
        toolCallCount: 0,
        result: {
          recommendedAction: 'NONE',
          summary: '',
          evidence: {
            status: 'AVAILABLE',
            entries: [{
              kind: 'PUBLIC_RESEARCH_CLAIM',
              dataClass: 'VERIFIED_PUBLIC_RESEARCH',
              observedAt,
              value: { taskId, researchBriefHash: hashResearchBrief(brief) },
              source: {
                provider: 'rbi.org.in',
                url: sourceUrl,
                jurisdiction: 'IN',
                retrievedAt: observedAt,
                documentHash: evidenceUnits[0].documentHash,
                sourceTrustTier: 'OFFICIAL_PRIMARY',
                publicationDate: null,
                evidenceBinding: { evidenceId: evidenceUnits[0].evidenceId, supportingExcerptHash: evidenceUnits[0].supportingExcerptHash },
                fetchAttestation: attestation,
              },
            }],
          },
        },
      },
      afterStateBinding: {
        planReviewSnapshotHash: sourceBindingHash,
        sourceBinding,
      },
      durableEvents: [{
        runId: 'e5b3c13d-03d8-40ed-87d4-ecf1e6c6a90a',
        userId: '64b000000000000000000010',
        executionGeneration: 2,
        sequence: 1,
        eventType: 'RUN_COMPLETED',
      }],
      baselineVersion: 'baseline-source-attestation-test',
      evaluatedAt: new Date(observedAt),
      buildProvenance: null,
    });
    assert.equal(result.hardGateResults.sourceFetchAttestation.passed, true);
    assert.equal(result.evidenceManifest.sourceFetchAttestationCount, 1);
    assert.match(result.evidenceManifest.sourceFetchAttestationHash, /^[a-f0-9]{64}$/);
    assert.equal(result.hardGateResults.sourceFreshnessAndJurisdiction.passed, false);
    assert.equal(result.hardGateResults.sourceFreshnessAndJurisdiction.reason, 'SOURCE_PUBLICATION_FRESHNESS_UNVERIFIED');
  } finally {
    if (previous === undefined) delete process.env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK;
    else process.env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK = previous;
  }
});
