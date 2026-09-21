import FinancialProfile from '../../models/FinancialProfile.js';
import Recommendation from '../../models/Recommendation.js';
import Goal from '../../models/Goal.js';
import AuditRecord from '../../models/AuditRecord.js';
import { buildRecommendationProfile } from '../../services/recommendationProfile.js';
import { getCurrentRegulatoryRuleVersion } from '../../services/taxEngine.js';
import { assessRecommendationFreshness } from '../../services/recommendationFreshness.js';
import { buildGroundedEvidencePacket, makeEvidenceEntry } from '../../services/groundedEvidence.js';
import { SAFE_PLAN_REVIEW_TOOLS } from './planReviewSchemas.js';

function idOf(value) {
  return value?._id ? String(value._id) : value ? String(value) : null;
}

function latestOwnedRecommendationQuery(profileId, userId, recommendationModel = Recommendation) {
  return recommendationModel.findOne({ profileId, userId }).sort({ generatedAt: -1 }).lean();
}

export function buildProfileContext(storedProfile, canonicalProfile = null) {
  if (!storedProfile || !canonicalProfile) return null;
  return {
    profileId: idOf(storedProfile),
    version: Number(storedProfile.version) || 1,
    age: canonicalProfile.age,
    riskTolerance: canonicalProfile.riskTolerance,
    monthlySavings: canonicalProfile.monthlySavings,
    investmentHorizonYears: canonicalProfile.investmentHorizonYears,
    investmentGoals: [...canonicalProfile.investmentGoals],
    suitabilityRisk: storedProfile.finalSuitabilityRisk || null,
    suitabilityReasonCodes: Array.isArray(storedProfile.suitabilityReasonCodes)
      ? [...storedProfile.suitabilityReasonCodes]
      : [],
  };
}

export function buildRecommendationSummary(recommendation) {
  if (!recommendation) return { status: 'MISSING', recommendationId: null, profileId: null, instruments: [] };
  return {
    status: 'AVAILABLE',
    recommendationId: idOf(recommendation),
    profileId: idOf(recommendation.profileId),
    generatedAt: recommendation.generatedAt ?? null,
    modelVersion: recommendation.modelVersion ?? null,
    regulatoryRuleVersion: recommendation.regulatoryRuleVersion ?? null,
    profileInputHash: recommendation.profileInputHash ?? null,
    responseSnapshotAvailable: Boolean(recommendation.responseSnapshot),
    currentAllocationSource: recommendation.currentAllocationSource ?? null,
    instruments: Array.isArray(recommendation.instruments)
      ? recommendation.instruments.slice(0, 8).map(instrument => ({
        id: instrument.id,
        name: instrument.name,
        type: instrument.type,
        assetClass: instrument.assetClass,
        allocationPct: Number.isFinite(Number(instrument.allocation_pct))
          ? Number(instrument.allocation_pct)
          : null,
        riskLevel: instrument.riskLevel ?? null,
        returnDataClass: instrument.returnDataClass ?? null,
        returnAssumptionVersion: instrument.returnAssumptionVersion ?? null,
      }))
      : [],
  };
}

async function getCurrentProfileContext(context) {
  return context.profileContext;
}

async function getCurrentRecommendationSummary(context) {
  return context.recommendationSummary;
}

async function checkRecommendationFreshness(context) {
  return context.freshness;
}

async function getPlanEvidenceSnapshot(context) {
  if (!context.profile || !context.recommendation) {
    return {
      status: 'UNAVAILABLE',
      entries: [],
      unavailableFacts: ['CURRENT_PLAN_EVIDENCE_UNAVAILABLE'],
    };
  }
  const profileForEvidence = {
    ...context.profile,
    suitabilityRisk: context.profileContext?.suitabilityRisk || null,
    suitabilityReasonCodes: context.profileContext?.suitabilityReasonCodes || [],
  };
  const freshnessEntry = makeEvidenceEntry(
    'E_RECOMMENDATION_FRESHNESS',
    'RECOMMENDATION_STATUS',
    context.freshness,
    {
      dataClass: 'DERIVED_VALUE',
      displayValue: context.freshness.fresh
        ? 'The current recommendation matches the current profile and regulatory policy.'
        : `The recommendation requires attention: ${context.freshness.reasonCodes.join(', ') || 'evidence unavailable'}.`,
    },
  );
  const packet = buildGroundedEvidencePacket({
    question: 'Review the current financial plan and its evidence status.',
    profile: profileForEvidence,
    recommendation: context.recommendation,
    additionalEntries: [freshnessEntry],
    unavailableFacts: context.freshness.fresh ? [] : context.freshness.reasonCodes,
    purpose: 'PLAN_REVIEW',
  });
  return {
    status: 'AVAILABLE',
    evidenceHash: packet.evidenceHash,
    groundingVersion: packet.groundingVersion,
    entries: packet.entries,
    unavailableFacts: packet.unavailableFacts,
    privacy: packet.privacy,
  };
}

