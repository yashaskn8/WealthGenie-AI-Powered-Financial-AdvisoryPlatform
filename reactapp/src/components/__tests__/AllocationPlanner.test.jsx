import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AllocationPlanner from '../AllocationPlanner';
import * as api from '../../services/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const profile = {
  profileId: '64b000000000000000000001',
  monthly_savings: 30000,
  investment_horizon_years: 10,
  investment_goals: ['Wealth Growth'],
  risk_tolerance: 'Moderate',
};

const recommendations = [
  {
    id: 'ppf',
    name: 'Public Provident Fund',
    type: 'PPF',
    category: 'Government',
    allocationWeight: 0.6,
    monthly_allocation: 18000,
    nominalReturn: 7.1,
    riskLabel: 'Very Low',
  },
  {
    id: 'index-fund',
    name: 'Nifty 50 Index Fund',
    type: 'Index_MF',
    category: 'Equity',
    allocationWeight: 0.4,
    monthly_allocation: 12000,
    nominalReturn: 12,
    riskLabel: 'Moderate',
  },
];

const recommendationMeta = {
  portfolio_return_assumption: 9.2,
  advisory_text: 'This plan balances stability and long-term growth. [E_PROFILE_RISK]',
  current_allocation_source: 'Backend recommendation',
  return_basis: 'Versioned model assumption',
  return_assumption_version: 'test-policy-1.0.0',
  policy_lineage: 'market-context-policy-1.0.0',
};

describe('AllocationPlanner', () => {
  it('preserves recommendation order and authoritative values in the redesigned sections', () => {
    render(<AllocationPlanner profile={profile} recommendations={recommendations} recommendationMeta={recommendationMeta} />);

    expect(screen.getByRole('heading', { name: /Where to invest your money/i })).toBeInTheDocument();
    expect(screen.getAllByText('₹30,000').length).toBeGreaterThan(0);
    expect(screen.getByText('10 years')).toBeInTheDocument();
    expect(screen.getByText('Wealth Growth')).toBeInTheDocument();

    const cardHeadings = Array.from(document.querySelectorAll('.ap-plan-card h3'));
    expect(cardHeadings.map(heading => heading.textContent)).toEqual([
      'Public Provident Fund',
      'Nifty 50 Index Fund',
    ]);
    expect(screen.getByText('₹18,000')).toBeInTheDocument();
    expect(screen.getByText('₹12,000')).toBeInTheDocument();
    expect(screen.getByText('7.1%/yr')).toBeInTheDocument();
    expect(screen.getByText('12%/yr')).toBeInTheDocument();
    expect(screen.getByText('Very Low')).toBeInTheDocument();
    expect(screen.getAllByText('Moderate').length).toBeGreaterThan(0);
    expect(screen.getByText('This plan balances stability and long-term growth.')).toBeInTheDocument();
    expect(screen.queryByText('[E_PROFILE_RISK]')).not.toBeInTheDocument();
  });

  it('exposes keyboard-accessible term help and the methodology dialog', async () => {
    render(<AllocationPlanner profile={profile} recommendations={recommendations} recommendationMeta={recommendationMeta} />);

    fireEvent.focus(screen.getAllByRole('button', { name: 'More information about Risk' })[0]);
    await waitFor(() => expect(screen.getByText(/risk classification supplied/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /View methodology/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How this plan is built' })).toBeInTheDocument();
    expect(screen.getByText('market-context-policy-1.0.0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renders truthful loading, error, and empty states without fabricated values', () => {
    const { rerender } = render(<AllocationPlanner profile={profile} recommendations={recommendations} recommendationMeta={{ status: 'LOADING' }} />);
    expect(screen.getByRole('heading', { name: 'Preparing your plan' })).toBeInTheDocument();
    expect(screen.queryByText('₹30,000')).not.toBeInTheDocument();

    rerender(<AllocationPlanner profile={profile} recommendations={recommendations} recommendationMeta={{ status: 'ERROR' }} />);
    expect(screen.getByRole('heading', { name: "We couldn't load your plan" })).toBeInTheDocument();

    rerender(<AllocationPlanner profile={profile} recommendations={[]} />);
    expect(screen.getByRole('heading', { name: 'No allocation available' })).toBeInTheDocument();
  });

  it('runs a read-only review and exposes only returned evidence in the dialog', async () => {
    vi.spyOn(api, 'runPlanReview').mockResolvedValue({
      version: 'plan-review-1.0.0',
      runId: '4f4f4f4f-1111-4111-8111-111111111111',
      status: 'COMPLETED',
      recommendedAction: 'NONE',
      summary: 'The available evidence is aligned with your saved plan. No plan changes were made.',
      findings: [{ code: 'PLAN_CURRENT', severity: 'INFO', title: 'Plan evidence is current', detail: 'The saved evidence is aligned.', evidenceIds: ['E_RECOMMENDATION_FRESHNESS'] }],
      freshness: { fresh: true, reasonCodes: [] },
      goals: { status: 'NONE', items: [] },
      evidence: {
        status: 'AVAILABLE',
        unavailableFacts: [],
        entries: [{ id: 'E_RECOMMENDATION_FRESHNESS', dataClass: 'DERIVED_VALUE', displayValue: 'Current recommendation matches the profile.', authority: 'WealthGenie backend' }],
      },
      provider: { name: 'DETERMINISTIC_FALLBACK', model: null, fallback: true },
    });

    render(<AllocationPlanner profile={profile} recommendations={recommendations} recommendationMeta={recommendationMeta} />);
    fireEvent.click(screen.getByRole('button', { name: /Run plan review/i }));
    await waitFor(() => expect(screen.getByText('Review complete')).toBeInTheDocument());
    expect(api.runPlanReview).toHaveBeenCalledWith(profile.profileId);
    fireEvent.click(screen.getByRole('button', { name: /View evidence/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('E_RECOMMENDATION_FRESHNESS')).toBeInTheDocument();
    expect(screen.getByText('Current recommendation matches the profile.')).toBeInTheDocument();
  });

  it('keeps recompute as an explicit authoritative parent action', async () => {
    vi.spyOn(api, 'runPlanReview').mockResolvedValue({
      version: 'plan-review-1.0.0',
      runId: '4f4f4f4f-1111-4111-8111-111111111111',
      status: 'COMPLETED',
      recommendedAction: 'RECOMPUTE_PLAN',
      summary: 'The saved recommendation needs a fresh authoritative recommendation.',
      findings: [{ code: 'PROFILE_CHANGED', severity: 'ATTENTION', title: 'Profile changed', detail: 'Recompute the saved plan.', evidenceIds: [] }],
      freshness: { fresh: false, reasonCodes: ['PROFILE_CHANGED'] },
      goals: { status: 'NONE', items: [] },
      evidence: { status: 'UNAVAILABLE', unavailableFacts: ['PROFILE_CHANGED'], entries: [] },
      provider: { name: 'DETERMINISTIC_FALLBACK', model: null, fallback: true },
    });
    const recompute = vi.fn();
    render(<AllocationPlanner profile={profile} recommendations={recommendations} recommendationMeta={recommendationMeta} onRecomputePlan={recompute} />);
    fireEvent.click(screen.getByRole('button', { name: /Run plan review/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Recompute plan/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Recompute plan/i }));
    expect(recompute).toHaveBeenCalledTimes(1);
  });
});
