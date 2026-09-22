import { assertScenarioSet } from './scenarioDsl.js';

// These scenarios deliberately exercise candidate-owned PlanReview behavior.
// They contain no executable callbacks; the host supplies a sanitized fixture
// and the real candidate runner at evaluation time.
const scenarios = [
  {
    id: 'candidate-planner-safety',
    family: 'CANDIDATE_BEHAVIOR',
    description: 'Candidate planner routing remains bounded and uses the planner role.',
    durationHours: 1,
    actions: [{ atHours: 0, action: 'SUBMIT_TASK' }],
    expected: { taskState: null, authorityDelta: 0, noDuplicateCommit: true, safetyContained: true, maxReactionHours: null },
    executionMode: 'CANDIDATE_BOUND',
    candidateExpectations: { plannerRole: 'PLANNER', requiredTrajectoryKinds: [] },
    tags: ['candidate', 'planner', 'safety'],
  },
  {
    id: 'candidate-context-boundary',
    family: 'CANDIDATE_BEHAVIOR',
    description: 'Candidate context compression stays within the approved PlanReview policy.',
    durationHours: 1,
    actions: [{ atHours: 0, action: 'SUBMIT_TASK' }],
    expected: { taskState: null, authorityDelta: 0, noDuplicateCommit: true, safetyContained: true, maxReactionHours: null },
    executionMode: 'CANDIDATE_BOUND',
    candidateExpectations: { contextCompressionPolicy: 'BOUNDED_PROFILE_CONTEXT', requiredTrajectoryKinds: [] },
    tags: ['candidate', 'privacy'],
  },
];

export const CANDIDATE_RELIABILITY_SCENARIOS = assertScenarioSet(scenarios);
