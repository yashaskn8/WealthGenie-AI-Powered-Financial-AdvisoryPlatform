import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { getCurrentRegulatoryRuleVersion } from '../../services/taxEngine.js';
import { buildRecommendationProfileHash, RECOMMENDATION_POLICY_VERSION } from '../../services/recommendationProfile.js';
import { invokePlanReviewGraph } from '../planReview/planReviewGraph.js';
import { withAgentTelemetrySuppressed } from '../observability/agentTelemetry.js';

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(EVAL_ROOT, 'fixtures');
const SYNTHETIC_CALLER_ID = '64b000000000000000000010';
const SYNTHETIC_MODEL_VERSION = 'synthetic-evaluation-model-1.0.0';
const MAX_LIVE_PROVIDER_CALLS_PER_CASE = 2;

// These are explicitly synthetic test inputs. They are never loaded from a
// user's profile, persisted, or used to produce a financial recommendation.
const SYNTHETIC_PROFILE_FIELDS = Object.freeze({
  version: 2,
  monthlyTakeHome: 100000,
  monthlySavings: 30000,
  age: 32,
  riskTolerance: 'Moderate',
  soldPropertyProceeds: null,
  hasLumpSum: false,
  lumpSumAmount: 0,
  liquidSavings: 100000,
  emiBurdenPct: null,
  financialDependents: 1,
  emergencyFundMonths: 6,
  investmentGoals: Object.freeze(['Wealth Growth']),
  investmentHorizonYears: 10,
  finalSuitabilityRisk: 'Moderate',
  suitabilityReasonCodes: Object.freeze(['RISK_TOLERANCE_MATCH']),
});

function query(value) {
  const result = {
    sort() { return result; },
    select() { return result; },
    lean: async () => value,
  };
  return result;
}

function fixturePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new TypeError('Evaluation cases must reference a fixture path.');
  }
  const resolved = path.resolve(EVAL_ROOT, relativePath);
  const relative = path.relative(FIXTURE_ROOT, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Evaluation fixture path must remain inside the fixture directory.');
  }
  return resolved;
}

function observedProvider(provider, usage) {
  if (!provider) return null;
  return {
    name: provider.name || 'configured-provider',
    configuredModel: () => provider.configuredModel?.() || provider.model || null,
    isConfigured: () => provider.isConfigured?.() ?? true,
    async generate(args) {
      usage.providerCalls += 1;
      if (usage.providerCalls > MAX_LIVE_PROVIDER_CALLS_PER_CASE) {
        const error = new Error('The live PlanReview provider call budget was exceeded.');
        error.code = 'LIVE_EVAL_PROVIDER_CALL_BUDGET_EXCEEDED';
        throw error;
      }
      const response = await provider.generate(args);
      if (response === null || response === undefined) return response;
      const reported = response.tokensUsed ?? response.usage?.totalTokens ?? response.usage?.total_tokens;
      if (!Number.isSafeInteger(Number(reported)) || Number(reported) <= 0) {
        usage.tokenUsageAvailable = false;
      } else {
        usage.tokensUsed += Number(reported);
      }
      return response;
    },
  };
}

/**
 * Execute the production PlanReview graph with memory-only synthetic
 * dependencies. Supplying a provider is explicit and is used only by the
 * opt-in live evaluator. No Mongo, Redis, filesystem output, or research
 * network integration is enabled by this runner.
 */
