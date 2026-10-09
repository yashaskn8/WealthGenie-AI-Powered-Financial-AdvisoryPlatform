import { assertPlanReviewGates, gradePlanReviewTrajectory, loadPlanReviewDataset } from '../agents/evals/planReviewEvals.js';
import { runIsolatedPlanReviewCase } from '../agents/evals/isolatedPlanReviewRunner.js';

try {
  const dataset = await loadPlanReviewDataset();
  if (!Array.isArray(dataset) || dataset.length === 0) {
    throw Object.assign(new Error('The deterministic PlanReview evaluation dataset is empty or invalid.'), { code: 'AGENT_EVAL_DATASET_INVALID' });
  }

  const evaluatedCases = [];
  for (const caseDefinition of dataset) {
    const execution = await runIsolatedPlanReviewCase({ caseDefinition });
    if (execution.providerUsage.providerCalls !== 0) {
      throw Object.assign(new Error('Offline evaluation unexpectedly attempted a provider call.'), { code: 'AGENT_EVAL_EXTERNAL_PROVIDER_CALL' });
    }
    const scorecard = gradePlanReviewTrajectory({
      caseDefinition,
      result: execution.result,
      trajectory: execution.trajectory,
    });
    evaluatedCases.push({
      caseId: caseDefinition.id,
      passed: scorecard.passed,
      action: execution.result.review?.recommendedAction || null,
      executedTools: execution.trajectory
        .filter(event => event?.type === 'TOOL_SUCCEEDED')
        .map(event => event.tool),
      scorecard,
      latencyMs: execution.latencyMs,
    });
  }

  const gate = assertPlanReviewGates(evaluatedCases.map(item => item.scorecard));
  process.stdout.write(`${JSON.stringify({
    enabled: true,
    mode: 'DETERMINISTIC_SYNTHETIC_PRODUCTION_GRAPH',
    persisted: false,
    externalProviderCalls: 0,
    cases: evaluatedCases,
    summary: gate,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    enabled: true,
    passed: false,
    code: error?.code || 'AGENT_EVAL_FAILED',
    cases: error?.failures || [],
  })}\n`);
  process.exitCode = 1;
}
