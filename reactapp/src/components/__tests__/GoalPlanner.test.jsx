/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoalPlanner from '../GoalPlanner';
import api from '../../services/api';

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
  const components = new Map();
  const motion = new Proxy({}, {
    get(_target, tag) {
      if (!components.has(tag)) {
        components.set(tag, ReactModule.forwardRef((props, ref) => {
          const motionOnlyProps = new Set([
            'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap',
            'layout', 'layoutId',
          ]);
          const domProps = Object.fromEntries(Object.entries(props)
            .filter(([key]) => key !== 'children' && !motionOnlyProps.has(key)));
          return ReactModule.createElement(tag, { ...domProps, ref }, props.children);
        }));
      }
      return components.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }) => children };
});

vi.mock('../../services/api', () => ({
  default: {
    getGoals: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    simulateGoal: vi.fn(),
  },
}));

const profile = { profileId: 'profile-1', monthly_savings: 30000 };
const freshGoal = {
  _id: 'goal-1',
  goal_name: 'Home Deposit',
  target_amount: 900000,
  current_savings: 100000,
  target_date: '2032-01-01',
  priority: 'High',
  years_remaining: 6,
  recommended_sip: 5000,
  simulated_monthly_contribution: 5000,
  probability_of_success: 0.82,
  gap_amount: 400000,
  inflation_adjusted_target: 1200000,
  status: 'at_risk',
  recommended_instrument: 'balanced_fund',
  monte_carlo_summary: { simulations_run: 1000 },
  calculation_freshness: { fresh: true, reasonCodes: [] },
  advisory_freshness: { fresh: true, reasonCodes: [] },
  gemini_advice: 'Fresh advice tied to this profile and portfolio.',
};

describe('GoalPlanner financial freshness boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getGoals.mockResolvedValue({ goals: [] });
  });

  afterEach(() => cleanup());

  it('removes prior-profile advice and calculated values when the refreshed goal is stale', async () => {
    api.getGoals
      .mockResolvedValueOnce({ goals: [freshGoal] })
      .mockResolvedValueOnce({
        goals: [{
          ...freshGoal,
          probability_of_success: 0.99,
          recommended_sip: 12345,
          calculation_freshness: { fresh: false, reasonCodes: ['STALE_PROFILE'] },
          advisory_freshness: { fresh: false, reasonCodes: ['STALE_PROFILE'] },
        }],
      });

    const { rerender } = render(<GoalPlanner profile={profile} />);
    expect(await screen.findByText(freshGoal.gemini_advice)).toBeTruthy();
    expect(screen.getAllByText('82%').length).toBeGreaterThan(0);

    rerender(<GoalPlanner profile={{ ...profile, version: 2 }} />);

    expect(await screen.findByText('RECALCULATE')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(freshGoal.gemini_advice)).toBeNull());
    expect(screen.queryByText('99%')).toBeNull();
    expect(screen.queryByText('₹12,345/mo')).toBeNull();
    expect(screen.getByText(/Calculation unavailable/)).toBeTruthy();
    expect(api.getGoals).toHaveBeenCalledTimes(2);
  });

  it('does not turn missing fresh calculation metrics into displayed zeroes', async () => {
    api.getGoals.mockResolvedValue({
      goals: [{
        ...freshGoal,
        years_remaining: null,
        recommended_sip: null,
        simulated_monthly_contribution: null,
        probability_of_success: null,
        gap_amount: null,
        inflation_adjusted_target: null,
        inflation_assumption: null,
        monte_carlo_summary: { simulations_run: null, p50: null },
      }],
    });

    render(<GoalPlanner profile={profile} />);

    expect(await screen.findByText('Horizon unavailable')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('₹0/mo')).toBeNull();
    expect(screen.queryByText(/0 Yrs Horizon/)).toBeNull();
  });
});
