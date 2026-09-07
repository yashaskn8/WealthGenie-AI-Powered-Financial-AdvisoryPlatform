/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SebiDisclaimer from '../SebiDisclaimer';
import WhereToInvestTab from '../deepdive/WhereToInvestTab';

vi.mock('../../services/api', () => ({
  rankInvestmentCandidates: vi.fn(async () => ({ products: [{ id: 'provider-1', name: 'Server Provider' }] })),
}));

describe('SebiDisclaimer Component', () => {
  it('renders regulatory disclaimer text', () => {
    render(<SebiDisclaimer />);
    const matches = screen.getAllByText(/Not SEBI-registered investment advice/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByText(/Mutual fund investments are subject to market risk/i)).toBeTruthy();
  });

  it('renders SebiDisclaimer alongside backend-ranked execution recommendations in WhereToInvestTab', async () => {
    const mockInv = { id: 'mid_cap_stocks', name: 'Mid Cap Growth Stocks', riskLevel: 5 };
    render(<WhereToInvestTab inv={mockInv} userProfile={{ profileId: '64b000000000000000000001' }} />);
    const matches = screen.getAllByText(/Not SEBI-registered investment advice/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(await screen.findByText(/Server-verified provider options/i)).toBeTruthy();
  });
});
