import 'dotenv/config';
import { runLivePlanReviewEvaluations } from '../agents/evals/livePlanReviewEvals.js';

if (process.env.RUN_AGENT_LIVE_EVALS !== 'true') {
  process.stdout.write(`${JSON.stringify({ enabled: false, reason: 'RUN_AGENT_LIVE_EVALS is not true' })}\n`);
} else {
  const providerName = String(process.env.LLM_PRIMARY_PROVIDER || 'NVIDIA_NIM').trim().toUpperCase();
  const requiredKey = {
    NVIDIA_NIM: 'NVIDIA_API_KEY',
    GEMINI: 'GEMINI_API_KEY',
    GROQ: 'GROQ_API_KEY',
  }[providerName];

  if (!requiredKey) {
    process.stderr.write(`${JSON.stringify({ enabled: true, code: 'LIVE_EVAL_PROVIDER_UNSUPPORTED' })}\n`);
    process.exitCode = 2;
  } else if (!process.env[requiredKey]) {
    process.stderr.write(`${JSON.stringify({ enabled: true, code: 'LIVE_EVAL_PROVIDER_NOT_CONFIGURED' })}\n`);
    process.exitCode = 2;
  } else {
    try {
      const [{ ProviderManager }, { loadPlanReviewDataset }, { runIsolatedPlanReviewCase }] = await Promise.all([
        import('../services/providerAbstraction.js'),
        import('../agents/evals/planReviewEvals.js'),
        import('../agents/evals/isolatedPlanReviewRunner.js'),
      ]);
      const provider = {
        NVIDIA_NIM: ProviderManager.nvidia,
        GEMINI: ProviderManager.gemini,
        GROQ: ProviderManager.groq,
      }[providerName];
      if (!provider?.isConfigured()) {
        process.stderr.write(`${JSON.stringify({ enabled: true, code: 'LIVE_EVAL_PROVIDER_NOT_CONFIGURED' })}\n`);
        process.exitCode = 2;
      } else {
      const dataset = await loadPlanReviewDataset();
      const report = await runLivePlanReviewEvaluations({
        dataset,
        runner: ({ caseDefinition }) => runIsolatedPlanReviewCase({ caseDefinition, provider }),
      });
      process.stdout.write(`${JSON.stringify(report)}\n`);
      }
    } catch (error) {
      // Do not print provider error objects, prompts, profile fixtures, or
      // credentials. The code is enough to identify a safe next step.
      process.stderr.write(`${JSON.stringify({
        enabled: true,
        code: error?.code || 'LIVE_EVAL_FAILED',
        failedCases: error?.caseFailures?.map(item => item.caseId) || [],
        failedMetrics: error?.thresholdFailures?.map(item => item.metric) || [],
      })}\n`);
      process.exitCode = 1;
    }
  }
}