async function getGoalStatusSummary(context) {
  const goalModel = context.dependencies.goalModel || Goal;
  if (!context.profile) return { status: 'UNAVAILABLE', items: [], unavailableFacts: ['PROFILE_REQUIRED'] };
  try {
    const goals = await goalModel.find({ userId: context.userId, profileId: context.profileId })
      .sort({ target_date: 1 })
      .lean();
    return {
      status: goals.length ? 'AVAILABLE' : 'NONE',
      items: goals.slice(0, 20).map(goal => ({
        goalId: idOf(goal),
        name: goal.goal_name,
        targetDate: goal.target_date ?? null,
        priority: goal.priority ?? null,
        status: goal.status ?? null,
        currentSavings: goal.current_savings ?? null,
        targetAmount: goal.target_amount ?? null,
        probabilityOfSuccess: goal.probability_of_success ?? null,
      })),
    };
  } catch {
    return { status: 'UNAVAILABLE', items: [], unavailableFacts: ['GOALS_UNAVAILABLE'] };
  }
}

export const PLAN_REVIEW_TOOL_CATALOG = Object.freeze({
  get_current_profile_context: {
    description: 'Read the authenticated user current profile context.',
    execute: getCurrentProfileContext,
  },
  get_current_recommendation_summary: {
    description: 'Read a bounded summary of the authenticated user current recommendation.',
    execute: getCurrentRecommendationSummary,
  },
  check_recommendation_freshness: {
    description: 'Check profile hash, model, and regulatory freshness without changing the plan.',
    execute: checkRecommendationFreshness,
  },
  get_plan_evidence_snapshot: {
    description: 'Return the immutable evidence snapshot used to ground a plan review.',
    execute: getPlanEvidenceSnapshot,
  },
  get_goal_status_summary: {
    description: 'Read persisted goal status for the authenticated profile.',
    execute: getGoalStatusSummary,
  },
});

export function getPlanReviewToolDefinitions() {
  return SAFE_PLAN_REVIEW_TOOLS.map(name => ({ name, description: PLAN_REVIEW_TOOL_CATALOG[name].description }));
}

export async function executePlanReviewTool(toolName, context) {
  const tool = PLAN_REVIEW_TOOL_CATALOG[toolName];
  if (!tool || !SAFE_PLAN_REVIEW_TOOLS.includes(toolName)) {
    const error = new Error(`Unknown plan review tool: ${toolName}`);
    error.code = 'UNKNOWN_TOOL';
    throw error;
  }
  const override = context?.dependencies?.toolOverrides?.[toolName];
  if (typeof override === 'function') return override(context);
  return tool.execute(context);
}

export async function loadPlanReviewContext({ userId, profileId, dependencies = {} }) {
  const profileModel = dependencies.profileModel || FinancialProfile;
  const recommendationModel = dependencies.recommendationModel || Recommendation;
  const auditModel = dependencies.auditModel || AuditRecord;
  const storedProfile = await profileModel.findOne({ _id: profileId, userId }).lean();
  if (!storedProfile) {
    return {
      profile: null,
      profileContext: null,
      recommendation: null,
      recommendationSummary: buildRecommendationSummary(null),
      freshness: assessRecommendationFreshness({ profile: null, recommendation: null }),
    };
  }

  const profile = buildRecommendationProfile(storedProfile);
  const recommendation = await latestOwnedRecommendationQuery(profileId, userId, recommendationModel);
  let recommendationRegulatoryRuleVersion = recommendation?.regulatoryRuleVersion ?? null;
  if (recommendation && !recommendationRegulatoryRuleVersion && auditModel) {
    const audit = await auditModel.findOne({ recommendationId: recommendation._id, userId })
      .select('regulatory_rule_version')
      .lean();
    recommendationRegulatoryRuleVersion = audit?.regulatory_rule_version || null;
  }
  const currentRegulatoryRuleVersion = (dependencies.getCurrentRegulatoryRuleVersion || getCurrentRegulatoryRuleVersion)();
  return {
    profile,
    profileContext: buildProfileContext(storedProfile, profile),
    recommendation,
    recommendationSummary: buildRecommendationSummary(recommendation),
    freshness: assessRecommendationFreshness({
      profile,
      recommendation,
      currentRegulatoryRuleVersion,
      recommendationRegulatoryRuleVersion,
    }),
  };
}
