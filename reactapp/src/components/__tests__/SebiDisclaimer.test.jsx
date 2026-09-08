/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SebiDisclaimer from '../SebiDisclaimer';
import WhereToInvestTab from '../deepdive/WhereToInvestTab';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  rankInvestmentCandidates: vi.fn(async () => ({
    products: Array.from({ length: 2 }, (_, index) => ({
      id: `mf:amfi:${index + 1}`,
      name: `Verified Fund ${index + 1}`,
      provider: `Verified AMC ${index + 1}`,
      source: { provider: 'AMFI', instrumentId: String(index + 1) },
      nav: { value: 12.34 + index },
      valuationDate: '2026-09-07',
      freshness: { status: 'FRESH' },
      plan: index === 0 ? 'Direct Plan' : null,
      option: 'Growth Option',
      presentationStatus: 'VERIFIED_COMPARABLE_OPTION',
      nominalReturn: null,
      riskLevel: null,
    })),
    catalog: { dataClass: 'REFERENCE_METADATA', note: 'Reference text only.' },
    ranking: { status: 'VERIFIED_COMPARABLE_OPTIONS', authority: 'VERIFIED_AMFI_CURRENT_NAV_ONLY', warning: 'Display order is not a ranking.' },
    comparisonUniverse: {
      disclosure: 'Verified AMFI category products.',
      verifiedCategoryProductCount: 8,
      freshNavProductCount: 7,
      sourceEstablishedDirectPlanProductCount: 2,
      historicalEvidenceProductCount: 0,
    },
  })),
  getCurrentMarketContext: vi.fn(async () => ({
    status: 'MARKET_CONTEXT_UNAVAILABLE',
    context: null,
    classification: 'DETERMINISTIC_POLICY_HEURISTIC',
    policyVersion: 'market-context-policy-1.0.0',
    confidence: null,
    reasonCodes: ['PROVIDER_NOT_CONFIGURED'],
    signals: {},
    sources: [],
  })),
  previewMarketContextAdjustment: vi.fn(async () => ({ applied: false, explanations: [] })),
}));

describe('SebiDisclaimer Component', () => {
  it('renders regulatory disclaimer text', () => {
    render(<SebiDisclaimer />);
    const matches = screen.getAllByText(/Not SEBI-registered investment advice/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(/Mutual fund investments are subject to market risk/i)).toBeTruthy();
  });

  it('renders verified comparable options without presenting their display order as a ranking', async () => {
    const mockInv = { id: 'mid_cap_stocks', name: 'Mid Cap Growth Stocks', riskLevel: 5 };
    render(<WhereToInvestTab inv={mockInv} userProfile={{ profileId: '64b000000000000000000001' }} />);
    const matches = screen.getAllByText(/Not SEBI-registered investment advice/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(await screen.findByText(/Verified Products \(2 Comparable Options\)/i)).toBeTruthy();
    expect(await screen.findByText('Verified Fund 2')).toBeTruthy();
    expect((await screen.findAllByText('VERIFIED COMPARABLE OPTION')).length).toBe(2);
    expect(screen.getByText('Plan: UNAVAILABLE')).toBeTruthy();
    expect(screen.getByTestId('wti-comparison-universe')).toBeTruthy();
    expect(screen.queryByText('Top Pick')).toBeNull();
    expect(await screen.findByText('MARKET_CONTEXT_UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText(/PROVIDER_NOT_CONFIGURED/)).toBeTruthy();
  });

  it('labels the unique historical-return leader precisely without calling it a Top Pick', async () => {
    api.rankInvestmentCandidates.mockResolvedValueOnce({
      products: [
        {
          id: 'mf:amfi:101', name: 'Evidence Leader', provider: 'Verified AMC',
          source: { provider: 'AMFI', instrumentId: '101' }, nav: { value: 25 },
          valuationDate: '2026-09-07', freshness: { status: 'FRESH' },
          plan: 'Direct Plan', option: 'Growth Option',
          presentationStatus: 'VERIFIED_RANKED_PRODUCT', rank: 1, tiedRank: false,
          historicalReturn: { valuePct: 18.25 },
        },
        {
          id: 'mf:amfi:102', name: 'Evidence Runner Up', provider: 'Verified AMC',
          source: { provider: 'AMFI', instrumentId: '102' }, nav: { value: 20 },
          valuationDate: '2026-09-07', freshness: { status: 'FRESH' },
          plan: 'Direct Plan', option: 'Growth Option',
          presentationStatus: 'VERIFIED_RANKED_PRODUCT', rank: 2, tiedRank: false,
          historicalReturn: { valuePct: 12.5 },
        },
      ],
      ranking: { status: 'EVIDENCE_RANKED', hasUniqueLeader: true, warning: 'Historical return is not expected return.' },
      comparisonUniverse: {
        disclosure: 'Ranked within exact AMFI category.',
        verifiedCategoryProductCount: 2,
        freshNavProductCount: 2,
        sourceEstablishedDirectPlanProductCount: 2,
        historicalEvidenceProductCount: 2,
      },
    });
    render(<WhereToInvestTab inv={{ id: 'large_cap_mf', riskLevel: 3 }} userProfile={{ profileId: '64b000000000000000000001' }} />);
    expect(await screen.findByText(/Verified Products \(2 Ranked Options\)/i)).toBeTruthy();
    expect((await screen.findAllByText('VERIFIED RANKED PRODUCT')).length).toBe(2);
    expect(screen.getByText('18.25% historical')).toBeTruthy();
    expect(screen.getByText('Rank #1 by 1Y Historical NAV Return')).toBeTruthy();
    expect(screen.queryByText(/Top Pick/i)).toBeNull();
  });
});
