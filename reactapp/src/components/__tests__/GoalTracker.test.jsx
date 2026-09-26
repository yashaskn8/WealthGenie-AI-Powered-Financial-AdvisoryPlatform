/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GoalTracker from '../GoalTracker';
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
  },
}));

const profile = {
  profileId: '64b000000000000000000001',
  monthly_savings: 35000,
  investment_horizon_years: 16,
};

const savedGoal = {
  _id: 'goal-1',
  version: 1,
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
  calculation_freshness: { fresh: true, reasonCodes: [] },
  advisory_freshness: { fresh: true, reasonCodes: [] },
  gemini_advice: 'Increase the goal contribution when cash flow allows.',
};

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const secondGoal = {
  ...savedGoal,
  _id: 'goal-2',
  goal_name: 'Emergency Reserve',
};

describe('GoalTracker custom-goal boundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // clearAllMocks preserves mockResolvedValueOnce queues. A failed test can
    // otherwise leak a queued HTTP response into a later test in the file.
    vi.resetAllMocks();
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
    expect(screen.getByText('Projected Median Value')).toBeTruthy();
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

  it('does not render derived values or advice when freshness proof is missing', async () => {
    api.getGoals.mockResolvedValue({ goals: [{ ...savedGoal, calculation_freshness: undefined, advisory_freshness: undefined }] });
    render(<GoalTracker profile={profile} />);

    expect(await screen.findByText('Dream Studio')).toBeTruthy();
    expect(screen.getAllByText('Awaiting backend calculation').length).toBeGreaterThan(0);
    expect(screen.queryByText('Increase the goal contribution when cash flow allows.')).toBeNull();
  });

  it.each([
    ['false', { fresh: false }],
    ['missing', {}],
    ['undefined', undefined],
    ['null', null],
    ['numeric false-like', { fresh: 0 }],
    ['string true-like', { fresh: 'true' }],
    ['numeric true-like', { fresh: 1 }],
  ])('blocks derived goal data when calculation freshness is %s', async (_label, freshness) => {
    const goal = { ...savedGoal, calculation_freshness: freshness };
    if (_label === 'missing') delete goal.calculation_freshness;
    api.getGoals.mockResolvedValue({ goals: [goal] });
    render(<GoalTracker profile={profile} />);

    expect(await screen.findByText('Dream Studio')).toBeTruthy();
    expect(screen.getByText('Recalculation Required')).toBeTruthy();
    expect(screen.queryByText('Slightly Behind (Needs Boost)')).toBeNull();
    expect(screen.queryByText('₹2.5L')).toBeNull();
    expect(screen.queryByText('₹3.5L')).toBeNull();
    expect(screen.queryByText('₹5,000')).toBeNull();
    expect(screen.queryByText('₹0')).toBeNull();
  });

  it.each([
    ['false', { fresh: false }],
    ['missing', undefined],
    ['malformed', { fresh: 'true' }],
  ])('hides advice unless advisory freshness is literal true (%s)', async (_label, freshness) => {
    api.getGoals.mockResolvedValue({ goals: [{
      ...savedGoal,
      advisory_freshness: freshness,
    }] });
    render(<GoalTracker profile={profile} />);

    expect(await screen.findByText('Dream Studio')).toBeTruthy();
    expect(screen.queryByText('Increase the goal contribution when cash flow allows.')).toBeNull();
    expect(screen.getAllByText('₹2.5L')).toHaveLength(2);
  });

  it('replaces previously fresh goal data after a stale refresh instead of retaining old values or advice', async () => {
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal] })
      .mockResolvedValueOnce({ goals: [{
        ...savedGoal,
        calculation_freshness: { fresh: false, reasonCodes: ['STALE_ALLOCATION'] },
        advisory_freshness: { fresh: false, reasonCodes: ['STALE_ALLOCATION'] },
      }] });
    render(<GoalTracker profile={profile} />);

    await screen.findByText('Dream Studio');
    const targetInput = screen.getAllByRole('spinbutton')[0];
    await act(async () => {
      fireEvent.change(targetInput, { target: { value: '550000' } });
    });
    expect(targetInput).toHaveValue(550000);
    fireEvent.click(await screen.findByRole('button', { name: /save changes & update projections/i }));

    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Recalculation Required')).toBeTruthy();
    expect(screen.queryByText('Slightly Behind (Needs Boost)')).toBeNull();
    expect(screen.queryByText('Increase the goal contribution when cash flow allows.')).toBeNull();
    expect(screen.queryByText('₹2.5L')).toBeNull();
    expect(screen.queryByText('₹3.5L')).toBeNull();
    expect(screen.queryByText('₹0')).toBeNull();
  });

  it('updates only explicit target facts and then refreshes server calculations', async () => {
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal] })
      .mockResolvedValueOnce({ goals: [{ ...savedGoal, target_amount: 550000 }] });
    render(<GoalTracker profile={profile} />);

    await screen.findByText('Dream Studio');
    const [targetInput] = screen.getAllByRole('spinbutton');
    await act(async () => {
      fireEvent.change(targetInput, { target: { value: '550000' } });
    });
    expect(targetInput).toHaveValue(550000);
    fireEvent.click(await screen.findByRole('button', { name: /save changes & update projections/i }));

    await waitFor(() => expect(api.updateGoal).toHaveBeenCalledWith('goal-1', {
      expectedVersion: 1,
      target_amount: 550000,
      current_savings: 50000,
    }));
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(2));
  });

  it('deletes only the selected custom goal after confirmation', async () => {
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal, secondGoal] })
      .mockResolvedValueOnce({ goals: [secondGoal] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GoalTracker profile={profile} />);

    await screen.findByText('Dream Studio');
    expect(screen.getByText('Emergency Reserve')).toBeTruthy();
    fireEvent.click(screen.getAllByTitle('Delete Goal')[0]);
    await waitFor(() => expect(api.deleteGoal).toHaveBeenCalledWith('goal-1', 1));
    await waitFor(() => expect(screen.queryByText('Dream Studio')).toBeNull());
    expect(await screen.findByText('Emergency Reserve')).toBeTruthy();
  });

  it('does not let an older delete refresh resurrect a goal after a newer delete refresh', async () => {
    const earlierRefresh = createDeferred();
    const laterRefresh = createDeferred();
    const firstDelete = createDeferred();
    const secondDelete = createDeferred();
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal, secondGoal] })
      .mockImplementationOnce(() => earlierRefresh.promise)
      .mockImplementationOnce(() => laterRefresh.promise);
    api.deleteGoal
      .mockImplementationOnce(() => firstDelete.promise)
      .mockImplementationOnce(() => secondDelete.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GoalTracker profile={profile} />);

    await screen.findByText('Dream Studio');
    const deleteButtons = screen.getAllByTitle('Delete Goal');
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(deleteButtons[1]);
    await waitFor(() => expect(api.deleteGoal).toHaveBeenCalledTimes(2));

    await act(async () => { firstDelete.resolve({ deleted: true }); });
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(2));
    await act(async () => { secondDelete.resolve({ deleted: true }); });
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(3));

    await act(async () => { laterRefresh.resolve({ goals: [] }); });
    expect(await screen.findByText('No Custom Goals Yet')).toBeTruthy();

    await act(async () => {
      earlierRefresh.resolve({ goals: [secondGoal] });
      await earlierRefresh.promise;
    });
    expect(screen.queryByText('Emergency Reserve')).toBeNull();
    expect(screen.getByText('No Custom Goals Yet')).toBeTruthy();
  });

  it('keeps the newest update refresh when update responses complete out of order', async () => {
    const earlierRefresh = createDeferred();
    const laterRefresh = createDeferred();
    const firstUpdate = createDeferred();
    const secondUpdate = createDeferred();
    api.getGoals
      .mockResolvedValueOnce({ goals: [savedGoal, secondGoal] })
      .mockImplementationOnce(() => earlierRefresh.promise)
      .mockImplementationOnce(() => laterRefresh.promise);
    api.updateGoal
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockImplementationOnce(() => secondUpdate.promise);
    render(<GoalTracker profile={profile} />);

    await screen.findByText('Dream Studio');
    const targetInputs = screen.getAllByRole('spinbutton').filter((_, index) => index % 2 === 0);
    await act(async () => {
      fireEvent.change(targetInputs[0], { target: { value: '550000' } });
      fireEvent.change(targetInputs[1], { target: { value: '650000' } });
    });
    const saveButtons = screen.getAllByRole('button', { name: /save changes & update projections/i });
    fireEvent.click(saveButtons[0]);
    fireEvent.click(saveButtons[1]);
    await waitFor(() => expect(api.updateGoal).toHaveBeenCalledTimes(2));

    await act(async () => { firstUpdate.resolve({ success: true }); });
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(2));
    await act(async () => { secondUpdate.resolve({ success: true }); });
    await waitFor(() => expect(api.getGoals).toHaveBeenCalledTimes(3));

    const newestGoals = [
      { ...savedGoal, target_amount: 650000 },
      { ...secondGoal, target_amount: 750000 },
    ];
    await act(async () => { laterRefresh.resolve({ goals: newestGoals }); });
    await screen.findAllByText('₹6.5L');

    await act(async () => {
      earlierRefresh.resolve({ goals: [savedGoal, secondGoal] });
      await earlierRefresh.promise;
    });
    const finalTargetInputs = screen.getAllByRole('spinbutton').filter((_, index) => index % 2 === 0);
    expect(finalTargetInputs.map(input => Number(input.value))).toEqual([650000, 750000]);
  });
});
