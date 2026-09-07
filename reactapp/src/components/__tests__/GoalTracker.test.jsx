/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoalTracker from '../GoalTracker';
import api from '../../services/api';

vi.mock('../../services/api', () => ({
  default: {
    getGoals: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
  },
}));

const profile = {
  profileId: '64b000000000000000000001',
  monthly_savings: 35000,
  investment_horizon_years: 16,
};

const savedGoal = {
  _id: 'goal-1',
  goal_name: 'Dream Studio',
  target_amount: 500000,
  current_savings: 50000,
  target_date: '2030-01-01',
  priority: 'High',
  years_remaining: 4,
  inflation_adjusted_target: 600000,
  recommended_sip: 5000,
  gap_amount: 350000,
  status: 'at_risk',
  recommended_instrument: 'balanced_fund',
  monte_carlo_summary: { p50: 250000 },
  gemini_advice: 'Increase the goal contribution when cash flow allows.',
};

describe('GoalTracker custom-goal boundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    api.getGoals.mockResolvedValue({ goals: [] });
    api.updateGoal.mockResolvedValue({ success: true });
    api.deleteGoal.mockResolvedValue({ deleted: true });
  });

  it('preserves the full dashboard empty state and routes to the explicit Goal Planner', async () => {
    const onNavigate = vi.fn();
    render(<GoalTracker profile={profile} onNavigate={onNavigate} />);

    expect(await screen.findByText('No Custom Goals Yet')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'My Financial Goals' })).toBeTruthy();
    expect(screen.getByText('Welcome to your Goals Dashboard')).toBeTruthy();
    expect(screen.getByText("What You're Saving For")).toBeTruthy();
    expect(screen.getByText('Already Saved')).toBeTruthy();
    expect(screen.getByText('Expected Growth')).toBeTruthy();
    expect(screen.getByText('Overall Progress')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /create custom goal/i }));
    expect(onNavigate).toHaveBeenCalledWith('goal-planner');
    expect(api.getGoals).toHaveBeenCalledTimes(1);
  });

  it('keeps the original notification banner available for goal-loading failures', async () => {
    api.getGoals.mockRejectedValue(new Error('Goal service unavailable'));
    render(<GoalTracker profile={profile} onNavigate={vi.fn()} />);

    expect(await screen.findByText('Goal service unavailable')).toBeTruthy();
    expect(screen.getByTitle('Dismiss notification')).toBeTruthy();
  });

  it('renders backend-owned goal projections in the complete premium goal card', async () => {
    api.getGoals.mockResolvedValue({ goals: [savedGoal] });
    render(<GoalTracker profile={profile} />);

    expect(await screen.findByText('Dream Studio')).toBeTruthy();
    expect(screen.getByText('Slightly Behind (Needs Boost)')).toBeTruthy();
    expect(screen.getByText('Backend Monte Carlo horizon')).toBeTruthy();
    expect(screen.getByText('Increase the goal contribution when cash flow allows.')).toBeTruthy();
    expect(screen.getAllByText('₹2.5L')).toHaveLength(2);
    expect(screen.getByText('₹3.5L')).toBeTruthy();
  });

  it('updates only explicit target facts and then refreshes server calculations', async () => {
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal] })
      .mockResolvedValueOnce({ goals: [{ ...savedGoal, target_amount: 550000 }] });
    render(<GoalTracker profile={profile} />);

    await screen.findByText('Dream Studio');
    const [targetInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(targetInput, { target: { value: '550000' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes & update projections/i }));

    await waitFor(() => expect(api.updateGoal).toHaveBeenCalledWith('goal-1', {
      target_amount: 550000,
      current_savings: 50000,
    }));
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(2));
  });

  it('deletes only the selected custom goal after confirmation', async () => {
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal] })
      .mockResolvedValueOnce({ goals: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GoalTracker profile={profile} />);

    fireEvent.click(await screen.findByTitle('Delete Goal'));
    await waitFor(() => expect(api.deleteGoal).toHaveBeenCalledWith('goal-1'));
    await waitFor(() => expect(screen.queryByText('Dream Studio')).toBeNull());
  });
});
