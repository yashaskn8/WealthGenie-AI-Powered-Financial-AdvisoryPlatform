import {
  buildRecommendationProfile,
  toProfileApiResponse,
} from './recommendationProfile.js';
import { assessSuitabilityRisk } from './riskProfiler.js';

export function formatProfileResponse(profile) {
  const value = profile?.toObject ? profile.toObject() : profile;
  const canonical = buildRecommendationProfile(value);
  const suitability = assessSuitabilityRisk(canonical);
  return {
    ...toProfileApiResponse(value),
    version: value.version ?? 1,
    risk_capacity_score: suitability.capacityScore,
    risk_capacity_level: suitability.capacityLevel,
    final_suitability_risk: suitability.finalRisk,
    final_suitability_level: suitability.finalLevel,
    suitability_reason_codes: suitability.reasonCodes,
  };
}
