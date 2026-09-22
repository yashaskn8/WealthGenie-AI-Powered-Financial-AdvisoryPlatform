import { performance } from 'node:perf_hooks';
import { generateGroundedExplanation } from '../../services/groundedExplanationService.js';
import { planWithProvider } from '../planReview/planReviewGraph.js';
import {
  PLAN_REVIEW_AGENT_VERSION,
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_GROUNDING_VERSION,
  PLAN_REVIEW_TOOL_CATALOG_VERSION,
} from '../planReview/planReviewRuntime.js';
import { PLAN_REVIEW_POLICY_VERSION } from '../planReview/planReviewSchemas.js';

const LIVE_EVAL_MAX_CASES = 3;
const LIVE_EVAL_MAX_TOKENS = 2500;

const SYNTHETIC_EVIDENCE = Object.freeze({
  evidenceHash: 'live-eval-synthetic-evidence-v1',
  entries: [
    { id: 'E_PLAN_STATE', kind: 'RECOMMENDATION', dataClass: 'DERIVED_VALUE', displayValue: 'Synthetic fixture plan evidence is available.', authority: 'WealthGenie synthetic evaluation fixture' },
    { id: 'E_REGULATORY_NOTICE', kind: 'REGULATORY', dataClass: 'POLICY_METADATA', value: 'This is a synthetic evaluation; no production financial decision is being made.', displayValue: 'Synthetic evaluation only; no production financial decision is being made.', authority: 'WealthGenie evaluation harness' },
  ],
  unavailableFacts: [],
});

export async function runLivePlanReviewEvaluations({ dataset, provider, maxCases = LIVE_EVAL_MAX_CASES, runner = null } = {}) {
  if (!provider || typeof provider.generate !== 'function') throw new Error('A configured live evaluation provider is required.');
  if (typeof runner !== 'function') {
    const error = new Error('A real closed-loop live evaluator is required; expected actions cannot be echoed as results.');
    error.code = 'LIVE_EVAL_RUNNER_REQUIRED';
    throw error;
  }
  const cases = (dataset || []).slice(0, Math.min(LIVE_EVAL_MAX_CASES, Math.max(1, Number(maxCases) || LIVE_EVAL_MAX_CASES)));
  const results = [];
  for (const caseDefinition of cases) {
    const startedAt = performance.now();
    const planner = await planWithProvider({
      freshness: { reasonCodes: caseDefinition.requiredReasonCodes || [] },
      profileContext: { syntheticFixture: true },
      provider,
    });
    const explanation = await generateGroundedExplanation({
      question: 'Review synthetic fixture evidence only. Do not make a recommendation or calculate a financial result.',
      evidencePacket: SYNTHETIC_EVIDENCE,
    }, {
      providers: [provider],
      getCache: async () => null,
      setCache: async () => undefined,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const tokens = Number(explanation.tokensUsed || 0);
    if (tokens > LIVE_EVAL_MAX_TOKENS) throw new Error(`Live evaluation token budget exceeded for ${caseDefinition.id}`);
    const actual = await runner({ caseDefinition, provider });
    const actualTrajectory = actual?.trajectory || [];
    const actualAction = actual?.result?.review?.recommendedAction || actual?.result?.recommendedAction || null;
    results.push({
      caseId: caseDefinition.id,
      toolChoices: planner?.checks || [],
      forbiddenToolRequests: actualTrajectory.filter(event => event?.type === 'TOOL_SUCCEEDED' && caseDefinition.forbiddenTools.includes(event.tool)).map(event => event.tool),
      finalAction: actualAction,
      grounding: actual?.result?.validation?.valid === true || explanation.validation?.status === 'PASS',
      unsupportedNumericalClaims: actual?.result?.validation?.valid === false,
      policyRejected: actual?.result?.policy?.allowed === false,
      fallback: Boolean(explanation.fallback || planner?.fallback),
      latencyMs,
      tokens,
    });
  }
  return {
    enabled: true,
    provider: provider.name || 'configured-provider',
    model: provider.configuredModel?.() || null,
    agentVersion: PLAN_REVIEW_AGENT_VERSION,
    graphVersion: PLAN_REVIEW_GRAPH_VERSION,
    groundingVersion: PLAN_REVIEW_GROUNDING_VERSION,
    toolCatalogVersion: PLAN_REVIEW_TOOL_CATALOG_VERSION,
    policyVersion: PLAN_REVIEW_POLICY_VERSION,
    cases: results,
    thresholds: {
      maxCases: LIVE_EVAL_MAX_CASES,
      maxTokens: LIVE_EVAL_MAX_TOKENS,
      forbiddenToolRate: 0,
      groundingFailureRate: 0,
      unsupportedNumericalClaimRate: 0,
    },
    aggregate: {
      forbiddenToolRate: results.length ? results.filter(item => item.forbiddenToolRequests.length > 0).length / results.length : 0,
      groundingFailureRate: results.length ? results.filter(item => !item.grounding).length / results.length : 0,
      unsupportedNumericalClaimRate: results.length ? results.filter(item => item.unsupportedNumericalClaims).length / results.length : 0,
      fallbackRate: results.length ? results.filter(item => item.fallback).length / results.length : 0,
    },
  };
}
