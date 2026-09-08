/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SebiDisclaimer from '../SebiDisclaimer';
import WhereToInvestTab from '../deepdive/WhereToInvestTab';

vi.mock('../../services/api', () => ({
  rankInvestmentCandidates: vi.fn(async () => ({
    products: Array.from({ length: 5 }, (_, index) => ({
      id: `provider-${index + 1}`,
      name: `Server Provider ${index + 1}`,
      provider: 'Reference catalog',
      nominalReturn: null,
      riskLevel: null,
      listingPosition: index + 1,
    })),
    ranking: { status: 'NOT_RANKED', authority: 'REFERENCE_METADATA_ONLY' },
  })),
  getCurrentMacroRegime: vi.fn(async () => ({ regime: 'neutral', label: 'Neutral' })),
  simulateMacroRegimeAdjustment: vi.fn(async () => ({ allocation_adjustments: [] })),
}));

describe('SebiDisclaimer Component', () => {
  it('renders regulatory disclaimer text', () => {
    render(<SebiDisclaimer />);
    const matches = screen.getAllByText(/Not SEBI-registered investment advice/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(/Mutual fund investments are subject to market risk/i)).toBeTruthy();
  });

  it('renders the disclaimer without presenting reference catalog order as personalized ranking', async () => {
    const mockInv = { id: 'mid_cap_stocks', name: 'Mid Cap Growth Stocks', riskLevel: 5 };
    render(<WhereToInvestTab inv={mockInv} userProfile={{ profileId: '64b000000000000000000001' }} />);
    const matches = screen.getAllByText(/Not SEBI-registered investment advice/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(await screen.findByText(/Execution Pathway \(5 Reference Options\)/i)).toBeTruthy();
    expect(await screen.findByText('Server Provider 5')).toBeTruthy();
    expect((await screen.findAllByText('Return unavailable')).length).toBe(5);
    expect(screen.queryByText('Top Pick')).toBeNull();
  });
});
