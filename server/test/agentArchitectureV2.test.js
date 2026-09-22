import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAgentAttributes } from '../agents/observability/agentTelemetry.js';
import {
  assertHoldoutIsolation,
  buildCandidateScoreCard,
  createEvaluationManifest,
  evaluateHoldoutCandidate,
  hashEvaluationData,
} from '../agents/evals/evaluationV2.js';
import { createScaffoldSpec, ScaffoldRegistry } from '../agents/evolution/scaffoldSpec.js';
import { mineFailureClusters, sanitizeTrajectory } from '../agents/evolution/trajectoryMiner.js';
import { createOfflineEvolutionRun } from '../agents/evolution/scaffoldEvolution.js';
import { createSandboxProvider } from '../agents/evolution/sandboxProvider.js';
import { createMetaImprovementPlanner } from '../agents/evolution/metaImprovement.js';
import { verifyEvidencePacket } from '../agents/a2a/evidenceVerifier.js';
import { buildPlanReviewA2UI, validateA2UIMessage } from '../agents/a2ui/a2uiSchemas.js';
import { assertAgentCapability, createAgentIdentity } from '../agents/identity/agentIdentity.js';
import { createAgentWorkflowBackend } from '../agents/workflows/agentWorkflowBackend.js';
import { buildPromotionMandate, createPromotionAuthorization } from '../agents/evolution/promotionAuthorization.js';

test('agent telemetry only permits bounded non-sensitive semantic attributes', () => {
  const safe = sanitizeAgentAttributes({
    'agent.type': 'PLAN_REVIEW',
    'agent.step_count': 3,
    'agent.run_id': 'run-opaque',
    'profile.monthlyTakeHome': 100000,
    'gen_ai.request.model': 'test-model',
    'gen_ai.request.prompt': 'secret prompt',
  });
  assert.deepEqual(safe, {
    'agent.type': 'PLAN_REVIEW',
    'agent.step_count': 3,
    'agent.run_id': 'run-opaque',
    'gen_ai.request.model': 'test-model',
  });
});

test('evaluation v2 seals holdout and enforces financial authority delta zero', () => {
  const cases = [
    { id: 'train-1', partition: 'train', expectedAction: 'NONE' },
    { id: 'validation-1', partition: 'validation', expectedAction: 'NONE' },
    { id: 'holdout-1', partition: 'holdout', expectedAction: 'NONE' },
  ];
  const manifest = createEvaluationManifest({ cases, datasetVersion: 'dataset-1' });
  assert.equal(manifest.counts.holdout, 1);
  assert.match(hashEvaluationData(cases), /^[a-f0-9]{64}$/);
  assert.throws(() => assertHoldoutIsolation(cases), /Holdout/);
  const passed = buildCandidateScoreCard({ candidateId: 'candidate-a', partition: 'validation', caseDefinition: cases[1], result: { recommendedAction: 'NONE', financialAuthorityDelta: 0 } });
  assert.equal(passed.passed, true);
  const failed = buildCandidateScoreCard({ candidateId: 'candidate-b', partition: 'validation', caseDefinition: cases[1], result: { recommendedAction: 'NONE', financialAuthorityDelta: 1 } });
  assert.equal(failed.hardGatePassed, false);
  const holdout = evaluateHoldoutCandidate({ candidateId: 'candidate-a', cases: [cases[2]], evaluator: () => ({ result: { recommendedAction: 'NONE', financialAuthorityDelta: 0 }, trajectory: [] }) });
  assert.equal(holdout.passed, true);
});

