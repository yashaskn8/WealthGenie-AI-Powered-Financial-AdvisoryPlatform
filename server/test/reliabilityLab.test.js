import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FaultInjector,
  RELIABILITY_SCENARIOS,
  VirtualClock,
  createConstraintRegistry,
  createReliabilityHoldoutManifest,
  createTrajectoryIR,
  evaluateReliabilityHoldout,
  getReliabilityScenario,
  renderReliabilityPrometheus,
  replayTrajectory,
  runCounterfactual,
  runReliabilityScenario,
  runReliabilitySuite,
  assertReliabilityHoldoutIsolation,
  assertReliabilityPromotionSafe,
  assertDeterministicReplay,
  buildReliabilityBenchmark,
  buildReliabilityPromotionEvaluation,
  durationBucket,
  validateScenario,
} from '../agents/reliability/index.js';

test('reliability scenarios use a strict non-executable DSL', () => {
  assert.throws(() => validateScenario({ ...RELIABILITY_SCENARIOS[0], script: 'process.exit(1)' }), /Executable scenario field rejected|unknown/i);
  assert.throws(() => validateScenario({ ...RELIABILITY_SCENARIOS[0], actions: [{ atHours: 0, action: 'SUBMIT_TASK', code: 'x' }] }), /unknown|Executable/i);
  assert.throws(() => validateScenario({ ...RELIABILITY_SCENARIOS[0], actions: [{ atHours: 0, action: 'NOT_AN_ACTION' }] }), /one of|valid/i);
});

test('trajectory IR normalizes production-shaped events without private data', () => {
  const trajectory = createTrajectoryIR({ scenarioId: 'privacy', events: [{ eventType: 'NODE_ENTERED', runId: 'run-1', data: { email: 'private@example.com', safe: 'value' } }] });
  assert.equal(trajectory.events[0].kind, 'NODE_ENTERED');
  assert.equal(trajectory.events[0].data.email, undefined);
  assert.equal(trajectory.events[0].data.safe, 'value');
  assert.match(trajectory.contentHash, /^[a-f0-9]{64}$/);
});

test('virtual time advances long horizons without sleeping', () => {
  const clock = new VirtualClock('2026-01-01T00:00:00.000Z');
  let fired = false;
  clock.schedule(8760 * 3600000, () => { fired = true; }, 'annual-monitor');
  clock.advanceBy(8760);
  assert.equal(fired, true);
  assert.equal(clock.now().toISOString(), '2027-01-01T00:00:00.000Z');
});

test('fault injection is unavailable in production and requires explicit test mode', () => {
  assert.throws(() => new FaultInjector({ enabled: true, environment: 'production' }), /production/i);
  assert.throws(() => new FaultInjector({ enabled: true, environment: 'development' }), /test|evaluation/i);
  const faults = new FaultInjector({ enabled: true, environment: 'test', faults: [{ action: 'PROVIDER_REQUEST', code: 'TEST_TIMEOUT' }] });
  assert.equal(faults.consume('PROVIDER_REQUEST'), 'TEST_TIMEOUT');
  assert.equal(faults.consume('PROVIDER_REQUEST'), null);
  assert.equal(faults.availableInProduction(), false);
});

test('all long-horizon reliability families pass authority and outcome gates', () => {
  const suite = runReliabilitySuite(RELIABILITY_SCENARIOS);
  assert.equal(suite.passed, true);
  assert.equal(suite.scorecards.length, RELIABILITY_SCENARIOS.length);
  assert.ok(suite.scorecards.every(card => card.authorityDelta === 0 && card.hardGatePassed));
});

test('provider outage retries and recovers without completing twice', () => {
  const result = runReliabilityScenario(getReliabilityScenario('provider-outage-retry'));
  assert.equal(result.outcomeGrade.passed, true);
  assert.equal(result.environment.provider.retries, 1);
  assert.equal(result.environment.task.state, 'COMPLETED');
  assert.equal(result.trajectory.events.filter(event => event.kind === 'TASK_COMPLETED').length, 1);
});

test('stale worker, duplicate queue, and cancellation are observable hard-boundary events', () => {
  const stale = runReliabilityScenario(getReliabilityScenario('stale-worker-write'));
  const duplicate = runReliabilityScenario(getReliabilityScenario('duplicate-queue'));
  const canceled = runReliabilityScenario(getReliabilityScenario('a2a-duplicate-cancel'));
  assert.equal(stale.environment.worker.staleWritesRejected, 1);
  assert.equal(duplicate.environment.task.duplicateCount, 1);
  assert.equal(canceled.environment.task.state, 'CANCELED');
  assert.equal(canceled.environment.cancellation.propagated, true);
});

