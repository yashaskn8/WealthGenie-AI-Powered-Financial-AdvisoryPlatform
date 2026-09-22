import crypto from 'node:crypto';
import { buildStressScenarioReport } from '../../services/stressScenarioEngine.js';

const ENGINE_VERSION = 'stress-scenario-engine-1.0.0';
const ASSUMPTION_VERSION = 'wealthgenie-scenario-policy-1.0.0';

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function hashSnapshot(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function buildScenarioAnalysisArtifact({
  scenarioId = crypto.randomUUID(),
  scenarioType = 'STRESS_SCENARIO',
  instrument,
  principal,
  researchClaimIds = [],
  deterministicInputs = {},
} = {}) {
  const safeInstrument = {
    id: instrument?.id,
    type: instrument?.type,
    assetClass: instrument?.assetClass,
    name: instrument?.name,
  };
  const inputs = {
    instrument: safeInstrument,
    principal,
    ...deterministicInputs,
  };
  const inputSnapshotHash = hashSnapshot(inputs);
  const deterministicOutputs = buildStressScenarioReport({ instrument: safeInstrument, principal });
  return Object.freeze({
    scenarioId,
    scenarioType,
    inputSnapshotHash,
    engineVersion: ENGINE_VERSION,
    assumptionVersion: ASSUMPTION_VERSION,
    researchClaimIds: [...new Set(researchClaimIds)].slice(0, 40),
    deterministicInputs: inputs,
    deterministicOutputs,
    limitations: [
      'This is a stress/what-if analysis, not a forecast or recommendation.',
      'The scenario does not change allocation, product eligibility, risk tier, goals, or recommendation state.',
    ],
    notForecast: true,
    financialAuthorityDelta: 0,
  });
}

export { ENGINE_VERSION as SCENARIO_ENGINE_VERSION, ASSUMPTION_VERSION as SCENARIO_ASSUMPTION_VERSION };
