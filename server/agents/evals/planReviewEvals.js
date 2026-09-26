import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAFE_PLAN_REVIEW_TOOLS } from '../planReview/planReviewSchemas.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export async function loadPlanReviewDataset(datasetPath = path.join(root, 'plan-review-v1.json')) {
  return JSON.parse(await fs.readFile(datasetPath, 'utf8'));
}

export function gradePlanReviewTrajectory({ caseDefinition, result, trajectory = [] }) {
  const selectedTools = trajectory.filter(event => event?.type === 'TOOL_SUCCEEDED').map(event => event.tool).filter(Boolean);
  const forbidden = selectedTools.filter(tool => caseDefinition.forbiddenTools.includes(tool));
  const unsupported = selectedTools.filter(tool => !SAFE_PLAN_REVIEW_TOOLS.includes(tool));
  const missingExpectedTools = (caseDefinition.expectedTools || []).filter(tool => !selectedTools.includes(tool));
  const resultAction = result?.review?.recommendedAction || result?.recommendedAction;
  const reasons = result?.review?.freshness?.reasonCodes ?? result?.freshness?.reasonCodes;
  const expectedReasons = caseDefinition.requiredReasonCodes || [];
  const observedReasons = Array.isArray(reasons) ? reasons : [];
  const missingReasonCodes = expectedReasons.filter(reason => !observedReasons.includes(reason));
  const stepCount = result?.stepCount ?? result?.review?.execution?.stepCount;
  const validStepCount = Number.isInteger(stepCount) && stepCount >= 0;
  const toolCallCount = result?.toolCallCount ?? result?.review?.execution?.toolCallCount ?? selectedTools.length;
  const boundedToolCalls = Number.isInteger(toolCallCount)
    && toolCallCount >= selectedTools.length
    && toolCallCount <= caseDefinition.maxToolCalls;
  const boundedTrajectory = trajectory.length <= 100
    && validStepCount
    && stepCount <= caseDefinition.maxSteps
    && boundedToolCalls;
  const evidenceStatus = result?.review?.evidence?.status ?? result?.evidence?.status;
  const grounding = !caseDefinition.groundingRequired
    || (evidenceStatus === 'AVAILABLE' && result?.validation?.valid !== false && result?.review?.validation?.valid !== false);
  const toolSelection = forbidden.length === 0 && unsupported.length === 0 && missingExpectedTools.length === 0;
  const policy = result?.review?.policy?.allowed !== false
    && result?.policy?.allowed !== false
    && forbidden.length === 0
    && unsupported.length === 0
    && missingReasonCodes.length === 0;
  const action = resultAction === caseDefinition.expectedAction;
  const robustness = Array.isArray(reasons)
    && observedReasons.every(reason => typeof reason === 'string' && /^[A-Z0-9_]{2,100}$/.test(reason));
  return {
    caseId: caseDefinition.id,
    toolSelection,
    trajectory: boundedTrajectory,
    grounding,
    policy,
    action,
    robustness,
    forbiddenTools: forbidden,
    unsupportedTools: unsupported,
    missingExpectedTools,
    missingReasonCodes,
    passed: toolSelection && boundedTrajectory && grounding && policy && action && robustness,
  };
}

export function assertPlanReviewGates(results) {
  const failures = results.filter(result => !result.passed);
  if (failures.length) {
    const error = new Error(`Plan review evaluation gates failed: ${failures.map(item => item.caseId).join(', ')}`);
    error.code = 'AGENT_EVAL_GATE_FAILED';
    error.failures = failures;
    throw error;
  }
  return { passed: true, cases: results.length };
}
