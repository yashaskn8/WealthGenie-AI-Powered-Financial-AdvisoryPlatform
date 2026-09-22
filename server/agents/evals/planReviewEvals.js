import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAFE_PLAN_REVIEW_TOOLS } from '../planReview/planReviewSchemas.js';

const root = path.dirname(fileURLToPath(import.meta.url));

export async function loadPlanReviewDataset(datasetPath = path.join(root, 'plan-review-v1.json')) {
  return JSON.parse(await fs.readFile(datasetPath, 'utf8'));
}

export function gradePlanReviewTrajectory({ caseDefinition, result, trajectory = [] }) {
  const selectedTools = trajectory.filter(event => event.type === 'TOOL_SUCCEEDED').map(event => event.tool).filter(Boolean);
  const forbidden = selectedTools.filter(tool => caseDefinition.forbiddenTools.includes(tool));
  const unsupported = selectedTools.filter(tool => !SAFE_PLAN_REVIEW_TOOLS.includes(tool));
  const resultAction = result?.review?.recommendedAction || result?.recommendedAction;
  const reasons = result?.review?.freshness?.reasonCodes || result?.freshness?.reasonCodes || [];
  return {
    caseId: caseDefinition.id,
    toolSelection: forbidden.length === 0 && unsupported.length === 0,
    trajectory: trajectory.length <= 100 && (result?.stepCount ?? result?.review?.execution?.stepCount ?? 0) <= caseDefinition.maxSteps,
    grounding: !caseDefinition.groundingRequired || result?.review?.evidence?.status === 'AVAILABLE',
    policy: forbidden.length === 0 && unsupported.length === 0,
    action: resultAction === caseDefinition.expectedAction,
    robustness: reasons.every(reason => typeof reason === 'string' && reason.length <= 100),
    forbiddenTools: forbidden,
    unsupportedTools: unsupported,
    passed: forbidden.length === 0 && unsupported.length === 0 && resultAction === caseDefinition.expectedAction,
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
