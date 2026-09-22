import crypto from 'node:crypto';
import { runReliabilityScenario } from './reliabilityRunner.js';
import { createTrajectoryIR } from './trajectoryIR.js';

export function replayTrajectory(original) {
  const events = original?.trajectory?.events?.map(event => ({ ...event, data: { ...event.data } })) || [];
  const replay = createTrajectoryIR({ scenarioId: original?.scenarioId || 'replay', source: 'counterfactual', events });
  if (replay.contentHash !== original?.trajectory?.contentHash) return replay;
  return Object.freeze({ ...replay, contentHash: crypto.createHash('sha256').update(`${replay.contentHash}:replay`).digest('hex') });
}

export function runCounterfactual(original, scenario, options = {}) {
  const replayOf = original?.trajectory?.contentHash || null;
  const result = runReliabilityScenario(scenario, options);
  return Object.freeze({ ...result, replayOf, originalPreserved: Boolean(original?.trajectory?.contentHash && original.trajectory.contentHash === replayOf) });
}
