/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoalTracker from '../GoalTracker';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getGoals: vi.fn(),
  createGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

const profile = { profileId: '64b000000000000000000001' };

describe('GoalTracker custom-goal boundary', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    api.getGoals.mockResolvedValue({ goals: [] });
  });

  it('never bootstraps profile goals and only opens an explicit custom-goal form', async () => {
    render(<GoalTracker profile={profile} />);
    expect(await screen.findByText('No custom goals yet.')).toBeTruthy();
    expect(api.createGoal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /add custom goal/i }));
    expect(screen.getByTestId('goal-form')).toBeTruthy();
  });

  it('fails closed when no authoritative profile ID exists', async () => {
    render(<GoalTracker profile={null} />);
    expect(await screen.findByText('No custom goals yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /add custom goal/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Save a complete Financial Profile');
    expect(api.createGoal).not.toHaveBeenCalled();
  });

  it('deletes only the selected custom goal', async () => {
    api.getGoals.mockResolvedValue({ goals: [{
      _id: 'goal-1', goal_name: 'Dream Studio', target_amount: 500000,
      target_date: '2030-01-01', priority: 'High', inflation_adjusted_target: 600000,
      recommended_sip: 5000, simulation_classification: 'PROFILE_CONSTRAINED_GOAL_FEASIBILITY',
      return_basis: 'pre-tax nominal', inflation_assumption: 0.06,
    }] });
    api.deleteGoal.mockResolvedValue({ success: true });
    render(<GoalTracker profile={profile} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Dream Studio' }));
    await waitFor(() => expect(api.deleteGoal).toHaveBeenCalledWith('goal-1'));
    expect(screen.queryByText('Dream Studio')).toBeNull();
  });
});
