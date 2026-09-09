/**
 * WealthGenie — Beginner-Friendly Instrument Explainers
 * Plain-language descriptions for every instrument type.
 * Designed for first-time Indian investors.
 */

export const INSTRUMENT_EXPLAINERS = {
  ppf: {
    what: 'A long-term government savings scheme with an administered interest rate and tax treatment governed by current rules.',
    risk_plain: 'Sovereign-backed principal, with inflation, liquidity and reinvestment risks still relevant.',
    lock_in_plain: 'Exact term and withdrawal rules must be verified from the current official scheme source.',
    who_for: 'Eligible investors seeking a long-term government-backed savings allocation and able to accept restricted liquidity.',
    example: 'Current official rate and effective interval are shown only when the government provider succeeds.',
  },
  scss: {
    what: 'A government-backed savings scheme offered through eligible post offices and banks for qualifying senior citizens. Its administered rate can change.',
    risk_plain: 'Low credit risk, with inflation, liquidity and reinvestment risks still relevant.',
    lock_in_plain: 'Exact maturity and exit rules must be verified from the current official scheme source.',
    who_for: 'Potentially eligible senior citizens after source-backed age and scheme checks pass.',
    example: 'Current official rate and effective interval are shown only when the government provider succeeds.',
  },
  pmvvy: {
    what: 'A government-backed pension product for eligible senior citizens in which a lump sum funded a defined pension under the applicable scheme terms.',
    risk_plain: 'Low credit risk under the scheme terms, with liquidity and inflation risks still relevant.',
    lock_in_plain: 'Current availability, term, and exit rules are unavailable in this reference explainer.',
    who_for: 'Eligible senior citizens comparing defined pension income with the scheme\'s liquidity constraints.',
    example: 'No static pension or return value is used; unavailable facts remain unavailable.',
  },
  fd: {
    what: 'A fixed amount deposited with a bank for a selected term and contracted interest rate. Deposit insurance is subject to DICGC limits and conditions.',
    risk_plain: 'Bank, ownership, and insurance scope must be verified; no deposit is labeled risk-free here.',
    lock_in_plain: 'Tenure and premature-withdrawal terms depend on the exact bank product.',
    who_for: 'Eligible investors whose required tenure matches a source-qualified bank product.',
    example: 'Where to Invest shows an official bank-published rate only for a source-established comparable tenure and depositor class.',
  },
  sgb: {
    what: 'A government-issued gold-linked bond with tranche-specific coupon, maturity, liquidity, and tax terms.',
    risk_plain: 'Low-medium — your returns depend on gold price movement.',
    lock_in_plain: 'Verify the exact tranche maturity, redemption windows, and secondary-market liquidity.',
    who_for: 'Investors eligible for the exact tranche who understand gold-price and liquidity risk.',
    example: 'No static coupon, gold growth, or tax outcome is presented as current evidence.',
  },
  gold_etf: {
    what: 'Instead of buying physical gold, you buy units that track the price of gold. You can buy and sell any time on the stock exchange.',
    risk_plain: 'Moderate — gold prices can rise and fall over short periods.',
    lock_in_plain: 'No lock-in. You can sell any time during market hours.',
    who_for: 'Investors who want a safety net against inflation and market crashes.',
  },
  debt_mf: {
    what: 'A mutual fund that invests in bonds and fixed-income securities instead of company shares. More liquid than a bank FD with similar returns.',
    risk_plain: 'Low-medium — more stable than equity funds, but returns can vary.',
    lock_in_plain: 'No lock-in. You can withdraw any time (T+1 or T+2 settlement).',
    who_for: 'Investors who want better liquidity than FD with comparable returns.',
  },
  nps: {
    what: 'A government-backed retirement savings plan. Professional fund managers invest your money in a mix of shares and bonds. You get a pension when you retire.',
    risk_plain: 'Moderate — part of your money goes into shares (can fluctuate), part into safe bonds.',
    lock_in_plain: 'Locked until you turn 60. Partial withdrawal allowed after 3 years for specific reasons (education, medical, home).',
    who_for: 'Eligible investors planning for retirement after reviewing current contribution, access, and tax rules.',
    example: 'Use the backend model projection with explicit assumptions; no tax saving is presumed.',
  },
  hybrid_mf: {
    what: 'A mutual fund that mixes shares (equity) and bonds (debt) in one investment. It automatically shifts between the two based on market conditions.',
    risk_plain: 'Moderate — less risky than pure equity funds because bonds cushion the falls.',
    lock_in_plain: 'No lock-in. You can withdraw any time.',
    who_for: 'Investors who want equity-like growth with lower ups and downs.',
  },
  index_mf: {
    what: 'A mutual fund that buys all 50 stocks in the Nifty 50 index. You essentially own a small piece of India\'s top 50 companies.',
    risk_plain: 'Moderate — your money moves with the stock market, but spread across 50 companies.',
    lock_in_plain: 'No lock-in. You can withdraw any time.',
    who_for: 'First-time equity investors who want market returns at the lowest possible cost.',
    example: 'Historical index performance is not used here as an expected return.',
  },
  elss: {
    what: 'An equity-linked savings fund whose tax eligibility requires verified product classification and current fiscal-year rules.',
    risk_plain: 'High — your money can go up or down with the stock market.',
    lock_in_plain: 'Each SIP installment is locked for 3 years from the date of investment, not from account opening.',
    who_for: 'Eligible investors who accept equity risk and have verified the exact scheme and applicable tax treatment.',
    example: 'Use the backend model projection with explicit assumptions; no tax saving or future value is presumed.',
  },
  nifty_etf: {
    what: 'Like a Nifty 50 Index Fund, but traded on the stock exchange in real-time. You need a demat account to buy this.',
    risk_plain: 'Moderate — same risk as a Nifty 50 Index Fund.',
    lock_in_plain: 'No lock-in. You can sell any time during market hours.',
    who_for: 'Investors who already have a demat account and want real-time trading of index exposure.',
  },
  midcap_mf: {
    what: 'A mutual fund that invests in mid-sized companies. These companies are growing faster than large ones, but are more volatile.',
    risk_plain: 'High — mid-sized companies can swing more than large ones. Expect bigger ups AND bigger downs.',
    lock_in_plain: 'No lock-in. But best held for 7+ years to ride out volatility.',
    who_for: 'Experienced investors under 50 with a long horizon who can tolerate bigger market swings.',
  },
  smallcap_mf: {
    what: 'A mutual fund that invests in small-sized companies. Highest growth potential, but also the most volatile category.',
    risk_plain: 'Very high — can lose 30-40% in a bad year. Needs 10+ year patience.',
    lock_in_plain: 'No lock-in. But you should commit for at least 10 years.',
    who_for: 'Young, high-income investors with high risk tolerance and 10+ year horizon.',
  },
  direct_equity: {
    what: 'Buying shares of individual companies directly on the stock exchange. You need a demat account and must do your own research.',
    risk_plain: 'Very high — individual company stocks can crash. Diversify across 10-15 stocks.',
    lock_in_plain: 'No lock-in. You can sell any time during market hours.',
    who_for: 'Experienced investors who can research companies and monitor their portfolio actively.',
  },
  rbi_bonds: {
    what: 'A reference label for an RBI/government bond class. Exact issuance, coupon, eligibility, and terms are not source-qualified in the current product provider.',
    risk_plain: 'Unavailable until backing and the exact instrument are source-qualified; liquidity and inflation risk still apply.',
    lock_in_plain: 'Unavailable until the exact instrument and official terms are established.',
    who_for: 'Unavailable until a specific source-qualified product passes suitability.',
  },
  liquid_mf: {
    what: 'A mutual fund that invests in very short-term debt instruments. Your money is available within 1 business day.',
    risk_plain: 'Very low — extremely stable, minimal fluctuation.',
    lock_in_plain: 'No lock-in. Instant or T+1 day redemption.',
    who_for: 'Anyone who needs a parking place for emergency funds or short-term savings.',
  },
};

