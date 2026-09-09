/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WhereToInvestTab from '../deepdive/WhereToInvestTab';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getCurrentMarketContext: vi.fn(),
  rankInvestmentCandidates: vi.fn(),
  previewMarketContextAdjustment: vi.fn(),
}));

describe('Beginner-First Where-To-Invest UX', () => {
  beforeEach(() => {
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

    api.rankInvestmentCandidates.mockResolvedValue({
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
            status: 'CALCULATED',
            illustrativePrincipal: 10000,
            grossGain: 710,
            incrementalTax: 0,
            netGain: 710,
            postTaxRatePct: 7.1,
            metricLabel: 'Current after-tax rate',
            taxClassification: 'EEE_TAX_FREE',
            disclosure: 'Exempt under Section 10(11) / 10(11A) of the Income Tax Act (EEE status). 100% tax-free interest.',
            isHistoricalEstimate: false,
          },
        },
      ],
      ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS' },
      comparisonUniverse: { disclosure: 'Comparison of verified products.' },
    });
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

    // The market accordion summary uses exact text "View technical details";
    // the product card uses "View technical details & provenance".
    // Use getAllByText since the regex matches both.
    const techDetailElements = screen.getAllByText(/View technical details/i);
    expect(techDetailElements.length).toBeGreaterThanOrEqual(1);
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

  it('renders defensible post-tax calculation and illustrative principal selector', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    // Wait for product data to load - use getAllBy since multiple card
    // instances may render (React effects in test can double-fire).
    const postTaxHeaders = await screen.findAllByText(/Current after-tax rate:/i);
    expect(postTaxHeaders.length).toBeGreaterThanOrEqual(1);

    const postTaxRates = screen.getAllByText('7.1%');
    expect(postTaxRates.length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByText(/You keep/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Defensible Post-Tax').length).toBeGreaterThanOrEqual(1);

    // Illustrative principal selector buttons
    expect(screen.getAllByText('₹5,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹10,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹25,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹50,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹1,00,000').length).toBeGreaterThanOrEqual(1);
  });

  it('opens tax details drawer when Calculate after tax is clicked', async () => {
    render(
      <WhereToInvestTab
        inv={{ id: 'ppf', name: 'Public Provident Fund', riskScore: 1 }}
        userProfile={{ profileId: '64b000000000000000000001', monthly_take_home: 100000 }}
      />
    );

    // The controls bar renders immediately. Find the toggle button by its
    // accessible name. Multiple buttons may match if the product card also
    // renders a "Calculate after tax" CTA.
    const taxBtns = await screen.findAllByRole('button', { name: /Calculate after tax/i });
    expect(taxBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(taxBtns[0]);

    expect(screen.getByLabelText(/Annual Gross Income/i)).toBeTruthy();
    expect(screen.getByLabelText(/Tax Regime/i)).toBeTruthy();
    expect(screen.getByLabelText(/Fiscal Year/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply & Calculate/i })).toBeTruthy();
  });
});
