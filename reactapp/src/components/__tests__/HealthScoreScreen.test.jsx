/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import HealthScoreScreen from '../../HealthScoreScreen';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({ getFinancialHealthScore: vi.fn() }));

const profile = {
  profileId: '64b000000000000000000001',
  name: 'Priya Sharma',
  age: 28,
  monthly_take_home: 100000,
  monthly_savings: 30000,
  liquid_savings: 600000,
  emergency_fund_months: 6,
  emi_burden_pct: 10,
  investment_goals: ['Emergency Fund', 'Wealth Growth'],
  investment_horizon_years: 15,
  risk_tolerance: 'Moderate',
};

const healthResponse = {
  score: 78,
  grade: 'Good',
  color: '#eab308',
  savings_rate_pct: 30,
  snapshot: { recorded_at: '2026-09-07T00:00:00.000Z', score: 78 },
  peer_comparison: null,
  sub_scores: [
    { label: 'Savings Capacity', value: 100, weight: 30, extra: '30.0% of declared take-home is available for recurring investment.', alert: false },
    { label: 'Emergency Safety Net', value: 100, weight: 25, extra: '6 months of emergency-fund coverage were explicitly declared.', alert: false, hasDisclaimer: true },
    { label: 'Investment Variety', value: 67, weight: 20, extra: '2 distinct asset classes in the authoritative allocation.', alert: false },
    { label: 'Tax Efficiency', value: null, weight: 0, extra: 'Not scored: tax context is outside the Financial Profile.', alert: false },
    { label: 'Goal Coverage', value: 50, weight: 15, extra: '1 of 2 declared goals are represented.', alert: false },
    { label: 'Risk-Timeline Match', value: 80, weight: 10, extra: 'Final suitability: Moderate.', alert: false },
  ],
};

describe('HealthScoreScreen — Loading and Render States', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    api.getFinancialHealthScore.mockResolvedValue(healthResponse);
  });

  it('renders loading state when profile is not provided', () => {
    render(<HealthScoreScreen profile={null} recommendations={[]} />);
    expect(screen.getByRole('status', { name: /financial profile required/i })).toBeTruthy();
    expect(screen.getByText(/save a financial profile/i)).toBeTruthy();
  });

  it('discloses unknown optional facts without displaying them as zero', async () => {
    api.getFinancialHealthScore.mockResolvedValue({
      ...healthResponse,
      sub_scores: healthResponse.sub_scores.map(metric => metric.label === 'Emergency Safety Net'
        ? { ...metric, value: null, weight: 0, alert: true, extra: 'Emergency-fund coverage was left unknown; no value was assumed and this metric is excluded from the total.' }
        : metric),
    });
    render(<HealthScoreScreen profile={{ ...profile, emergency_fund_months: null }} />);
    expect((await screen.findAllByText(/coverage was left unknown; no value was assumed/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('renders the complete dashboard from the backend-owned score', async () => {
    render(<HealthScoreScreen profile={profile} />);
    expect(await screen.findByRole('heading', { name: 'Your Financial Health Score' })).toBeTruthy();
    expect(screen.getByText('Detailed Score Breakdown')).toBeTruthy();
    expect(screen.getByText('Your Score Over Time')).toBeTruthy();
    expect(screen.getByText('How You Compare to Others')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.getByText('Tax Efficiency')).toBeTruthy();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    await waitFor(() => expect(api.getFinancialHealthScore).toHaveBeenCalledWith(profile.profileId, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });
});