// One-line plain-language subtitles for rec cards
export const CARD_SUBTITLES = {
  ppf: 'Government savings — official rate shown in Where to Invest',
  scss: 'Senior savings scheme — official rate shown when source-qualified',
  pmvvy: 'Government-backed pension product for eligible seniors',
  fd: 'Bank fixed deposit — contracted rate, subject to bank and insurance limits',
  sgb: 'Government gold bonds — exact tranche terms required',
  gold_etf: 'Digital gold — tracks gold price, no physical holding',
  debt_mf: 'Bond-based fund — steadier returns than equity',
  nps: 'Government retirement scheme — pension at age 60',
  hybrid_mf: 'Mix of shares and bonds — balanced growth',
  index_mf: 'Tracks Nifty 50 — buy a piece of India\'s top 50 companies',
  elss: 'Tax-saving fund — company shares with 3yr lock-in',
  nifty_etf: 'Stock market tracker — low cost, high liquidity',
  midcap_mf: 'Mid-sized company fund — higher growth, higher swings',
  smallcap_mf: 'Small company fund — highest potential, highest risk',
  direct_equity: 'Direct stock buying — uncapped potential, needs research',
  rbi_bonds: 'RBI/government bond reference — product facts unavailable',
  liquid_mf: 'Instant-access fund — park emergency savings here',
};

// Plain-language risk labels for hover tooltips
export const RISK_PLAIN_LABELS = {
  'Very Low':    'Steady — rarely changes in value',
  'Low':         'Mostly stable — small changes expected',
  'Low-Medium':  'Generally stable — occasional dips possible',
  'Medium-Low':  'Generally stable — occasional dips possible',
  'Medium':      'Moderate ups and downs — normal for investing',
  'High':        'Can swing significantly — needs patience',
  'Very High':   'Can lose or gain a lot — highest potential, highest risk',
};

// ELSS lock-in warning for short-horizon profiles
export function getLockInWarning(instrument, horizonYears) {
  if (!instrument || !['elss', 'ELSS'].includes(instrument.id || instrument.type)) return null;
  if (horizonYears <= 5) {
    const sipMonthsLocked = Math.min(36, horizonYears * 12);
    return `Each ELSS SIP is locked for 3 years. Your last ${sipMonthsLocked} months of SIPs will still be locked when your ${horizonYears}-year horizon ends.`;
  }
  return null;
}
