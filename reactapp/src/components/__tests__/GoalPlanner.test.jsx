/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    simulateGoal: vi.fn(),
  },
}));

const id = number => `64b0000000000000000000${String(number).padStart(2, '0')}`;
const hash = character => character.repeat(64);
const profile = { profileId: id(1), version: 1, monthly_savings: 30000 };
const financialState = (profileVersion = 1, revision = 3) => ({
  response_state: 'CURRENT',
  profileId: id(1),
  profile_version: profileVersion,
  recommendationId: id(2),
  recommendation_id: id(2),
  allocation_revision: revision,
  allocation_revision_id: id(revision + 10),
  previous_allocation_revision: revision - 1,
  previous_allocation_revision_id: id(revision + 9),
  profile_input_hash: hash('a'),
  portfolio_fingerprint: hash(revision === 3 ? 'b' : 'e'),
  recommendation_fingerprint: hash(revision === 3 ? 'c' : 'f'),
  recommendation_policy_version: 'policy-1',
  regulatory_rule_version: 'tax-policy-1',
  return_assumption_version: 'assumption-1',
  return_assumption_hash: hash('d'),
  return_assumption_source: 'MODEL_POLICY',
  current_allocation_source: 'USER_REBALANCED',
  calculation_freshness: {
    fresh: true,
    reasonCodes: [],
    modelVersion: 'model-v1',
    expectedProfileHash: hash('a'),
    observedProfileHash: hash('a'),
    expectedProfileVersion: profileVersion,
    observedProfileVersion: profileVersion,
    allocationRevision: revision,
    currentAllocationSource: 'USER_REBALANCED',
    observedRegulatoryVersion: 'tax-policy-1',
    currentRegulatoryVersion: 'tax-policy-1',
    policyVersion: 'policy-1',
    observedRecommendationPolicyVersion: 'policy-1',
    assumptionVersion: 'assumption-1',
    assumptionHash: hash('d'),
    assumptionSource: 'MODEL_POLICY',
  },
  state_provenance: {
    status: 'PERSISTED_REVISION',
    stateId: id(5),
    recommendationId: id(2),
    allocationSource: 'USER_REBALANCED',
    allocationRevision: revision,
    allocationRevisionId: id(revision + 10),
    profileVersion,
    profileInputHash: hash('a'),
    portfolioFingerprint: hash(revision === 3 ? 'b' : 'e'),
    recommendationFingerprint: hash(revision === 3 ? 'c' : 'f'),
    recommendationPolicyVersion: 'policy-1',
    regulatoryRuleVersion: 'tax-policy-1',
    returnAssumptionVersion: 'assumption-1',
    returnAssumptionHash: hash('d'),
    returnAssumptionSource: 'MODEL_POLICY',
    modelVersion: 'model-v1',
    previousAllocationRevision: revision - 1,
    previousAllocationRevisionId: id(revision + 9),
  },
});
const currentFinancialState = financialState();
const nextProfileFinancialState = financialState(2);
const nextAllocationFinancialState = financialState(1, 4);
const freshGoal = {
  _id: 'goal-1',
  profileId: id(1),
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
  source_provenance: {
    profileVersion: 1,
    profileInputHash: hash('a'),
    recommendationId: id(2),
    allocationRevision: 3,
    allocationRevisionId: id(13),
    portfolioFingerprint: hash('b'),
    recommendationFingerprint: hash('c'),
    recommendationPolicyVersion: 'policy-1',
    regulatoryRuleVersion: 'tax-policy-1',
    returnAssumptionVersion: 'assumption-1',
    returnAssumptionHash: hash('d'),
    modelVersion: 'model-v1',
  },
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
          // Even a server-provided `fresh` flag cannot override an older
          // profile binding in the source provenance.
          calculation_freshness: { fresh: true, reasonCodes: [] },
          advisory_freshness: { fresh: true, reasonCodes: [] },
        }],
      });

    const { rerender } = render(<GoalPlanner profile={profile} financialState={currentFinancialState} />);
    expect(await screen.findByText(freshGoal.gemini_advice)).toBeTruthy();
    expect(screen.getAllByText('82%').length).toBeGreaterThan(0);

    rerender(<GoalPlanner profile={{ ...profile, version: 2 }} financialState={nextProfileFinancialState} />);

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

    render(<GoalPlanner profile={profile} financialState={currentFinancialState} />);

    expect(await screen.findByText('Horizon unavailable')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('₹0/mo')).toBeNull();
    expect(screen.queryByText(/0 Yrs Horizon/)).toBeNull();
  });

  it('treats a goal calculation as stale when its allocation revision is superseded', async () => {
    api.getGoals.mockResolvedValue({ goals: [freshGoal] });
    const { rerender } = render(<GoalPlanner profile={profile} financialState={currentFinancialState} />);
    expect(await screen.findByText(freshGoal.gemini_advice)).toBeTruthy();

    rerender(<GoalPlanner profile={profile} financialState={nextAllocationFinancialState} />);

    expect(await screen.findByText('RECALCULATE')).toBeTruthy();
    expect(screen.queryByText(freshGoal.gemini_advice)).toBeNull();
    expect(screen.queryByText('82%')).toBeNull();
    expect(screen.queryByText('₹5,000/mo')).toBeNull();
  });

  it('ignores a goal create response that completes after the active profile changes', async () => {
    let resolveCreate;
    api.createGoal.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    api.getGoals.mockResolvedValue({ goals: [] });

    const { rerender } = render(<GoalPlanner profile={profile} financialState={currentFinancialState} />);
    fireEvent.click(screen.getByRole('button', { name: /Create Target Goal/i }));
    fireEvent.click(screen.getByRole('button', { name: /Emergency Fund/i }));
    fireEvent.change(screen.getByTestId('goal-target-amount'), { target: { value: '900000' } });
    fireEvent.change(screen.getByTestId('goal-target-date'), { target: { value: '2032-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    fireEvent.change(screen.getByTestId('goal-current-savings'), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    fireEvent.click(screen.getByTestId('goal-submit'));

    await waitFor(() => expect(api.createGoal).toHaveBeenCalledTimes(1));
    rerender(<GoalPlanner profile={{ ...profile, version: 2 }} financialState={nextProfileFinancialState} />);
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveCreate({ goal: { ...freshGoal, _id: 'late-goal-1' } });
    });

    expect(screen.queryByText('Home Deposit')).toBeNull();
    expect(screen.queryByText('82%')).toBeNull();
    expect(screen.queryByText('₹5,000/mo')).toBeNull();
  });
});
