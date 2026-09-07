import { buildRecommendationProfile } from './recommendationProfile.js';
import { assessSuitabilityRisk } from './riskProfiler.js';

/**
 * Explainability Engine (Phase 6)
 * Generates transparent, deterministic explanation metadata for financial advice.
 * Purely derived from backend engine execution metadata—never hallucinated by LLM.
 */
export class ExplainabilityEngine {
  /**
   * Generates explanation metadata payload for a chat turn.
   *
   * @param {object} profile
   * @param {Array<object>} toolResults
   * @param {object} verificationMetadata
   * @returns {object} Explainability metadata object
   */
  static generateExplanation(profile, toolResults = [], verificationMetadata = {}) {
    const canonical = buildRecommendationProfile(profile);
    const suitability = assessSuitabilityRisk(canonical);
    const enginesUsed = new Set();
    const assumptions = [];
    const affectedAttributes = [];

    affectedAttributes.push(`Investor Age (${canonical.age} yrs)`);
    affectedAttributes.push(`Risk Preference (${canonical.riskTolerance})`);
    affectedAttributes.push(`Final Suitability (${suitability.finalRisk})`);
    affectedAttributes.push(`Monthly Take-Home (₹${canonical.monthlyTakeHome.toLocaleString('en-IN')})`);
    affectedAttributes.push(`Monthly Savings (₹${canonical.monthlySavings.toLocaleString('en-IN')})`);
    affectedAttributes.push(`Investment Horizon (${canonical.investmentHorizonYears} yrs)`);
    if (canonical.hasLumpSum) affectedAttributes.push(`Deployable Lump Sum (₹${canonical.lumpSumAmount.toLocaleString('en-IN')})`);

    toolResults.filter(res => res?.success === true).forEach(res => {
      if (res.tool === 'sip_projection') {
        enginesUsed.add('projectionEngine.sipFV');
        assumptions.push('Monthly annuity-due compounding, constant annual yield');
      } else if (res.tool === 'tax_calculator') {
        enginesUsed.add('taxEngine.computeTax');
        assumptions.push(`Indian income-tax slabs ${res.result?.fiscalYear || 'version unavailable'}`);
      } else if (res.tool === 'portfolio_optimizer') {
        enginesUsed.add(`portfolioEngine.${res.result?.strategy || 'strategy_unavailable'}`);
        assumptions.push('Historical variance-covariance matrix of asset classes');
      }
    });

    const arithmeticVerificationStatus = ['verified', 'corrected', 'unverified']
      .includes(verificationMetadata.verification_status)
      ? verificationMetadata.verification_status
      : 'unverified';

    return {
      whyThisRecommendation: `Grounded on the frozen Financial Profile; final suitability ${suitability.finalRisk} does not exceed stated ${canonical.riskTolerance} preference.`,
      financialEnginesUsed: Array.from(enginesUsed),
      assumptionsUsed: assumptions,
      affectedProfileAttributes: affectedAttributes,
      arithmeticVerificationStatus,
      limitations: ['Projections do not guarantee future returns.', 'Tax impact is not personalized without a separate explicit tax profile.'],
      riskDisclosure: 'Past performance is not indicative of future returns. Mutual fund investments are subject to market risks.',
    };
  }
}
