import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_PROMPT_BUNDLE } from '../agents/evolution/promptBundle.js';
import { createGepaBridgeInput, runGepaProposalBridge } from '../agents/evolution/gepaBridge.js';

const bridgeOptions = {
  basePromptBundle: CURRENT_PROMPT_BUNDLE,
  allowedMutationSurfaces: ['promptBundle.plannerInstruction'],
  trainCases: [{ id: 'train-1', expectedAction: 'bounded', question: 'Use a bounded read-only review.' }],
  validationCases: [{ id: 'validation-1', expectedAction: 'bounded', question: 'Use a bounded read-only review.' }],
  failureFeedback: ['grounding passed; no duplicate evidence call'],
  budget: { maxCandidates: 1, maxMetricCalls: 1 },
  optimizerConfig: { provider: 'fixture' },
  pythonWorkingDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ml-service'),
};

test('GEPA Node/Python bridge runs the deterministic provider and revalidates proposals', async () => {
  const input = createGepaBridgeInput(bridgeOptions);
  assert.equal(input.optimizer.provider, 'fixture');
  assert.equal(input.trainCases[0].partition, 'train');
  assert.equal(input.validationCases[0].partition, 'validation');
  assert.equal(Object.hasOwn(input, 'holdoutCases'), false);

  const proposals = await runGepaProposalBridge(bridgeOptions);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].parentPromptBundleHash, CURRENT_PROMPT_BUNDLE.contentHash);
  assert.equal(proposals[0].promptBundle.metadata.source, 'gepa');
  assert.match(proposals[0].promptBundle.plannerInstruction, /minimum safe read-only/);
});

test('GEPA bridge rejects private or sealed optimizer inputs', () => {
  assert.throws(() => createGepaBridgeInput({
    ...bridgeOptions,
    trainCases: [{ id: 'train-private', partition: 'train', question: 'email is not allowed' }],
  }), /private|sealed/i);
  assert.throws(() => createGepaBridgeInput({
    ...bridgeOptions,
    validationCases: [{ id: 'holdout', partition: 'holdout', question: 'bounded' }],
  }), /train or validation|holdout/i);
});
