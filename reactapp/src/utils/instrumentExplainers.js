/**
 * WealthGenie — Beginner-Friendly Instrument Explainers
 * Plain-language descriptions for every instrument type.
 * Designed for first-time Indian investors.
 */

export const INSTRUMENT_EXPLAINERS = {
  ppf: {
    what: 'A government savings scheme where your money grows tax-free. The interest rate is guaranteed by the government, and you pay zero tax on the returns.',
    risk_plain: 'Zero risk — your money is protected by the government.',
    lock_in_plain: '15-year term. You can take partial withdrawals after 7 years.',
    who_for: 'Anyone who wants safe, guaranteed, tax-free growth over the long term.',
    example: 'Invest ₹1,500/month for 15 years → approximately ₹4.9 lakhs (all tax-free).',
  },
  scss: {
    what: 'A savings account at post offices and banks specifically for people aged 60 and above. The government guarantees the interest rate of 8.2% per year.',
    risk_plain: 'Very low risk — your capital is fully protected by the government.',
    lock_in_plain: '5-year term. You can exit early with a small penalty after 1 year.',
    who_for: 'Senior citizens who want safe, regular quarterly income.',
    example: 'Invest ₹1,200/month → earn approximately 8.2% per year, paid every quarter.',
  },
  pmvvy: {
    what: 'A government-guaranteed pension scheme for senior citizens aged 60+. You invest a lump sum and receive a guaranteed pension every month.',
    risk_plain: 'Very low risk — government guarantee on both principal and returns.',
    lock_in_plain: '10-year term. Premature exit allowed with a small penalty after 3 years.',
    who_for: 'Senior citizens who want guaranteed monthly pension income.',
    example: 'Invest ₹15 lakhs → receive approximately ₹9,250/month as pension for 10 years.',
  },
  fd: {
    what: 'A fixed amount deposited in a bank for a fixed period at a guaranteed interest rate. Your deposits up to ₹5 lakhs are insured by the government.',
    risk_plain: 'Very low — deposits up to ₹5L are insured by DICGC.',
    lock_in_plain: 'Flexible terms from 7 days to 10 years. Can break early with a small penalty.',
    who_for: 'Anyone who wants a safe, predictable return with easy access to money.',
    example: 'Deposit ₹1,000/month for 5 years at 7.25% → approximately ₹72,000.',
  },
  sgb: {
    what: 'A government bond whose value follows the price of gold. You also earn 2.5% interest per year, and pay zero capital gains tax if you hold it for 8 years.',
    risk_plain: 'Low-medium — your returns depend on gold price movement.',
    lock_in_plain: '8-year maturity. You can sell on the stock exchange from year 5 onwards.',
    who_for: 'Investors who want gold exposure without buying physical gold, and want to save on tax.',
    example: 'If gold grows at 8%/year, your total return is ~10.5%/year including the 2.5% interest bonus.',
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
    who_for: 'Working professionals planning for retirement income who want an extra tax deduction.',
    example: 'Invest ₹1,500/month for 25 years → approximately ₹20-25 lakhs at retirement, plus monthly pension.',
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
    example: 'Nifty 50 has grown at ~12.5% per year over the last 15 years.',
  },
  elss: {
    what: 'A mutual fund that invests in company shares and gives you a tax deduction of up to ₹1.5 lakh under Section 80C.',
    risk_plain: 'High — your money can go up or down with the stock market.',
    lock_in_plain: 'Each SIP installment is locked for 3 years from the date of investment, not from account opening.',
    who_for: 'Investors who want long-term growth AND want to save income tax (old tax regime).',
    example: 'Invest ₹1,500/month. After 3 years you could have approximately ₹65,000-₹75,000 depending on markets.',
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
    what: 'Bonds issued directly by the Reserve Bank of India. The interest rate floats with the government\'s NSC rate + 0.35%.',
    risk_plain: 'Very low — backed by the full faith of the Government of India.',
    lock_in_plain: '7-year lock-in. No premature exit allowed (except for 60+ age group).',
    who_for: 'Conservative investors who want the highest safe return with sovereign guarantee.',
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
  ppf: 'Government savings — tax-free growth, 15yr term',
  scss: 'Post office savings for seniors — safe 8.2% income',
  pmvvy: 'Government pension for seniors — guaranteed monthly income',
  fd: 'Bank fixed deposit — guaranteed return, capital safe',
  sgb: 'Government gold bonds — 8yr, interest + gold gains',
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
  rbi_bonds: 'RBI sovereign bonds — 7yr, highest safe rate',
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