test('plan health reacts after virtual time and does not invent actions while idle', () => {
  const result = runReliabilityScenario(getReliabilityScenario('long-idle-monitoring'));
  assert.equal(result.outcomeGrade.passed, true);
  assert.equal(result.metrics.taskReactionHours, 8759);
  assert.equal(result.metrics.unnecessaryActions, 0);
});

test('counterfactual replay preserves original trajectory and cannot alter authority', () => {
  const original = runReliabilityScenario(getReliabilityScenario('healthy-review'));
  const replay = replayTrajectory(original);
  const counterfactual = runCounterfactual(original, getReliabilityScenario('cancellation-race'));
  assert.notEqual(replay.contentHash, original.trajectory.contentHash);
  assert.equal(original.environment.authorityDelta, 0);
  assert.equal(counterfactual.replayOf, original.trajectory.contentHash);
  assert.equal(counterfactual.environment.authorityDelta, 0);
});

test('holdout exposes aggregate gates but not answer keys', () => {
  const holdout = [getReliabilityScenario('healthy-review'), getReliabilityScenario('crash-after-commit')];
  const manifest = createReliabilityHoldoutManifest({ scenarios: holdout });
  const aggregate = evaluateReliabilityHoldout({ scenarios: holdout, runner: scenario => runReliabilityScenario(scenario) });
  assert.equal(manifest.sealed, true);
  assert.equal(aggregate.passed, true);
  assert.equal(aggregate.authorityDelta, 0);
  assert.doesNotThrow(() => assertReliabilityHoldoutIsolation(aggregate));
  assert.throws(() => assertReliabilityHoldoutIsolation({ scenarios: [{ partition: 'holdout', answerKey: 'secret' }] }), /sealed|leak/i);
});

test('reliability metrics are Prometheus-compatible and bounded', () => {
  const suite = runReliabilitySuite(RELIABILITY_SCENARIOS.slice(0, 3));
  const output = renderReliabilityPrometheus(suite.metrics);
  assert.match(output, /wealthgenie_reliability_scenarios_total 3/);
  assert.match(output, /wealthgenie_reliability_authority_delta_total 0/);
  assert.ok(suite.metrics.every(item => item.eventCount < 2000));
});

test('constraint registry marks non-applicable checks instead of hiding them', () => {
  const result = runReliabilityScenario(getReliabilityScenario('healthy-review'), { constraintRegistry: createConstraintRegistry() });
  const promptConstraint = result.constraints.find(item => item.id === 'prompt-injection-contained');
  assert.deepEqual(promptConstraint.evidence, { applicability: 'NOT_APPLICABLE' });
  assert.equal(result.processGrade.passed, true);
});

test('evolution promotion consumes aggregate reliability gates and remains production-inert', () => {
  const suite = runReliabilitySuite(RELIABILITY_SCENARIOS.slice(0, 3));
  const holdout = evaluateReliabilityHoldout({ scenarios: RELIABILITY_SCENARIOS.slice(3, 5), runner: scenario => runReliabilityScenario(scenario) });
  const evaluation = buildReliabilityPromotionEvaluation({ scorecards: suite.scorecards, holdout });
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.financialAuthorityDelta, 0);
  assert.equal(evaluation.appliedToProduction, false);
  assert.doesNotThrow(() => assertReliabilityPromotionSafe(evaluation));
  assert.throws(() => assertReliabilityPromotionSafe({ ...evaluation, financialAuthorityDelta: 1 }), /failed closed/i);
});

test('benchmark reports length buckets and deterministic replay metrics', () => {
  const short = runReliabilityScenario(getReliabilityScenario('healthy-review'));
  const long = runReliabilityScenario(getReliabilityScenario('long-idle-monitoring'));
  const repeated = runReliabilityScenario(getReliabilityScenario('healthy-review'));
  const benchmark = buildReliabilityBenchmark([short, long]);
  assert.equal(durationBucket(short.metrics.virtualDurationHours), 'SHORT');
  assert.equal(durationBucket(long.metrics.virtualDurationHours), 'LONG');
  assert.equal(benchmark.buckets.SHORT.total, 1);
  assert.equal(benchmark.buckets.LONG.total, 1);
  assert.equal(benchmark.authorityDelta, 0);
  assert.doesNotThrow(() => assertDeterministicReplay(short, repeated));
});
