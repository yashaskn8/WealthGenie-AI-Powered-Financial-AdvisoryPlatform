import axios from 'axios';
import {
  buildPredictionRequest,
  buildTracingHeaders,
  normalizePredictionResponse,
} from './mlServiceContract.js';
import { buildRecommendationProfile, getMissingMlProfileFields } from './recommendationProfile.js';

const getMlServiceUrl = () => (process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const getMlApiKey = () => process.env.ML_SERVICE_API_KEY || '';

const ML_TIMEOUT_MS = 5000;

let failureCount = 0;
let circuitOpenUntil = 0;

function isCircuitHealthy() {
  if (Date.now() < circuitOpenUntil) {
    return false;
  }
  return true;
}

function recordSuccess() {
  failureCount = 0;
  circuitOpenUntil = 0;
}

function recordFailure() {
  failureCount++;
  if (failureCount >= 3) {
    circuitOpenUntil = Date.now() + 60000;
    console.warn(`[MLClient] Circuit breaker OPENED due to ${failureCount} consecutive failures.`);
  }
}


export async function getMLPrediction(profileData, correlationId = null, userId = null, userRole = null) {
  const request = buildPredictionRequest(profileData);
  if (!request) {
    throw new TypeError('ML prediction input does not satisfy recommendation-features-4.0.0');
  }
  if (!isCircuitHealthy()) {
    console.warn('[MLClient] Circuit breaker OPEN — fast-failing to rule-based fallback.');
    return getRuleBasedFallback(request);
  }

  const effectiveUserId = userId || profileData.userId;

  try {
    const mlServiceUrl = getMlServiceUrl();
    const mlApiKey = getMlApiKey();
    const mlEndpoint = process.env.ML_MODEL_ENDPOINT || '/predict/enriched';
    const normalizedEndpoint = mlEndpoint.startsWith('/') ? mlEndpoint : `/${mlEndpoint}`;
    const res = await axios.post(`${mlServiceUrl}${normalizedEndpoint}`, request, {
      timeout: ML_TIMEOUT_MS,
      headers: {
        ...(mlApiKey ? { 'X-API-Key': mlApiKey } : {}),
        ...(effectiveUserId ? { 'X-Verified-User-Id': String(effectiveUserId) } : {}),
        ...(userRole ? { 'X-Verified-User-Role': String(userRole) } : {}),
        ...buildTracingHeaders(correlationId),
      }
    });
    const prediction = normalizePredictionResponse(res.data);
    if (!prediction) {
      console.warn('[MLClient] ML service returned an unusable prediction, using rule-based fallback.');
      return getRuleBasedFallback(request);
    }
    recordSuccess();
    return prediction;
  } catch (err) {
    recordFailure();
    console.warn('[MLClient] ML service unavailable, using rule-based fallback:', err.message);
    return getRuleBasedFallback(request);
  }
}

export async function checkMLHealth(correlationId = null) {
  try {
    const mlServiceUrl = getMlServiceUrl();
    const mlApiKey = getMlApiKey();
    const res = await axios.get(`${mlServiceUrl}/health`, {
      timeout: 3000,
      headers: {
        ...(mlApiKey ? { 'X-API-Key': mlApiKey } : {}),
        ...buildTracingHeaders(correlationId),
      }
    });
    return res.data;
  } catch { return null; }
}

export function getRuleBasedFallback(profileData) {
  const profile = buildPredictionRequest(profileData);
  if (!profile) throw new TypeError('Rule fallback requires recommendation-features-4.0.0 input');
  const risk = profile.final_suitability_risk;
  const path = [`final_suitability_risk=${risk}`, `horizon=${profile.investment_horizon_years}`];
  let primary;
  let secondary;
  let tertiary;
  if (profile.investment_goals.includes('Emergency Fund')) {
    primary = 'Liquid_MF'; secondary = 'FD'; tertiary = 'Debt_MF';
    path.push('emergency_fund_goal');
  } else if (risk === 'Aggressive') {
    primary = 'Equity_MF'; secondary = 'Index_MF'; tertiary = 'Midcap_MF';
  } else if (risk === 'Moderate-Aggressive') {
    primary = 'Index_MF'; secondary = 'Hybrid_MF'; tertiary = 'Equity_MF';
  } else if (risk === 'Moderate') {
    primary = 'Hybrid_MF'; secondary = 'Debt_MF'; tertiary = 'Index_MF';
  } else if (risk === 'Conservative-Moderate') {
    primary = 'Debt_MF'; secondary = 'FD'; tertiary = 'RBI_Bond';
  } else {
    primary = 'FD'; secondary = 'PPF'; tertiary = 'Liquid_MF';
  }

  // Confidence scores exist only for the three explicit rule outcomes. Do not
  // invent baseline confidence for instruments the fallback did not select.
  const confPrimary = path.length > 2 ? 0.65 : 0.55;
  const confSecondary = (1 - confPrimary) * 0.65;
  const confTertiary = (1 - confPrimary) * 0.35;

  const confidence_scores = {
    [primary]: parseFloat(confPrimary.toFixed(2)),
    [secondary]: parseFloat(confSecondary.toFixed(2)),
    [tertiary]: parseFloat(confTertiary.toFixed(2)),
  };

  return {
    primary, secondary, tertiary,
    confidence_scores,
    decision_path: path,
    explanation: {
      top_reason: `Rule-based fallback constrained by ${risk} final suitability`,
      feature_contributions: [],
    },
    model_version: 'rule-fallback-4.0.0',
    dataset_version: 'rule-fallback-4.0.0',
    feature_schema_version: 'recommendation-features-4.0.0',
    fallback: true,
  };
}

/**
 * Deterministic, conservative recommendation seed for profiles whose optional
 * capacity facts are unknown. Such profiles are intentionally never converted
 * into a numeric ML request because doing so would impute user facts.
 */
export function getIncompleteProfileFallback(profileInput, suitability) {
  const profile = buildRecommendationProfile(profileInput);
  const missingFields = getMissingMlProfileFields(profile);
  if (missingFields.length === 0) {
    throw new TypeError('Incomplete-profile fallback requires at least one unknown ML fact');
  }
  const risk = suitability?.finalRisk;
  if (typeof risk !== 'string') throw new TypeError('Incomplete-profile fallback requires final suitability');

  const path = [
    `final_suitability_risk=${risk}`,
    `horizon=${profile.investmentHorizonYears}`,
    `optional_profile_fields_unknown=${missingFields.join(',')}`,
    'ml_skipped_no_imputation',
  ];
  let primary;
  let secondary;
  let tertiary;
  if (profile.investmentGoals.includes('Emergency Fund')) {
    primary = 'Liquid_MF'; secondary = 'FD'; tertiary = 'Debt_MF';
    path.push('emergency_fund_goal');
  } else if (risk === 'Aggressive') {
    primary = 'Equity_MF'; secondary = 'Index_MF'; tertiary = 'Midcap_MF';
  } else if (risk === 'Moderate-Aggressive') {
    primary = 'Index_MF'; secondary = 'Hybrid_MF'; tertiary = 'Equity_MF';
  } else if (risk === 'Moderate') {
    primary = 'Hybrid_MF'; secondary = 'Debt_MF'; tertiary = 'Index_MF';
  } else if (risk === 'Conservative-Moderate') {
    primary = 'Debt_MF'; secondary = 'FD'; tertiary = 'RBI_Bond';
  } else {
    primary = 'FD'; secondary = 'PPF'; tertiary = 'Liquid_MF';
  }

  return {
    primary,
    secondary,
    tertiary,
    confidence_scores: { [primary]: 0.55, [secondary]: 0.29, [tertiary]: 0.16 },
    decision_path: path,
    explanation: {
      top_reason: `Conservative rule fallback used because optional profile facts are unknown: ${missingFields.join(', ')}`,
      feature_contributions: [],
    },
    model_version: 'rule-fallback-incomplete-profile-4.0.0',
    dataset_version: 'rule-fallback-incomplete-profile-4.0.0',
    feature_schema_version: 'recommendation-features-4.0.0',
    fallback: true,
  };
}
