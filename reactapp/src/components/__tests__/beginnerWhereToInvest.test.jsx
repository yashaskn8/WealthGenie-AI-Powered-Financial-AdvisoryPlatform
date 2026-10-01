/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render as rtlRender, screen, fireEvent, cleanup, within } from '@testing-library/react';
import WhereToInvestTab from '../deepdive/WhereToInvestTab';
import * as api from '../../services/api';
import { resetMarketContextStoreForTest } from '../../state/useMarketContext';

vi.mock('../../services/api', () => ({
  getCurrentMarketContext: vi.fn(),
  rankInvestmentCandidates: vi.fn(),
  previewMarketContextAdjustment: vi.fn(),
  getTaxPolicyMetadata: vi.fn(async () => ({
    currentFiscalYear: 'FY2026-27',
    currentFiscalYearVerified: true,
    verifiedFiscalYears: ['FY2025-26', 'FY2026-27'],
  })),
}));

const CURRENT_STATE_BINDING = {
  profileId: '64b000000000000000000001',
  profileVersion: 1,
  recommendationId: '64b000000000000000000002',
  allocationRevision: 1,
  allocationRevisionId: '64b000000000000000000003',
  portfolioFingerprint: 'a'.repeat(64),
  recommendationFingerprint: 'b'.repeat(64),
};
const CURRENT_RECOMMENDATION_META = {
  recommendationId: CURRENT_STATE_BINDING.recommendationId,
  profile_version: CURRENT_STATE_BINDING.profileVersion,
  allocation_revision: CURRENT_STATE_BINDING.allocationRevision,
  allocation_revision_id: CURRENT_STATE_BINDING.allocationRevisionId,
  portfolio_fingerprint: CURRENT_STATE_BINDING.portfolioFingerprint,
  recommendation_fingerprint: CURRENT_STATE_BINDING.recommendationFingerprint,
};

function render(element, options) {
  if (element?.type === WhereToInvestTab) {
    element = React.cloneElement(element, {
      recommendationMeta: CURRENT_RECOMMENDATION_META,
      ...element.props,
    });
  }
  return rtlRender(element, options);
}

