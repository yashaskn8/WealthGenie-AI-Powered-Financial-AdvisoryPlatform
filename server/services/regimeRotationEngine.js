/**
 * WealthGenie — Market Regime & Crash-Adaptive Rotation Engine
 * ─────────────────────────────────────────────────────────────
 * Provides macro regime state analysis, historical tactical sector tilts,
 * and portfolio allocation tilt simulation.
 *
 * NOTE: Operates strictly as an advisory tilt simulator.
 * Does NOT execute automated broker trades.
 */

export const MACRO_REGIMES = {
  normal: {
    key: 'normal',
    title: 'Normal Market Environment',
    badge: 'Baseline',
    color: '#3b82f6',
    description: 'Steady economic growth with moderate volatility. Standard strategic asset allocation applies.',
    disclaimer: 'General strategic asset allocation based on long-term risk profile.',
    tilts: {}
  },
  geopolitical_conflict: {
    key: 'geopolitical_conflict',
    title: 'Geopolitical Conflict & Supply Disruption',
    badge: 'Tactical Shift',
    color: '#eab308',
    description: 'Elevated global geopolitical tensions driving commodity volatility, energy supply constraints, and safe-haven demand.',
    disclaimer: 'Historical pattern: Defence, Energy, and Gold often outperform during supply shocks, while trade-dependent sectors experience margin pressure.',
    tilts: {
      defence: { weightDelta: 0.15, label: 'Overweight Defence (+15%)', reason: 'High capital allocation to domestic defence procurement and order book expansion.' },
      energy_oil_gas: { weightDelta: 0.10, label: 'Overweight Energy/Oil & Gas (+10%)', reason: 'Upstream producers benefit from elevated crude and natural gas prices.' },
      gold: { weightDelta: 0.10, label: 'Overweight Sovereign Gold / Gold ETFs (+10%)', reason: 'Safe-haven asset hedging currency depreciation and conflict volatility.' },
      auto: { weightDelta: -0.15, label: 'Underweight Auto (-15%)', reason: 'Input cost inflation in steel/aluminum and potential semiconductor supply friction.' }
    }
  },
  pandemic_health_crisis: {
    key: 'pandemic_health_crisis',
    title: 'Health Emergency & Lockdown Shock',
    badge: 'Defensive Shift',
    color: '#a855f7',
    description: 'Global health emergency causing physical mobility restrictions and supply chain re-orientations.',
    disclaimer: 'Historical pattern: Healthcare/Pharma and Digital IT services see surge demand; physical mobility sectors experience sharp drawdowns.',
    tilts: {
      pharma: { weightDelta: 0.20, label: 'Overweight Pharma & Healthcare (+20%)', reason: 'Surge in diagnostic, therapeutic, and active pharmaceutical ingredient (API) demand.' },
      it_services: { weightDelta: 0.15, label: 'Overweight Digital IT Services (+15%)', reason: 'Accelerated enterprise cloud transformation and remote infrastructure adoption.' },
      fmcg: { weightDelta: 0.10, label: 'Overweight Essential FMCG (+10%)', reason: 'Resilient inelastic demand for household staples.' }
    }
  },
  broad_market_crash: {
    key: 'broad_market_crash',
    title: 'Broad Market Drawdown (>15% Drop)',
    badge: 'Crash Defense',
    color: '#ef4444',
    description: 'Systemic liquidity contraction or severe valuation reset across equity markets.',
    disclaimer: 'Historical pattern: High quality blue-chips and liquid funds preserve capital; small/mid-caps face liquidity compression.',
    tilts: {
      liquid_mf: { weightDelta: 0.25, label: 'Overweight Liquid / Emergency Funds (+25%)', reason: 'Preserves dry powder to rebalance at attractive valuations.' },
      bluechip_stocks: { weightDelta: 0.15, label: 'Overweight Blue-Chip Large Caps (+15%)', reason: 'Strong balance sheets with zero debt survive extended economic downturns.' },
      small_cap_stocks: { weightDelta: -0.20, label: 'Underweight Small Caps (-20%)', reason: 'Higher vulnerability to credit crunch and earnings downgrades.' }
    }
  },
  inflation_spike: {
    key: 'inflation_spike',
    title: 'High Inflation & Commodity Spike',
    badge: 'Inflation Shield',
    color: '#f97316',
    description: 'Headline inflation exceeding central bank tolerance limits with rising input costs.',
    disclaimer: 'Historical pattern: Real assets and floating rate instruments hedge purchasing power decay.',
    tilts: {
      metals_mining: { weightDelta: 0.15, label: 'Overweight Metals & Commodities (+15%)', reason: 'Direct beneficiary of rising global commodity price realization.' },
      rbi_bonds: { weightDelta: 0.10, label: 'Overweight Floating Rate Bonds (+10%)', reason: 'Coupon rates adjust upward with interest rate reset cycles.' }
    }
  },
  rate_cut_cycle: {
    key: 'rate_cut_cycle',
    title: 'Monetary Easing & Rate Cut Cycle',
    badge: 'Growth Expansion',
    color: '#10b981',
    description: 'Central bank lowering benchmark repo rates to stimulate credit growth and economic expansion.',
    disclaimer: 'Historical pattern: Long duration bond funds capture capital gains while high-growth mid-caps benefit from lower cost of capital.',
    tilts: {
      gilt_mf: { weightDelta: 0.20, label: 'Overweight Gilt / Long Duration Bonds (+20%)', reason: 'Capital appreciation as bond yields decline.' },
      mid_cap_stocks: { weightDelta: 0.15, label: 'Overweight Mid-Cap Growth Equities (+15%)', reason: 'Reduced borrowing cost accelerates corporate expansion.' }
    }
  }
};