test('scaffold registry is immutable, read-only, and human-promotion gated', async () => {
  const base = createScaffoldSpec({ scaffoldId: 'plan-review', version: '1.0.0' });
  assert.ok(Object.isFrozen(base));
  assert.throws(() => createScaffoldSpec({ code: 'process.exit(1)' }), /executable|field/i);
  assert.throws(() => createScaffoldSpec({ allocationWeights: { Equity: 100 } }), /field/i);
  const registry = new ScaffoldRegistry();
  registry.register(base);
  const candidate = createScaffoldSpec({ scaffoldId: 'plan-review', version: '1.1.0', parentVersion: '1.0.0' });
  registry.register(candidate, { source: 'offline-evolution' });
  assert.throws(() => registry.promote('plan-review', '1.1.0', { evaluation: { passed: true } }), /approval/i);
  const evaluation = { passed: true, scoreCards: [{ hardGatePassed: true }] };
  const promotionMandate = buildPromotionMandate({ candidate, evaluation, reviewerId: 'reviewer' });
  const authorization = await createPromotionAuthorization({
    candidate,
    evaluation,
    reviewerId: 'reviewer',
    mandate: { ...promotionMandate, mandateHash: 'mandate-hash-1' },
    assertion: { credentialId: 'credential-1' },
    approvalProvider: { verify: async () => ({ verified: true, method: 'WEBAUTHN', approvalId: 'approval-1', credentialId: 'credential-1' }) },
  });
  registry.promote('plan-review', '1.1.0', { authorization, evaluation });
  assert.equal(registry.current().spec.version, '1.1.0');
});

test('offline evolution never consumes holdout and trajectory mining excludes raw content', () => {
  const base = createScaffoldSpec({ scaffoldId: 'plan-review', version: '1.0.0' });
  const result = createOfflineEvolutionRun({
    baseSpec: base,
    enabled: true,
    cases: [
      { partition: 'train', expectedAction: 'NONE', result: { recommendedAction: 'NONE', financialAuthorityDelta: 0 } },
      { partition: 'validation', expectedAction: 'NONE', result: { recommendedAction: 'NONE', financialAuthorityDelta: 0 } },
      { partition: 'holdout', expectedAction: 'NONE', result: { recommendedAction: 'NONE', financialAuthorityDelta: 1 } },
    ],
  });
  assert.equal(result.holdoutSealed, true);
  assert.equal(result.evaluation.scoreCards.length, 2);
  const events = sanitizeTrajectory([{ type: 'TOOL_FAILED', node: 'execute_safe_tools', code: 'TOOL_TIMEOUT', value: 'sensitive' }]);
  assert.equal(events[0].value, undefined);
  assert.equal(mineFailureClusters({ trajectories: [events] }).length, 1);
});

test('A2A verifier and A2UI renderer contracts are allowlisted', () => {
  const review = { status: 'COMPLETED', findings: [{ code: 'EVIDENCE_UNAVAILABLE', message: 'Evidence unavailable', evidenceIds: ['E_1'] }], recommendedAction: 'INSUFFICIENT_EVIDENCE', evidence: { entries: [{ id: 'E_1' }] } };
  const verification = verifyEvidencePacket({ review, evidencePacket: { entries: [{ id: 'E_1' }] } });
  assert.equal(verification.valid, true);
  const ui = buildPlanReviewA2UI(review);
  assert.doesNotThrow(() => validateA2UIMessage(ui));
  assert.throws(() => validateA2UIMessage({ ...ui, components: [...ui.components, { id: 'a2ui_bad', type: 'html', intent: 'plan_review_status' }] }), /unsupported/i);
});

test('agent identity, workflow, sandbox, and research defaults fail closed', async () => {
  const identity = createAgentIdentity({ agentType: 'PLAN_REVIEW', provider: 'development', env: { NODE_ENV: 'test' } });
  assert.doesNotThrow(() => assertAgentCapability(identity, 'read_evidence'));
  assert.throws(() => assertAgentCapability(identity, 'run_offline_evaluation'), /denied/i);
  assert.equal(createAgentWorkflowBackend().name, 'mongo');
  const temporal = createAgentWorkflowBackend({ backend: 'temporal' });
  assert.equal(temporal.available, false);
  const sandbox = createSandboxProvider();
  await assert.rejects(() => sandbox.run(), /disabled/i);
  await assert.rejects(() => createMetaImprovementPlanner().propose(), /disabled/i);
});
