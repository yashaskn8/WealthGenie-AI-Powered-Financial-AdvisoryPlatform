const SCENARIO_PROFILES = Object.freeze({
  capital_protection_reference: Object.freeze({
    title: 'Sovereign / Deposit Reference Scenario',
    badgeColor: '#10b981',
    description: 'These instruments avoid ordinary market drawdowns, but remain exposed to inflation, liquidity restrictions, and product-specific protection limits.',
    insight: 'Nominal capital protection does not eliminate purchasing-power or liquidity risk. Confirm the issuer, withdrawal terms, and any applicable deposit-insurance limit before investing.',
    scenarios: Object.freeze([
      Object.freeze({
        name: '2013 Inflation Spike (Real Return Drag)',
        period: 'Jan 2013 – Nov 2013',
        impactPct: -4.1,
        impactKind: 'inflation',
        recovery: 'Not modelled',
        recoveryMultiplier: 1,
        cause: 'This scenario applies a 4.1% purchasing-power shock to show how inflation can reduce the real value of a fixed nominal principal.',
        badge: 'Purchasing Power Shock',
      }),
      Object.freeze({
        name: 'Premature Liquidity Break Penalty',
        period: 'Emergency Withdrawal Event',
        impactPct: -1,
        impactKind: 'penalty',
        recovery: 'Immediate settlement',
        recoveryMultiplier: 0.99,
        cause: 'This hypothetical applies a 1.0% early-exit penalty. Actual penalties and withdrawal eligibility depend on the selected product and provider.',
        badge: 'Exit Penalty',
      }),
    ]),
  }),
  liquid_debt: Object.freeze({
    title: 'Liquid & Overnight Money Markets',
    badgeColor: '#14b8a6',
    description: 'Short-duration debt can limit rate sensitivity, but it is not guaranteed and can still face liquidity or credit events.',
    insight: 'Small historical drawdowns do not guarantee capital stability. Check portfolio credit quality, concentration, duration, and exit terms for the selected fund.',
    scenarios: Object.freeze([
      Object.freeze({ name: '2020 COVID Liquidity Freeze', period: 'Mar 2020 – Apr 2020', impactPct: -0.4, impactKind: 'drawdown', recovery: '7 Days', recoveryMultiplier: 1.002, cause: 'A liquidity-shock scenario representing a brief NAV decline during heavy institutional redemptions and money-market dislocation.', badge: 'Liquidity Squeeze' }),
      Object.freeze({ name: 'Credit Default Stress Test', period: 'Simulated Single-Issuer Default', impactPct: -2.5, impactKind: 'drawdown', recovery: '4 Months', recoveryMultiplier: 1.015, cause: 'A hypothetical write-down illustrates that short-duration funds can still lose value when an issuer is downgraded or defaults.', badge: 'Credit Default' }),
    ]),
  }),
  long_debt: Object.freeze({
    title: 'Medium/Long Duration Fixed Income',
    badgeColor: '#06b6d4',
    description: 'Longer-duration debt is sensitive to interest-rate changes and, where applicable, issuer credit events.',
    insight: 'Bond prices usually move inversely to yields. Holding-period outcomes still depend on duration, reinvestment rates, credit losses, expenses, and withdrawals.',
    scenarios: Object.freeze([
      Object.freeze({ name: '2013 Fed Taper Tantrum', period: 'May 2013 – Sep 2013', impactPct: -5.5, impactKind: 'drawdown', recovery: '6 Months', recoveryMultiplier: 1.04, cause: 'A duration shock based on the 2013 bond sell-off, when rising sovereign yields depressed longer-duration bond prices.', badge: 'Duration Shock' }),
      Object.freeze({ name: 'Corporate NBFC Credit Crisis', period: 'Sep 2018 – Oct 2019', impactPct: -9.5, impactKind: 'drawdown', recovery: '14 Months', recoveryMultiplier: 1.05, cause: 'A credit-event scenario based on the liquidity and valuation stress that followed major NBFC defaults and downgrades.', badge: 'Credit Event' }),
    ]),
  }),
  gold: Object.freeze({
    title: 'Commodity Exposure (Gold / SGB)',
    badgeColor: '#eab308',
    description: 'Gold may diversify portfolio risk, but its price can experience material drawdowns and long recovery cycles.',
    insight: 'Gold can diversify some market shocks, but it is not a guaranteed hedge. Currency, global rates, local duties, and product structure all affect outcomes.',
    scenarios: Object.freeze([
      Object.freeze({ name: '2013 Gold Bear Market', period: 'Apr 2013 – Dec 2015', impactPct: -26, impactKind: 'drawdown', recovery: '60 Months', recoveryMultiplier: 1.08, cause: 'A commodity-cycle scenario reflecting weaker safe-haven demand, a stronger US dollar, and changes in domestic import conditions.', badge: 'Cycle Correction' }),
      Object.freeze({ name: '2020 Post-COVID Rotational Outflow', period: 'Aug 2020 – Mar 2021', impactPct: -15.4, impactKind: 'drawdown', recovery: '18 Months', recoveryMultiplier: 1.03, cause: 'A risk-on rotation scenario in which safe-haven demand falls and investors reallocate capital toward growth assets.', badge: 'Risk-On Rotation' }),
    ]),
  }),
  reit: Object.freeze({
    title: 'Real Estate Investment Trust (REIT)',
    badgeColor: '#ec4899',
    description: 'Listed real-estate vehicles combine property income with market-price, occupancy, and financing-cost risk.',
    insight: 'REIT outcomes depend on occupancy, lease quality, distributions, leverage, interest rates, and market valuation. Property ownership does not prevent listed-price losses.',
    scenarios: Object.freeze([
      Object.freeze({ name: '2020 Commercial Vacancy Shock', period: 'Mar 2020 – Nov 2020', impactPct: -18.2, impactKind: 'drawdown', recovery: '15 Months', recoveryMultiplier: 1.06, cause: 'An occupancy shock scenario representing pandemic-era uncertainty about commercial leasing and tenant demand.', badge: 'Occupancy Shock' }),
      Object.freeze({ name: '2022 Yield Competitiveness Correction', period: 'Apr 2022 – Dec 2022', impactPct: -10.5, impactKind: 'drawdown', recovery: '12 Months', recoveryMultiplier: 1.02, cause: 'A rate shock in which higher sovereign yields reduce the relative appeal of listed real-estate distributions.', badge: 'Spread Compression' }),
    ]),
  }),
  midsmall_equity: Object.freeze({
    title: 'High-Beta Mid & Small-Cap Equity',
    badgeColor: '#ef4444',
    description: 'Mid- and small-cap equity can experience deeper drawdowns because of valuation, liquidity, and business-cycle sensitivity.',
    insight: 'A recovery shown here is a historical scenario, not a promise. Selling during a fall locks in losses, while staying invested still carries the risk of a longer or incomplete recovery.',
    scenarios: Object.freeze([
      Object.freeze({ name: '2008 Global Credit Crash', period: 'Jan 2008 – Mar 2009', impactPct: -72, impactKind: 'drawdown', recovery: '66 Months (5.5 Years)', recoveryMultiplier: 1.25, cause: 'A severe credit-cycle scenario in which funding stress, falling earnings expectations, and thin liquidity amplify equity losses.', badge: 'Liquidity Crash' }),
      Object.freeze({ name: '2018 Mid-Cap Valuation Correction', period: 'Jan 2018 – Feb 2020', impactPct: -42.5, impactKind: 'drawdown', recovery: '32 Months', recoveryMultiplier: 1.15, cause: 'A valuation de-rating scenario incorporating regulatory reclassification, tax changes, and a sharp reversal from elevated valuations.', badge: 'Valuation De-rating' }),
      Object.freeze({ name: '2020 COVID-19 Panic Sell-Off', period: 'Feb 2020 – Mar 2020', impactPct: -46.8, impactKind: 'drawdown', recovery: '10 Months', recoveryMultiplier: 1.35, cause: 'A systemic panic scenario in which lockdown uncertainty and low liquidity accelerate the fall in smaller companies.', badge: 'Systemic Panic' }),
    ]),
  }),
  large_equity: Object.freeze({
    title: 'Large-Cap Blue-Chip / Diversified Equity',
    badgeColor: '#38bdf8',
    description: 'Diversified equity remains exposed to economic cycles, earnings changes, global rates, and institutional capital flows.',
    insight: 'Historical recoveries are not guarantees. A future drawdown can be deeper or last longer, so any equity allocation must remain within the authoritative suitability limits.',
    scenarios: Object.freeze([
      Object.freeze({ name: '2008 Global Financial Crisis', period: 'Jan 2008 – Mar 2009', impactPct: -59.5, impactKind: 'drawdown', recovery: '36 Months (3 Years)', recoveryMultiplier: 1.2, cause: 'A global deleveraging scenario based on the financial crisis and the associated withdrawal of institutional liquidity from Indian equities.', badge: 'Global Meltdown' }),
      Object.freeze({ name: '2020 COVID-19 Pandemic Crash', period: 'Feb 2020 – Mar 2020', impactPct: -38.2, impactKind: 'drawdown', recovery: '9 Months', recoveryMultiplier: 1.18, cause: 'A pandemic panic scenario reflecting synchronized global selling and uncertainty about corporate solvency and economic activity.', badge: 'Pandemic Panic' }),
      Object.freeze({ name: '2022 Fed Rate Hiking Cycle', period: 'Oct 2021 – Jun 2022', impactPct: -16.8, impactKind: 'drawdown', recovery: '7 Months', recoveryMultiplier: 1.08, cause: 'A monetary-tightening scenario combining rising global rates, inflation pressure, geopolitical risk, and foreign-investor outflows.', badge: 'Monetary Tightening' }),
    ]),
  }),
});