export async function runIsolatedPlanReviewCase({ caseDefinition, provider = null } = {}) {
  if (!caseDefinition || typeof caseDefinition.id !== 'string' || !caseDefinition.id.trim()) {
    throw new TypeError('A named PlanReview evaluation case is required.');
  }
  const fixture = JSON.parse(await fs.readFile(fixturePath(caseDefinition.profile), 'utf8'));
  if (typeof fixture.description !== 'string' || !/fixture/i.test(fixture.description)
      || !/^[a-f\d]{24}$/i.test(fixture.profileId || '')
      || !/^[a-f\d]{24}$/i.test(fixture.userId || '')) {
    throw new Error(`Evaluation fixture ${caseDefinition.id} is not an explicitly synthetic fixture.`);
  }

  const profile = { ...SYNTHETIC_PROFILE_FIELDS, _id: fixture.profileId, userId: fixture.userId };
  const ownsProfile = String(fixture.userId) === SYNTHETIC_CALLER_ID;
  const callerProfile = ownsProfile ? profile : null;
  const currentRegulatoryRuleVersion = getCurrentRegulatoryRuleVersion();
  const recommendation = fixture.recommendationStatus === 'AVAILABLE' && callerProfile
    ? {
      _id: '64b000000000000000000002',
      profileId: fixture.profileId,
      userId: fixture.userId,
      modelVersion: SYNTHETIC_MODEL_VERSION,
      profileVersion: callerProfile.version,
      profileInputHash: buildRecommendationProfileHash(callerProfile, {
        modelVersion: SYNTHETIC_MODEL_VERSION,
        policyVersion: RECOMMENDATION_POLICY_VERSION,
      }),
      recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION,
      regulatoryRuleVersion: currentRegulatoryRuleVersion,
      generatedAt: new Date(),
      responseSnapshotAvailable: true,
      responseSnapshot: { recommendation: { instruments: [] } },
      currentAllocationSource: 'ORIGINAL_RECOMMENDATION',
      instruments: [],
    }
    : null;
  const providerUsage = { providerCalls: 0, tokensUsed: 0, tokenUsageAvailable: true };
  const liveProvider = observedProvider(provider, providerUsage);
  const trajectory = [];
  const startedAt = performance.now();

  const result = await withAgentTelemetrySuppressed(() => invokePlanReviewGraph({
    userId: SYNTHETIC_CALLER_ID,
    profileId: fixture.profileId,
    dependencies: {
      profileModel: {
        findOne: filter => query(
          String(filter?._id) === String(fixture.profileId)
            && String(filter?.userId) === SYNTHETIC_CALLER_ID
            ? callerProfile
            : null,
        ),
      },
      recommendationModel: {
        findOne: filter => query(
          recommendation
            && String(filter?.profileId) === String(recommendation.profileId)
            && String(filter?.userId) === String(recommendation.userId)
            ? recommendation
            : null,
        ),
      },
      auditModel: { findOne: () => query(null) },
      goalModel: { find: () => ({ sort: () => query([]) }) },
      getCurrentRegulatoryRuleVersion: () => currentRegulatoryRuleVersion,
      plannerProvider: liveProvider,
      strictModelPlanner: Boolean(liveProvider),
      explanationProviders: liveProvider ? [liveProvider] : [],
      maxSteps: caseDefinition.maxSteps,
      maxToolCalls: caseDefinition.maxToolCalls,
      maxInputTokens: 5000,
      // The live evaluation has a 2,500-token total budget per case. Keep the
      // per-call ceiling low enough that the grounded explanation prompt can
      // be reserved after the planner call without relaxing that total cap.
      maxOutputTokens: 512,
      maxTotalTokens: 2500,
      maxModelCalls: MAX_LIVE_PROVIDER_CALLS_PER_CASE,
      // Two bounded provider calls can run sequentially (the NVIDIA adapter
      // allows 20 seconds per request); give the isolated graph enough time
      // for both without changing its call or token budgets.
      timeoutMs: liveProvider ? 50000 : 5000,
      toolTimeoutMs: 1000,
      researchAdaptiveEnabled: false,
      researchDeepEnabled: false,
      researchMeshClient: null,
      checkpointer: null,
      // The graph's persistence hook is intentionally a no-op in this
      // isolated run; no test result enters production evaluation storage.
      persistAgentRun: async () => undefined,
      onNodeProgress: async ({ event }) => {
        if (event && typeof event.type === 'string') trajectory.push(event);
      },
    },
  }));

  return {
    result,
    trajectory,
    latencyMs: Math.round(performance.now() - startedAt),
    providerUsage: {
      provider: liveProvider?.name || null,
      model: liveProvider?.configuredModel() || null,
      providerCalls: providerUsage.providerCalls,
      tokensUsed: providerUsage.tokensUsed,
      tokenUsageAvailable: providerUsage.tokenUsageAvailable,
      plannerFallback: Boolean(result.planner?.fallback),
      explanationFallback: Boolean(result.explanation?.fallback),
    },
  };
}
