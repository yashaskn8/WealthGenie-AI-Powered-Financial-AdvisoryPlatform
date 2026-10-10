import 'dotenv/config';
import { runLivePlanReviewEvaluations, selectLivePlanReviewCases } from '../agents/evals/livePlanReviewEvals.js';

if (process.env.RUN_AGENT_LIVE_EVALS !== 'true') {
  process.stdout.write(`${JSON.stringify({ enabled: false, reason: 'RUN_AGENT_LIVE_EVALS is not true' })}\n`);
} else {
  const providerName = String(process.env.LLM_PRIMARY_PROVIDER || 'GROQ').trim().toUpperCase();
  const requiredKey = {
    NVIDIA_NIM: 'NVIDIA_API_KEY',
    GEMINI: 'GEMINI_API_KEY',
    GROQ: 'GROQ_API_KEY',
  }[providerName];

  if (!requiredKey) {
    process.stderr.write(`${JSON.stringify({ enabled: true, code: 'LIVE_EVAL_PROVIDER_UNSUPPORTED' })}\n`);
    process.exitCode = 2;
  } else if (requiredKey && !process.env[requiredKey]) {
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
        const loadedDataset = await loadPlanReviewDataset();
        const requestedCaseId = String(process.env.PLAN_REVIEW_LIVE_EVAL_CASE_ID || '').trim() || null;
        const dataset = selectLivePlanReviewCases(loadedDataset, requestedCaseId);
        const report = await runLivePlanReviewEvaluations({
          dataset,
          ...(requestedCaseId ? { maxCases: 1 } : {}),
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
        caseCounts: error?.caseCounts || null,
        totalProviderCalls: Number.isSafeInteger(error?.totalProviderCalls) ? error.totalProviderCalls : null,
        totalReportedTokens: Number.isSafeInteger(error?.totalReportedTokens) ? error.totalReportedTokens : null,
        reportedTokensComplete: typeof error?.reportedTokensComplete === 'boolean' ? error.reportedTokensComplete : null,
        aggregate: error?.aggregate || null,
        cases: Array.isArray(error?.cases) ? error.cases : [],
      })}\n`);
      process.exitCode = 1;
    }
  }
}
