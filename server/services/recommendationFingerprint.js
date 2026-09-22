import { canonicalSha256 } from '../utils/canonicalJson.js';

function plain(value) {
  return value && typeof value.toObject === 'function' ? value.toObject({ flattenMaps: true }) : value;
}

export function canonicalAllocationInstruments(instruments = []) {
  if (!Array.isArray(instruments)) return [];
  return instruments.map(plain).map(instrument => ({
    id: String(instrument.id),
    allocationWeight: Number(instrument.allocationWeight),
    nominalReturn: Number(instrument.nominalReturn),
    riskScore: Number(instrument.riskScore),
    returnAssumptionVersion: instrument.returnAssumptionVersion ?? null,
    returnAssumptionHash: instrument.returnAssumptionHash ?? null,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

export function buildPortfolioFingerprint(instruments) {
  return canonicalSha256({ instruments: canonicalAllocationInstruments(instruments) });
}

export function buildRecommendationFingerprint({
  recommendationId,
  profileInputHash,
  modelVersion,
  recommendationPolicyVersion,
  regulatoryRuleVersion,
  returnAssumptionVersion,
  returnAssumptionHash = null,
  allocationRevision,
  instruments,
}) {
  return canonicalSha256({
    recommendationId: recommendationId ? String(recommendationId) : null,
    profileInputHash,
    modelVersion,
    recommendationPolicyVersion,
    regulatoryRuleVersion,
    returnAssumptionVersion,
    returnAssumptionHash,
    allocationRevision: Number(allocationRevision),
    instruments: canonicalAllocationInstruments(instruments),
  });
}