/**
 * Detect or fetch current active macro market regime tag.
 * Returns default regime or explicit active market state override.
 */
export function getCurrentRegime(overrideKey = null) {
  const key = overrideKey || process.env.MACRO_REGIME_OVERRIDE || 'normal';
  const regime = MACRO_REGIMES[key];
  if (!regime) throw new TypeError(`Unknown macro regime: ${key}`);
  return regime;
}

/**
 * Get tactical tilts for a given regime.
 */
export function getRegimeTilts(regimeKey) {
  const regime = MACRO_REGIMES[regimeKey];
  if (!regime) throw new TypeError(`Unknown macro regime: ${regimeKey}`);
  return {
    regime: regime.key,
    title: regime.title,
    badge: regime.badge,
    color: regime.color,
    description: regime.description,
    disclaimer: regime.disclaimer,
    tilts: regime.tilts
  };
}

/**
 * Calculate tilt-adjusted portfolio allocation weights.
 * Applies regime tilts to standard strategic asset allocation.
 *
 * @param {Object} baseWeights - Map of asset class/sector -> weight (0 to 1)
 * @param {string} regimeKey - Active regime identifier
 * @returns {Object} { adjustedWeights, explanations }
 */
export function calculateTiltAdjustedAllocation(baseWeights, regimeKey) {
  if (!baseWeights || typeof baseWeights !== 'object' || Array.isArray(baseWeights)
      || Object.keys(baseWeights).length === 0
      || Object.values(baseWeights).some(weight => typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1)) {
    throw new TypeError('baseWeights must be a non-empty map of finite weights from 0 to 1');
  }
  const baseTotal = Object.values(baseWeights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(baseTotal - 1) > 0.001) throw new RangeError('baseWeights must sum to 1');
  const regime = MACRO_REGIMES[regimeKey];
  if (!regime) throw new TypeError(`Unknown macro regime: ${regimeKey}`);
  const tilts = regime.tilts;

  const adjustedWeights = { ...baseWeights };
  const explanations = [];

  Object.entries(tilts).forEach(([sectorKey, tilt]) => {
    const currentWeight = adjustedWeights[sectorKey] || 0;
    const newWeight = Math.max(0, currentWeight + tilt.weightDelta);
    adjustedWeights[sectorKey] = Number(newWeight.toFixed(3));

    explanations.push({
      sector: sectorKey,
      label: tilt.label,
      previousWeight: currentWeight,
      newWeight: adjustedWeights[sectorKey],
      reason: tilt.reason
    });
  });

  // Re-normalize weights to sum to 1.0
  const totalWeight = Object.values(adjustedWeights).reduce((sum, w) => sum + w, 0);
  if (totalWeight > 0) {
    Object.keys(adjustedWeights).forEach(k => {
      adjustedWeights[k] = Number((adjustedWeights[k] / totalWeight).toFixed(3));
    });
  }

  return {
    classification: 'NON_RECOMMENDATION_MACRO_WHAT_IF',
    regime: regime.key,
    regimeTitle: regime.title,
    disclaimer: regime.disclaimer,
    adjustedWeights,
    explanations
  };
}
