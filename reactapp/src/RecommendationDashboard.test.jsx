/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RecommendationDashboard from './RecommendationDashboard.jsx';

const profile = {
  profileId: '64b000000000000000000001', monthly_take_home: 100000,
  monthly_savings: 20000, risk_tolerance: 'Moderate', investment_horizon_years: 10,
};

describe('RecommendationDashboard authority boundary', () => {
  it('shows no portfolio when the backend supplies no recommendations', () => {
    render(<RecommendationDashboard userProfile={profile} recommendations={[]} />);
    expect(screen.getByText(/No personalized recommendation is being shown/i)).toBeVisible();
    expect(screen.queryByText(/offline estimate/i)).toBeNull();
  });

  it('renders only supplied server instruments and explains the property-proceeds invariant', () => {
    render(<RecommendationDashboard userProfile={profile} recommendations={[{
      id: 'index-mf', name: 'Index Mutual Fund', type: 'Equity_MF', riskLabel: 'Moderate',
      nominalReturn: 10, monthly_allocation: 20000, allocationWeight: 1, lockIn: 0,
      suitabilityReasons: ['Within risk ceiling'],
    }]} />);
    expect(screen.getByText('Index Mutual Fund')).toBeVisible();
    expect(screen.getByText(/Sold-property proceeds are not treated as investable capital/i)).toBeVisible();
    expect(screen.getByText('₹20,000 of ₹20,000 allocated')).toBeVisible();
  });
});
