import { ProviderManager } from '../services/providerAbstraction.js';
import { loadPlanReviewDataset } from '../agents/evals/planReviewEvals.js';
import { runLivePlanReviewEvaluations } from '../agents/evals/livePlanReviewEvals.js';

if (process.env.RUN_AGENT_LIVE_EVALS !== 'true') {
  console.log(JSON.stringify({ enabled: false, reason: 'RUN_AGENT_LIVE_EVALS is not true' }));
  process.exit(0);
}

const configured = String(process.env.LLM_PRIMARY_PROVIDER || 'NVIDIA_NIM').toUpperCase();
const provider = { NVIDIA_NIM: ProviderManager.nvidia, GEMINI: ProviderManager.gemini, GROQ: ProviderManager.groq }[configured];
const dataset = await loadPlanReviewDataset();
const report = await runLivePlanReviewEvaluations({
  dataset,
  provider,
  maxCases: Number(process.env.AGENT_LIVE_EVAL_MAX_CASES) || 3,
});
console.log(JSON.stringify(report, null, 2));
