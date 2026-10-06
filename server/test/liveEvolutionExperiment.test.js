import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveGepaProposalOptions, buildLiveOptimizerCases } from '../agents/evolution/liveExperimentCases.js';
import { createGepaBridgeInput } from '../agents/evolution/gepaBridge.js';
import { CURRENT_PROMPT_BUNDLE } from '../agents/evolution/promptBundle.js';
import { createLiveCandidatePlanner } from '../agents/evolution/liveCandidatePlanner.js';
import { createPlanReviewScaffoldRunner } from '../agents/evolution/scaffoldEvolution.js';
import { createScaffoldSpec } from '../agents/evolution/scaffoldSpec.js';

const profile = { riskTolerance: 'Moderate', investmentGoals: ['Wealth Growth'] };
const context = { profile, profileContext: { riskTolerance: 'Moderate' }, freshness: { fresh: true, reasonCodes: [] } };

test('live GEPA optimizer fixtures never duplicate train as validation or expose a holdout partition', () => {
  const context = { profile: { riskTolerance: 'Moderate' } };
  const cases = buildLiveOptimizerCases({ userId: 'user-1', profileId: 'profile-1', context });
  assert.deepEqual(cases.map(item => item.partition), ['train']);
  assert.ok(cases.every(item => item.fixture.context === context));
  assert.throws(() => buildLiveGepaProposalOptions({ cases }), { code: 'LIVE_OPTIMIZER_PARTITIONS_NOT_INDEPENDENT' });
  assert.throws(() => buildLiveGepaProposalOptions({ cases: [
    { ...cases[0], fixture: { ...cases[0].fixture, context } },
    { ...cases[0], id: 'fake-validation', partition: 'validation', fixture: { ...cases[0].fixture, context } },
  ] }), { code: 'LIVE_OPTIMIZER_PARTITIONS_NOT_INDEPENDENT' });
  const independent = buildLiveOptimizerCases({
    userId: 'user-1', profileId: 'profile-1', context,
    validationContext: { profile: { riskTolerance: 'Conservative' } },
  });
  assert.deepEqual(independent.map(item => item.partition), ['train', 'validation']);
  assert.notEqual(independent[0].fixture.context, independent[1].fixture.context);
});

test('live candidate planner sends the candidate prompt to a real bounded PLANNER gateway', async () => {
  const calls = [];
  const planner = createLiveCandidatePlanner({
    maxCalls: 2,
    maxOutputTokens: 128,
    modelGateway: { generate: async args => { calls.push(args); return { text: '{"checks":["get_current_profile_context"]}' }; } },
  });
  const response = await planner.generate({ systemPrompt: 'candidate-specific instruction', maxTokens: 1000 });
  assert.equal(response.text, '{"checks":["get_current_profile_context"]}');
  assert.equal(calls[0].role, 'PLANNER');
  assert.equal(calls[0].systemPrompt, 'candidate-specific instruction');
  assert.equal(calls[0].maxTokens, 128);
});

test('live candidate planner rejects missing model responses and enforces an aggregate call cap', async () => {
  const missing = createLiveCandidatePlanner({ modelGateway: { generate: async () => ({ text: null }) } });
  await assert.rejects(() => missing.generate({ systemPrompt: 'candidate' }), { code: 'EVOLUTION_PLANNER_REQUIRED' });

  const capped = createLiveCandidatePlanner({ maxCalls: 1, modelGateway: { generate: async () => ({ text: 'ok' }) } });
  await capped.generate({ systemPrompt: 'candidate' });
  await assert.rejects(() => capped.generate({ systemPrompt: 'candidate' }), { code: 'EVOLUTION_PLANNER_REQUIRED' });
});

test('strict live candidate runner fails instead of scoring deterministic planner fallback', async () => {
  const runner = createPlanReviewScaffoldRunner({ dependencies: {
    captureFinancialAuthority: async () => ({ authorityMeasurementState: 'SIMULATED' }),
    plannerProvider: { generate: async () => ({ text: null }) },
    strictModelPlanner: true,
    loadPlanReviewContext: async () => context,
    explanationProviders: [],
    persistAgentRun: async () => undefined,
  } });
  await assert.rejects(() => runner({
    candidate: createScaffoldSpec({ version: 'strict-live-candidate' }),
    caseDefinition: { fixture: { userId: 'user-1', profileId: 'profile-1', context } },
  }), { code: 'EVOLUTION_PLANNER_REQUIRED' });
});


test('live GEPA proposal options pass the trusted bridge without fabricated feedback', () => {
  const independentCases = buildLiveOptimizerCases({
    userId: 'user-1', profileId: 'profile-1', context,
    validationContext: { ...context, freshness: { fresh: false, reasonCodes: ['PROFILE_CHANGED'] } },
  });
  const options = buildLiveGepaProposalOptions({ cases: independentCases, maxCandidates: 2, optimizerConfig: { provider: 'fixture' } });
  const bridge = createGepaBridgeInput({ basePromptBundle: CURRENT_PROMPT_BUNDLE, ...options });
  assert.deepEqual(bridge.failureFeedback, []);
  assert.deepEqual(bridge.failureFeedbackProvenance, []);
  assert.deepEqual(bridge.trainCases.map(item => item.partition), ['train']);
  assert.deepEqual(bridge.validationCases.map(item => item.partition), ['validation']);
});