describe('Beginner-First Where-To-Invest UX', () => {
  it('excludes an obsolete product response after profile-version replacement even if abort is ignored', async () => {
    let resolveOld;
    api.rankInvestmentCandidates.mockReturnValueOnce(new Promise(done => { resolveOld = done; }));
    const inv = { id: 'ppf', name: 'PPF', riskScore: 1 };
    const profile = { profileId: '64b000000000000000000001', version: 1 };
    const view = render(<WhereToInvestTab inv={inv} userProfile={profile} />);
    const oldSignal = api.rankInvestmentCandidates.mock.calls[0][3].signal;
    view.rerender(<WhereToInvestTab inv={inv} userProfile={{ ...profile, version: 2 }} recommendationMeta={CURRENT_RECOMMENDATION_META} />);
    expect(await screen.findByTestId('wti-product-ppf:fact')).toBeVisible();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld({ financialStateBinding: CURRENT_STATE_BINDING, products: [{ id: 'obsolete', name: 'Obsolete product', officialRate: { value: 99 } }] }));
    expect(screen.queryByText('Obsolete product')).toBeNull();
    expect(screen.getAllByTestId('wti-product-ppf:fact')).toHaveLength(1);
  });

  it('keeps history, NAV, official rates and missing evidence distinct without expected-return substitution', async () => {
    const shared = { source: { provider: 'AMFI', url: 'javascript:alert(1)' }, presentationStatus: 'EVIDENCE_RANKED' };
    api.rankInvestmentCandidates.mockResolvedValueOnce({ financialStateBinding: CURRENT_STATE_BINDING, products: [
      { ...shared, id: 'history', name: 'Historical fund', historicalReturn: { valuePct: 0, startDate: '2025-09-01', endDate: '2026-09-01' }, nav: { value: 123.456, observedAt: '2026-09-01T10:00:00Z' } },
      { ...shared, id: 'nav', name: 'NAV fund', nav: { value: 123.456 } },
      { ...shared, id: 'unknown', name: 'Unknown fund', nominalReturn: 99, expectedReturn: 99, nav: { value: null } },
    ] });
    render(<WhereToInvestTab inv={{ id: 'index_mf', name: 'Index Fund' }} userProfile={{ profileId: '64b000000000000000000001' }} />);
    const history = within(await screen.findByTestId('wti-product-history'));
    expect(history.getByText('Historical 1Y return')).toBeVisible();
    expect(history.getByText('0.00% historical')).toBeVisible();
    expect(history.getByText(/Source: AMFI/, { selector: 'span' })).toBeVisible();
    expect(history.getByText(/As of: 1 Sept 2026/)).toBeVisible();
    expect(history.queryByRole('link')).toBeNull();
    const nav = within(screen.getByTestId('wti-product-nav'));
    expect(nav.getByText('Current NAV')).toBeVisible();
    expect(nav.getByText('₹123.456')).toBeVisible();
    const unavailable = within(screen.getByTestId('wti-product-unknown'));
    expect(unavailable.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(unavailable.queryByText(/99/)).toBeNull();
  });

  it('renders exact ETF identity and NAV separately from unavailable market price and product facts', async () => {
    api.rankInvestmentCandidates.mockResolvedValueOnce({
      financialStateBinding: CURRENT_STATE_BINDING,
      ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS' },
      products: [{
        id: 'etf:isin:INF204KB14I2',
        canonicalProductId: 'etf:isin:INF204KB14I2',
        name: 'Issuer scheme label',
        productType: 'ETF',
        presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
        provider: 'Nippon India Mutual Fund',
        exchange: 'NSE',
        ticker: 'NIFTYBEES',
        isin: 'INF204KB14I2',
        benchmark: {
          name: 'NIFTY 50',
          returnVariant: 'NIFTY 50 TRI',
          source: { url: 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf' },
        },
        identityEvidence: [{
          authority: 'NSE',
          url: 'https://nsearchives.nseindia.com/trading_security/mf/pdf/scheme.pdf',
        }],
        source: { provider: 'AMFI', url: 'https://portal.amfiindia.com/spages/NAVAll.txt' },
        nav: { value: 250.25, unit: 'NAV_PER_UNIT', observedAt: '2026-10-01T09:55:00.000Z' },
        historicalReturn: {
          valuePct: 2.3,
          basis: 'HISTORICAL_NAV_RETURN',
          startDate: '2025-10-01',
          endDate: '2026-10-01',
        },
        marketPrice: { value: null, availabilityStatus: 'UNAVAILABLE' },
        productEligibility: { status: 'PARENT_SUITABILITY_PASSED_PRODUCT_ACCESS_FACTS_UNAVAILABLE' },
        riskEvidence: null,
        liquidityEvidence: null,
        postTaxAnalysis: {
          status: 'TAX_CLASSIFICATION_UNAVAILABLE',
          dataClass: 'UNAVAILABLE',
          requiredTaxInputs: [],
          unavailableReasons: ['TAX_CLASSIFICATION_UNAVAILABLE'],
        },
      }],
    });

    render(<WhereToInvestTab
      inv={{ id: 'nifty_etf', name: 'Nifty 50 ETF' }}
      userProfile={{ profileId: '64b000000000000000000001' }}
    />);
    const card = within(await screen.findByTestId('wti-product-etf:isin:INF204KB14I2'));
    expect(card.getByText('Issuer scheme label')).toBeVisible();
    fireEvent.click(card.getByText('View technical details & provenance'));
    expect(card.getByText(/NIFTY 50 \(NIFTY 50 TRI\)/)).toBeVisible();
    expect(card.getByText('Exchange / ticker: NSE / NIFTYBEES')).toBeVisible();
    expect(card.getByText('ISIN: INF204KB14I2')).toBeVisible();
    expect(card.getByText('Exchange market price: Unavailable')).toBeVisible();
    expect(card.getByText('Fund NAV: ₹250.25')).toBeVisible();
    expect(card.getByText('Historical 1Y return')).toBeVisible();
    expect(card.getByText('2.30% historical')).toBeVisible();
    expect(card.getByText(/No defensible merit order is claimed for this comparable option/)).toBeVisible();
    expect(card.getByText(/A verified historical return is shown for context only; historical performance is not an expected return/)).toBeVisible();
    expect(card.getByText('Risk classification unavailable')).toBeVisible();
    expect(card.getByText('Access terms unavailable')).toBeVisible();
    expect(card.getByText(/tax classification unavailable/)).toBeVisible();
    expect(card.getByRole('link', { name: 'NSE evidence' })).toHaveAttribute('href', 'https://nsearchives.nseindia.com/trading_security/mf/pdf/scheme.pdf');
    expect(card.getByRole('link', { name: 'Benchmark evidence' })).toHaveAttribute('href', 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf');
  });

  it('marks retained market facts previous after a failed provider refresh and never invents risk for null', async () => {
    api.getCurrentMarketContext.mockResolvedValueOnce({ status: 'MARKET_CONTEXT_AVAILABLE', context: 'NORMAL', marketSnapshot: { status: 'CURRENT' }, signals: {} });
    render(<WhereToInvestTab inv={{ id: 'ppf', name: 'PPF', riskScore: null }} userProfile={{ profileId: '64b000000000000000000001' }} />);
    expect(await screen.findByText('Current verified data')).toBeVisible();
    api.getCurrentMarketContext.mockRejectedValueOnce(new Error('503 provider unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh market data' }));
    expect(await screen.findByText('Last available data')).toBeVisible();
    expect(screen.queryByText('Current verified data')).toBeNull();
    expect(screen.getByText(/Refresh failed; showing the last verified snapshot/i)).toBeVisible();
  });

  it('shows a product-provider failure without retaining a previous financial-state result', async () => {
    api.rankInvestmentCandidates.mockRejectedValueOnce(new Error('503'));
    render(<WhereToInvestTab inv={{ id: 'ppf', name: 'PPF' }} userProfile={{ profileId: '64b000000000000000000001' }} />);
    expect(await screen.findByText(/Authoritative product ranking is temporarily unavailable/i)).toBeVisible();
    expect(screen.queryByTestId('wti-product-ppf:fact')).toBeNull();
  });
  afterEach(() => {
    cleanup();
    resetMarketContextStoreForTest();
  });

  beforeEach(() => {
    resetMarketContextStoreForTest();
    vi.clearAllMocks();

    api.getCurrentMarketContext.mockResolvedValue({
      status: 'MARKET_CONTEXT_AVAILABLE',
      context: 'CAUTIOUS',
      classification: 'DETERMINISTIC_POLICY_HEURISTIC',
      policyVersion: 'market-context-policy-1.0.0',
      observedAt: '2026-09-08T10:00:00.000Z',
      evaluatedAt: '2026-09-08T10:01:00.000Z',
      freshness: { status: 'FRESH' },
      reasonCodes: ['DRAWDOWN_EXCEEDS_CAUTION_THRESHOLD', 'VIX_ABOVE_CAUTION_LEVEL'],
      signals: {
        nifty50Current: { value: 23450.5, unit: 'INDEX_POINTS', available: true },
        movingAverage50Day: { value: 24100.2, unit: 'INDEX_POINTS', available: true },
        movingAverage200Day: { value: 23100.0, unit: 'INDEX_POINTS', available: true },
      },
      sources: [{ provider: 'NSE', instrumentId: 'NIFTY 50', dataClass: 'LIVE' }],
    });

    api.rankInvestmentCandidates.mockImplementation(async (_profileId, _parentId, _taxContext, _options, financialStateBinding) => ({
      financialStateBinding,
      products: [
        {
          id: 'ppf:fact',
          name: 'Public Provident Fund',
          provider: 'Government of India',
          source: { provider: 'India Post' },
          productType: 'GOVERNMENT_SAVINGS',
          parentInstrumentId: 'ppf',
          officialRate: { value: 7.1 },
          presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
          beginnerSuitability: {
            whyThisFitsYou: 'Shown because you selected Retirement and Wealth Growth. Backed by the Government of India with 100% sovereign safety.',
            riskTier: 'Very Low Risk',
            accessToMoney: '15-year term (partial withdrawal permitted from year 7)',
            verifiedFactLabel: 'Current official rate',
            verifiedFactValue: '7.10% p.a.',
            sourceProvider: 'India Post',
          },
          postTaxAnalysis: {
            status: 'TAX_CLASSIFICATION_REQUIRES_ACQUISITION_FACTS',
            dataClass: 'UNAVAILABLE',
            requiredTaxInputs: ['verifiedAccountEligibility', 'contributionHistory', 'withdrawalOrMaturityFacts'],
            unavailableReasons: ['PPF_SSY_EXCLUSION_ELIGIBILITY_NOT_ESTABLISHED'],
            taxClassification: 'PPF_ACCOUNT_EXCLUSION_CONDITIONAL',
            disclosure: 'No account-qualification or contribution/exit evidence is available to establish the statutory exclusion for this account. No tax-free result or after-tax rate is inferred from the product name or scheme category.',
            isHistoricalEstimate: false,
          },
        },
      ],
      ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS' },
      comparisonUniverse: { disclosure: 'Comparison of verified products.' },
    }));
  });

  it('renders beginner-first market view and collapses raw engineering panel', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    expect(await screen.findByText('Market today')).toBeTruthy();
    expect(screen.getByText('CAUTIOUS')).toBeTruthy();
    expect(screen.getByText(/Markets have been weaker recently/i)).toBeTruthy();
    expect(screen.getByText(/What this means for you:/i)).toBeTruthy();

    // Technical details button exists and panel is collapsed by default
    const marketTechBtn = screen.getByRole('button', { name: /technical details/i });
    expect(marketTechBtn).toBeTruthy();
    expect(marketTechBtn.getAttribute('aria-expanded')).toBe('false');

    const panel = screen.getByTestId('market-context-panel');
    expect(panel).not.toBeVisible();

    // Raw engineering data is not exposed in the visible default view
    expect(screen.getByText(/DETERMINISTIC_POLICY_HEURISTIC/)).not.toBeVisible();
    expect(screen.getByText(/market-context-policy-1.0.0/)).not.toBeVisible();
    expect(screen.getByText(/DRAWDOWN_EXCEEDS_CAUTION_THRESHOLD/)).not.toBeVisible();

    // See how this affects my plan action is available
    expect(screen.getByRole('button', { name: /see how this affects my plan/i })).toBeTruthy();
  });

  it('toggles technical details visibility with click and preserves financial metrics', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    const techBtn = await screen.findByRole('button', { name: /technical details/i });
    expect(techBtn.getAttribute('aria-expanded')).toBe('false');
    const panel = screen.getByTestId('market-context-panel');
    expect(panel).not.toBeVisible();

    // Click to expand
    fireEvent.click(techBtn);
    expect(techBtn.getAttribute('aria-expanded')).toBe('true');
    expect(panel).toBeVisible();

    // Humanized labels and exact financial values verified inside expanded view
    expect(screen.getByText('NIFTY 50')).toBeVisible();
    expect(screen.getByText('23,450.5')).toBeVisible();
    expect(screen.getByText('50-day moving average')).toBeVisible();
    expect(screen.getByText('24,100.2')).toBeVisible();
    expect(screen.getByText('200-day moving average')).toBeVisible();
    expect(screen.getByText('23,100')).toBeVisible();

    // Provenance and policy data visible
    expect(screen.getByText(/DETERMINISTIC_POLICY_HEURISTIC/)).toBeVisible();
    expect(screen.getByText(/DRAWDOWN_EXCEEDS_CAUTION_THRESHOLD/)).toBeVisible();

    // Click to collapse
    fireEvent.click(techBtn);
    expect(techBtn.getAttribute('aria-expanded')).toBe('false');
    expect(panel).not.toBeVisible();
  });

  it('supports keyboard interaction on the technical details control', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    const techBtn = await screen.findByRole('button', { name: /technical details/i });
    const panel = screen.getByTestId('market-context-panel');
    expect(panel).not.toBeVisible();

    fireEvent.click(techBtn);
    expect(panel).toBeVisible();

    fireEvent.click(techBtn);
    expect(panel).not.toBeVisible();
  });

  it('renders appropriate context badges for NORMAL, HIGH_VOLATILITY, and RISK_OFF', async () => {
    api.getCurrentMarketContext.mockResolvedValueOnce({
      status: 'MARKET_CONTEXT_AVAILABLE',
      context: 'NORMAL',
      classification: 'DETERMINISTIC_POLICY_HEURISTIC',
      policyVersion: 'market-context-policy-1.0.0',
      observedAt: '2026-09-08T10:00:00.000Z',
      freshness: { status: 'FRESH' },
      signals: {},
      sources: [],
    });

    const { unmount } = render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    expect(await screen.findByText('NORMAL')).toBeTruthy();
    expect(screen.getByText(/Market conditions look steady/i)).toBeTruthy();
    unmount();
    resetMarketContextStoreForTest();

    api.getCurrentMarketContext.mockResolvedValueOnce({
      status: 'MARKET_CONTEXT_AVAILABLE',
      context: 'HIGH_VOLATILITY',
      classification: 'DETERMINISTIC_POLICY_HEURISTIC',
      policyVersion: 'market-context-policy-1.0.0',
      observedAt: '2026-09-08T10:00:00.000Z',
      freshness: { status: 'FRESH' },
      signals: {},
      sources: [],
    });

    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    expect(await screen.findByText('HIGH VOLATILITY')).toBeTruthy();
    expect(screen.getByText(/Markets are moving more sharply than usual/i)).toBeTruthy();

    cleanup();
    resetMarketContextStoreForTest();

    api.getCurrentMarketContext.mockResolvedValueOnce({
      status: 'MARKET_CONTEXT_AVAILABLE',
      context: 'RISK_OFF',
      classification: 'DETERMINISTIC_POLICY_HEURISTIC',
      policyVersion: 'market-context-policy-1.0.0',
      observedAt: '2026-09-08T10:00:00.000Z',
      freshness: { status: 'FRESH' },
      signals: {},
      sources: [],
    });

    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    expect(await screen.findByText('RISK OFF')).toBeTruthy();
    expect(screen.getByText(/Market risk is elevated right now/i)).toBeTruthy();
  });

  it('triggers profile-safe adjustment preview when See how this affects my plan is clicked', async () => {
    api.previewMarketContextAdjustment.mockResolvedValueOnce({
      applied: true,
      actualTotalTiltPct: 3.5,
      explanations: ['Slight shift to short-term sovereign instruments'],
    });

    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    const previewBtn = await screen.findByRole('button', { name: /see how this affects my plan/i });
    expect(previewBtn).toBeTruthy();
    expect(previewBtn.disabled).toBe(false);

    fireEvent.click(previewBtn);

    expect(api.previewMarketContextAdjustment).toHaveBeenCalledWith('64b000000000000000000001', { signal: expect.any(AbortSignal) });
    expect(await screen.findByText(/Adjustment Preview Ready ✓/i)).toBeTruthy();
    expect(screen.getByText(/bounded 3.5% total tilt/i)).toBeTruthy();
  });

  it('renders plain-English Why this fits you, risk tier, and access to money', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    expect(await screen.findByText('Public Provident Fund')).toBeTruthy();

    // Product card renders "Very Low Risk" chip — getAllsince the text
    // may appear in more than one rendered card instance.
    const riskChips = screen.getAllByText('Very Low Risk');
    expect(riskChips.length).toBeGreaterThanOrEqual(1);

    const accessTexts = screen.getAllByText(/15-year term/i);
    expect(accessTexts.length).toBeGreaterThanOrEqual(1);

    const whyFitsLabels = screen.getAllByText(/Why this fits you/i);
    expect(whyFitsLabels.length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText(/Backed by the Government of India with 100% sovereign safety/i).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps PPF tax treatment unavailable without account facts and retains only relevant principal controls', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    const ppf = within(await screen.findByTestId('wti-product-ppf:fact'));
    expect(ppf.getByText(/Exact-product tax illustration: tax classification requires acquisition facts/i)).toBeVisible();
    expect(ppf.getByText(/No tax-free result or after-tax rate is inferred/i)).toBeVisible();
    expect(ppf.queryByText('Defensible Post-Tax')).toBeNull();
    expect(screen.queryByRole('button', { name: /Exact-product tax illustration/i })).toBeNull();

    // Illustrative principal selector buttons
    expect(screen.getAllByText('₹5,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹10,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹25,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹50,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹1,00,000').length).toBeGreaterThanOrEqual(1);
  });

  it('prioritizes an official current rate over historical return in the product card', async () => {
    api.rankInvestmentCandidates.mockResolvedValueOnce({
      financialStateBinding: CURRENT_STATE_BINDING,
      products: [{
        id: 'fd:official',
        name: 'Verified Term Deposit',
        provider: 'Verified Bank',
        source: { provider: 'SBI' },
        officialRate: { value: 7.25, dataClass: 'OFFICIAL_BANK_PUBLISHED_RATE' },
        historicalReturn: { valuePct: 99 },
        presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
        beginnerSuitability: { riskTier: 'Low Risk', accessToMoney: 'Source terms required' },
      }],
      ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS' },
    });

    render(
      <WhereToInvestTab
        inv={{ id: 'fd', name: 'Verified Term Deposits', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001' }}
      />
    );

    expect(await screen.findByText('Current official bank rate')).toBeTruthy();
    expect(screen.getByText('7.25% p.a.')).toBeTruthy();
    expect(screen.queryByText('99.00% historical')).toBeNull();
  });

  it('describes an RBI floating coupon with reset semantics instead of bank-rate wording', async () => {
    api.rankInvestmentCandidates.mockResolvedValueOnce({
      financialStateBinding: CURRENT_STATE_BINDING,
      products: [{
        id: 'rbi:frsb',
        name: 'RBI Floating Rate Savings Bonds',
        provider: 'RBI',
        source: { provider: 'RBI' },
        productType: 'GOVERNMENT_BOND',
        parentInstrumentId: 'rbi_bonds',
        officialRate: {
          value: 8.05,
          dataClass: 'OFFICIAL_RBI_FLOATING_COUPON_RATE',
          effectiveFrom: '2026-07-01',
          effectiveTo: '2026-12-31',
        },
        presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
        beginnerSuitability: { riskTier: 'Very Low Risk', accessToMoney: '7-year maturity' },
      }],
      ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS' },
    });

    render(
      <WhereToInvestTab
        inv={{ id: 'rbi_bonds', name: 'RBI Floating Rate Savings Bonds', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001' }}
      />
    );

    expect(await screen.findByText(/Current RBI Floating Rate Savings Bond coupon effective 2026-07-01 to 2026-12-31/i)).toBeTruthy();
    expect(screen.getByText(/resets on January 1 and July 1/i)).toBeTruthy();
    expect(screen.getByText(/not a fixed 7-year guaranteed rate/i)).toBeTruthy();
    expect(screen.queryByText(/Official bank-published card rate/i)).toBeNull();
  });

  it('renders each backend-declared supported tax input without silently defaulting blank facts', async () => {
    api.rankInvestmentCandidates.mockResolvedValueOnce({
      financialStateBinding: CURRENT_STATE_BINDING,
      products: [{
        id: 'deposit:tax', name: 'Source-qualified deposit', parentInstrumentId: 'fd',
        postTaxAnalysis: {
          status: 'REQUIRES_TAX_INPUTS',
          requiredTaxInputs: ['annualGrossIncome', 'incomeSource', 'regime', 'fiscalYear', 'userAge'],
        },
      }],
      ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS' },
    });
    render(
      <WhereToInvestTab
        inv={{ id: 'fd', name: 'Term deposit', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', age: 30, monthly_take_home: 100000 }}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /Exact-product tax illustration/i }));
    const income = screen.getByLabelText(/Annual Gross Income/i);
    expect(income).toHaveValue(null);
    expect(screen.getByLabelText(/Income source/i)).toBeVisible();
    expect(screen.getByLabelText(/Tax Regime/i)).toBeVisible();
    expect(screen.getByLabelText(/Fiscal Year/i)).toBeVisible();
    expect(screen.getByLabelText(/Your age/i)).toHaveValue(30);
    expect(screen.getByRole('button', { name: /Apply & Calculate/i })).toBeVisible();
  });
});
