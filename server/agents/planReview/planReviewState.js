import { Annotation } from '@langchain/langgraph';

const replace = (defaultValue = null) => Annotation({ reducer: (_left, right) => right, default: () => defaultValue });
const append = () => Annotation({ reducer: (left = [], right = []) => [...left, ...right], default: () => [] });

export const PlanReviewState = Annotation.Root({
  runId: replace(),
  userId: replace(),
  profileId: replace(),
  correlationId: replace(),
  traceId: replace(),
  startedAt: replace(),
  profile: replace(),
  profileContext: replace(),
  recommendation: replace(),
  recommendationSummary: replace(),
  freshness: replace(),
  goalSummary: replace(),
  evidencePacket: replace(),
  requestedChecks: replace([]),
  toolResults: replace({}),
  toolCallCount: replace(0),
  modelCallCount: replace(0),
  toolCallCounts: replace({}),
  stepCount: replace(0),
  repeatedRequests: replace([]),
  findings: replace([]),
  recommendedAction: replace('INSUFFICIENT_EVIDENCE'),
  explanation: replace(),
  review: replace(),
  planner: replace({ provider: 'DETERMINISTIC', model: null, fallback: true }),
  validation: replace({ valid: false, errors: [] }),
  policy: replace({ allowed: false, reasonCodes: [] }),
  errors: append(),
  status: replace('RUNNING'),
  resumeCheckpoint: replace(null),
});