const CAPITAL_REFERENCE_TYPES = new Set(['PPF', 'FD', 'RD', 'RBI_Bond', 'G-Sec', 'SCSS', 'SSY', 'NSC', 'KVP', 'POMIS', 'MSSC', 'APY']);
const LIQUID_TYPES = new Set(['Liquid_MF', 'Arbitrage_MF', 'Overnight_MF']);
const LONG_DEBT_TYPES = new Set(['Debt_MF', 'Corporate_Bond', 'Gilt_MF', 'Bond']);
const GOLD_TYPES = new Set(['SGB', 'Gold', 'Gold_ETF']);
const REIT_TYPES = new Set(['REIT', 'InvIT']);
const MID_SMALL_TYPES = new Set(['Midcap_MF', 'Smallcap_MF', 'Direct_Equity', 'Sectoral_MF', 'Thematic_MF']);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}
export function classifyStressInstrument(instrument) {
  if (!instrument || typeof instrument !== 'object') throw new TypeError('Authoritative instrument is required');
  const type = String(instrument.type ?? '').trim();
  const id = normalize(instrument.id);
  const name = normalize(instrument.name);
  const assetClass = normalize(instrument.assetClass);

  if (CAPITAL_REFERENCE_TYPES.has(type) || /(^|[_-])(ppf|fd|rd|scss|ssy|nsc|kvp|pomis|mssc|apy)([_-]|$)/.test(id)) return 'capital_protection_reference';
  if (LIQUID_TYPES.has(type) || id.includes('liquid') || id.includes('overnight') || name.includes('liquid fund')) return 'liquid_debt';
  if (GOLD_TYPES.has(type) || assetClass === 'gold' || id.includes('gold') || name.includes('gold')) return 'gold';
  if (REIT_TYPES.has(type) || assetClass === 'real estate' || id.includes('reit') || id.includes('invit')) return 'reit';
  if (MID_SMALL_TYPES.has(type) || ['midcap', 'smallcap', 'microcap', 'sectoral', 'thematic'].some(token => id.includes(token))) return 'midsmall_equity';
  if (LONG_DEBT_TYPES.has(type) || assetClass === 'debt' || id.includes('debt') || id.includes('bond') || id.includes('gilt')) return 'long_debt';
  return 'large_equity';
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildStressScenarioReport({ instrument, principal }) {
  const numericPrincipal = Number(principal);
  if (!Number.isFinite(numericPrincipal) || numericPrincipal < 1000 || numericPrincipal > 10000000) {
    throw new RangeError('Stress-test principal must be between 1,000 and 10,000,000');
  }
  const type = classifyStressInstrument(instrument);
  const profile = SCENARIO_PROFILES[type];
  const scenarios = profile.scenarios.map((scenario) => {
    const impactMagnitudePct = Math.abs(scenario.impactPct);
    const lostAmount = roundCurrency(numericPrincipal * impactMagnitudePct / 100);
    const bottomValue = roundCurrency(numericPrincipal - lostAmount);
    const recoveryValue = roundCurrency(numericPrincipal * scenario.recoveryMultiplier);
    return {
      name: scenario.name,
      period: scenario.period,
      cause: scenario.cause,
      badge: scenario.badge,
      impact_kind: scenario.impactKind,
      impact_pct: scenario.impactPct,
      impact_magnitude_pct: impactMagnitudePct,
      starting_value: numericPrincipal,
      lost_amount: lostAmount,
      bottom_value: bottomValue,
      recovery_period: scenario.recovery,
      recovery_value: recoveryValue,
      recovery_delta: roundCurrency(recoveryValue - numericPrincipal),
    };
  });

  return {
    calculation_classification: 'NON_RECOMMENDATION_STRESS_WHAT_IF',
    return_basis: 'HISTORICAL_OR_HYPOTHETICAL_SCENARIO',
    not_a_forecast: true,
    instrument_id: instrument.id,
    instrument_type: instrument.type,
    principal: numericPrincipal,
    asset_profile: {
      type,
      title: profile.title,
      badge_color: profile.badgeColor,
      description: profile.description,
      insight: profile.insight,
    },
    scenarios,
    disclosure: 'Scenario assumptions are illustrative and are not a forecast or guarantee. Future losses and recovery periods may differ materially.',
  };
}
