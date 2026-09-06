/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HealthScoreScreen from '../../HealthScoreScreen';

describe('HealthScoreScreen — Loading and Render States', () => {
  it('renders loading state when profile is not provided', () => {
    render(<HealthScoreScreen profile={null} recommendations={[]} />);
    expect(screen.getByRole('status', { name: /financial profile required/i })).toBeTruthy();
    expect(screen.getByText(/save a complete financial profile/i)).toBeTruthy();
  });

  it('renders full health score dashboard when profile is loaded', () => {
    const mockProfile = {
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
    const mockRecs = [
      { category: 'Equity', monthly_allocation: 15000, suitable_for_goals: ['Wealth Growth'] },
      { category: 'Debt', monthly_allocation: 15000, suitable_for_goals: ['Emergency Fund'] },
    ];

    render(<HealthScoreScreen profile={mockProfile} recommendations={mockRecs} />);
    expect(screen.getByText('Financial wellness')).toBeTruthy();
    expect(screen.getByText('Savings rate')).toBeTruthy();
    expect(screen.getByText('Emergency-fund coverage')).toBeTruthy();
  });
});
