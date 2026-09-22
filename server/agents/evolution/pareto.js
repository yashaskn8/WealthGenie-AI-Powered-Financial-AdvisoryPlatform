export const PARETO_VERSION = 'pareto-frontier-1.0.0';

function objective(candidate, key) {
  const value = Number(candidate?.metrics?.[key]);
  return Number.isFinite(value) ? value : null;
}

export function dominates(left, right, objectives = []) {
  if (!left || !right || !objectives.length) return false;
  if (left.hardGatePassed !== true || right.hardGatePassed !== true) return false;
  let strictlyBetter = false;
  for (const key of objectives) {
    const a = objective(left, key);
    const b = objective(right, key);
    if (a === null || b === null || a < b) return false;
    if (a > b) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function selectParetoFrontier(candidates = [], objectives = ['correctness', 'grounding', 'reliability', 'latency', 'tokens', 'toolCalls', 'researchQueries']) {
  const eligible = candidates.filter(candidate => candidate?.hardGatePassed === true);
  const frontier = eligible.filter(candidate => !eligible.some(other => other !== candidate && dominates(other, candidate, objectives)));
  return Object.freeze(frontier.map(candidate => candidate.candidateId));
}

export function buildCandidateLineage({ candidateId, parentCandidateId = null, generation = 0, mutationSurface = [], mutationReason = '', reflectionFeedbackHash = null, promptBundleHash, scaffoldHash, evaluationHash = null } = {}) {
  return Object.freeze({
    candidateId: String(candidateId),
    parentCandidateId: parentCandidateId ? String(parentCandidateId) : null,
    generation: Number(generation) || 0,
    mutationSurface: [...new Set(mutationSurface.map(String))],
    mutationReason: String(mutationReason || '').slice(0, 1000),
    reflectionFeedbackHash: reflectionFeedbackHash ? String(reflectionFeedbackHash) : null,
    promptBundleHash: String(promptBundleHash),
    scaffoldHash: String(scaffoldHash),
    evaluationHash: evaluationHash ? String(evaluationHash) : null,
  });
}
