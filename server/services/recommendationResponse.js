import {
  buildAssetClassAllocation,
  buildDashboardProjection,
  buildPortfolioReturnAssumption,
} from './coreRecommendation.js';
import {
  PROJECTION_ASSUMPTION_DATA_CLASS,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from './instrumentConstants.js';

function snapshotResponse(snapshot) {
  if (snapshot?.recommendation && snapshot?.completion) return snapshot.recommendation;
  return snapshot;
}

function buildComputedWeights(instruments) {
  return Object.fromEntries(instruments.map(instrument => [
    instrument.id,
    Number(instrument.allocationWeight),
  ]));
}

/**
 * Build the public current recommendation response from one allocation revision.
 * responseSnapshot is generation history only and is never used for derived
 * allocation-dependent values here.
 */
export function buildCurrentRecommendationResponse({
  profile,
  recommendation,
  allocationRevision,
  freshness,
  provenance,
  portfolioFingerprint,
  advisoryExplanation = null,
  advisoryText = null,
} = {}) {
  if (!profile || !recommendation || !allocationRevision?.instruments?.length) {
    const error = new Error('The current financial allocation is unavailable.');
    error.code = 'FINANCIAL_STATE_INTEGRITY_ERROR';
    error.status = 503;
    throw error;
  }

  const instruments = allocationRevision.instruments;
  const historical = snapshotResponse(recommendation.responseSnapshot) || {};
  const generationInstruments = recommendation.instruments || historical.instruments || [];
  const currentFingerprint = portfolioFingerprint || allocationRevision.portfolioFingerprint || null;

  return {
    ...historical,
    instruments,
    generation_instruments: generationInstruments,
    profileId: String(profile._id),
    recommendationId: String(recommendation._id),
    recommendation_id: String(recommendation._id),
    audit_id: historical.audit_id ? String(historical.audit_id) : historical.audit_id,
    audit_hash: historical.audit_hash || null,
    advisory_text: advisoryText,
    advisory_explanation: advisoryExplanation || { status: 'PENDING' },
    computed_weights: buildComputedWeights(instruments),
    portfolio_return_assumption: buildPortfolioReturnAssumption(instruments),
    return_data_class: PROJECTION_ASSUMPTION_DATA_CLASS,
    return_assumption_version: allocationRevision.returnAssumptionVersion || PROJECTION_ASSUMPTION_VERSION,
    return_assumption_source: allocationRevision.returnAssumptionSource || PROJECTION_ASSUMPTION_SOURCE,
    return_assumption_hash: allocationRevision.returnAssumptionHash || null,
    observed_market_fact: false,
    provider_forecast: false,
    asset_class_allocation: buildAssetClassAllocation(instruments),
    dashboard_projection: buildDashboardProjection(profile, instruments),
    current_allocation_source: allocationRevision.source,
    allocation_revision: allocationRevision.revision,
    allocation_revision_id: allocationRevision._id ? String(allocationRevision._id) : null,
    portfolio_fingerprint: currentFingerprint,
    calculation_freshness: freshness,
    state_provenance: provenance,
  };
}
