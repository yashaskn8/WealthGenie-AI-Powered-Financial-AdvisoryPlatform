/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { advisoryMatchesCurrentFinancialState } from '../App.jsx';

const appMocks = vi.hoisted(() => ({
  initialRecommendation: null,
  profile: null,
  fetchAdvisory: vi.fn(),
  getRecommendations: vi.fn(),
  updateRecommendationWeights: vi.fn(),
}));

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchAdvisory: appMocks.fetchAdvisory,
    getRecommendations: appMocks.getRecommendations,
    updateRecommendationWeights: appMocks.updateRecommendationWeights,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isInitializing: false, logout: vi.fn() }),
}));

vi.mock('../components/ProfilePage', async () => {
  const { cloneElement } = await import('react');
  return {
    default: ({ children }) => cloneElement(children, {
      userProfile: appMocks.profile,
      onProfileUpdate: vi.fn(),
      initialRecommendation: appMocks.initialRecommendation,
    }),
  };
});

vi.mock('../components/ProgressHub', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ recommendationMeta, onSaveRebalance, onNavigate }) => ReactModule.createElement(
      'section',
      null,
      ReactModule.createElement('output', { 'data-testid': 'allocation-revision' }, String(recommendationMeta?.allocation_revision ?? 'missing')),
      ReactModule.createElement('output', { 'data-testid': 'portfolio-fingerprint' }, recommendationMeta?.portfolio_fingerprint ?? 'missing'),
      ReactModule.createElement('output', { 'data-testid': 'advisory-status' }, recommendationMeta?.advisory_explanation?.status ?? 'missing'),
      ReactModule.createElement('output', { 'data-testid': 'advisory-text' }, recommendationMeta?.advisory_text ?? ''),
      ReactModule.createElement('button', {
        type: 'button',
        onClick: () => void onSaveRebalance([{ id: 'fixture-instrument', allocationWeight: 1 }]),
      }, 'Apply revision 5'),
      ReactModule.createElement('button', { type: 'button', onClick: () => onNavigate('home') }, 'View dashboard'),
    ),
  };
});

vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/GenieChat', () => ({ default: () => null }));
vi.mock('../components/ErrorBoundary', () => ({ default: ({ children }) => children }));
vi.mock('../RecommendationDashboard', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ recommendationMeta, onNavigate }) => ReactModule.createElement(
      'section',
      null,
      ReactModule.createElement('output', { 'data-testid': 'allocation-revision' }, String(recommendationMeta?.allocation_revision ?? 'missing')),
      ReactModule.createElement('output', { 'data-testid': 'portfolio-fingerprint' }, recommendationMeta?.portfolio_fingerprint ?? 'missing'),
      ReactModule.createElement('output', { 'data-testid': 'advisory-status' }, recommendationMeta?.advisory_explanation?.status ?? 'missing'),
      ReactModule.createElement('output', { 'data-testid': 'advisory-text' }, recommendationMeta?.advisory_text ?? ''),
      ReactModule.createElement('button', { type: 'button', onClick: () => onNavigate('progress') }, 'Open progress'),
      ReactModule.createElement('button', { type: 'button', onClick: () => onNavigate('plan') }, 'Open plan'),
    ),
  };
});
vi.mock('../components/AllocationPlanner', async () => {
  const ReactModule = await import('react');
  const { useNavigate } = await import('react-router-dom');
  function MockAllocationPlanner({ onRecomputePlan }) {
    const navigate = useNavigate();
    return ReactModule.createElement(
      'section',
      null,
      ReactModule.createElement('button', { type: 'button', onClick: () => void onRecomputePlan() }, 'Refresh recommendation'),
      ReactModule.createElement('button', { type: 'button', onClick: () => navigate('/profile?page=progress') }, 'Open progress'),
    );
  }
  return {
    default: MockAllocationPlanner,
  };
});
vi.mock('../components/DeepDiveModal', () => ({ default: () => null }));

const recommendationId = '64b000000000000000000001';
const revision4 = {
  recommendationId,
  allocation_revision: 4,
  allocation_revision_id: 'allocation-revision-4',
  portfolio_fingerprint: 'fingerprint-revision-4',
};

function advisoryBinding(overrides = {}) {
  return {
    ...revision4,
    advisory_text: 'Advice generated for allocation revision 4',
    advisory_explanation: { status: 'READY' },
    ...overrides,
  };
}

describe('deferred advisory allocation binding', () => {
  let resolveAdvisory;

  beforeEach(() => {
    appMocks.profile = {
      profileId: '64b000000000000000000002',
      age: 34,
      monthly_take_home: 100000,
      monthly_savings: 25000,
      investment_goals: ['Wealth Growth'],
      investment_horizon_years: 10,
      risk_tolerance: 'Moderate',
    };
    appMocks.initialRecommendation = {
      ...revision4,
      profileId: appMocks.profile.profileId,
      instruments: [],
      advisory_text: null,
      advisory_explanation: { status: 'PENDING' },
      calculation_freshness: { fresh: true },
    };
    appMocks.fetchAdvisory.mockReset();
    appMocks.fetchAdvisory.mockImplementation(() => new Promise(resolve => {
      resolveAdvisory = resolve;
    }));
    appMocks.getRecommendations.mockReset();
    appMocks.updateRecommendationWeights.mockReset();
    appMocks.updateRecommendationWeights.mockResolvedValue({
      recommendation_id: recommendationId,
      instruments: [],
      advisory_text: null,
      advisory_explanation: { status: 'STALE' },
      explanation: null,
      generation_explanation: null,
      portfolio_return_assumption: null,
      return_data_class: null,
      return_assumption_version: 'fixture-assumption-v1',
      return_assumption_source: 'FIXTURE',
      observed_market_fact: false,
      provider_forecast: false,
      asset_class_allocation: {},
      dashboard_projection: {},
      current_allocation_source: 'USER_REBALANCED',
      generation_market_adjustment: null,
      market_adjustment: null,
      allocation_revision: 5,
      allocation_revision_id: 'allocation-revision-5',
      portfolio_fingerprint: 'fingerprint-revision-5',
      calculation_freshness: { fresh: true },
    });
    window.history.replaceState({}, '', '/profile?page=home');
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not merge revision 4 advisory after the App advances to revision 5', async () => {
    render(<App />);

    await waitFor(() => expect(appMocks.fetchAdvisory).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('allocation-revision')).toHaveTextContent('4');

    fireEvent.click(screen.getByRole('button', { name: 'Open progress' }));
    await screen.findByRole('button', { name: 'Apply revision 5' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply revision 5' }));
    await waitFor(() => {
      expect(appMocks.updateRecommendationWeights).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'View dashboard' }));
    await waitFor(() => {
      expect(screen.getByTestId('allocation-revision')).toHaveTextContent('5');
      expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('fingerprint-revision-5');
    });

    await act(async () => {
      resolveAdvisory(advisoryBinding());
    });

    expect(screen.getByTestId('allocation-revision')).toHaveTextContent('5');
    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('fingerprint-revision-5');
    expect(screen.getByTestId('advisory-text')).toBeEmptyDOMElement();
    expect(screen.getByTestId('advisory-text')).not.toHaveTextContent('revision 4');
    expect(screen.getByTestId('advisory-status')).toHaveTextContent('STALE');
  });

  it('also discards a late advisory from handleAuthoritativeRecompute after state advances', async () => {
    appMocks.initialRecommendation = {
      ...appMocks.initialRecommendation,
      advisory_text: 'Previously validated revision 4 advisory',
      advisory_explanation: { status: 'READY' },
    };
    appMocks.getRecommendations.mockResolvedValueOnce({
      ...appMocks.initialRecommendation,
      advisory_text: null,
      advisory_explanation: { status: 'PENDING' },
      calculation_freshness: { fresh: true },
    });

    render(<App />);
    await screen.findByTestId('allocation-revision');
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }));
    await screen.findByRole('button', { name: 'Refresh recommendation' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recommendation' }));

    await waitFor(() => {
      expect(appMocks.getRecommendations).toHaveBeenCalledTimes(1);
      expect(appMocks.fetchAdvisory).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply revision 5' }));
    await waitFor(() => expect(appMocks.updateRecommendationWeights).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'View dashboard' }));
    await waitFor(() => {
      expect(screen.getByTestId('allocation-revision')).toHaveTextContent('5');
      expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('fingerprint-revision-5');
    });

    await act(async () => {
      resolveAdvisory(advisoryBinding());
    });

    expect(screen.getByTestId('allocation-revision')).toHaveTextContent('5');
    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('fingerprint-revision-5');
    expect(screen.getByTestId('advisory-text')).toBeEmptyDOMElement();
    expect(screen.getByTestId('advisory-status')).toHaveTextContent('STALE');
  });

  it('accepts only a complete exact source-state binding', () => {
    const current = { ...revision4 };
    expect(advisoryMatchesCurrentFinancialState(current, advisoryBinding())).toBe(true);
    expect(advisoryMatchesCurrentFinancialState(current, advisoryBinding({ allocation_revision: 5 }))).toBe(false);
    expect(advisoryMatchesCurrentFinancialState(current, advisoryBinding({ portfolio_fingerprint: 'another-fingerprint' }))).toBe(false);
    expect(advisoryMatchesCurrentFinancialState(current, advisoryBinding({ allocation_revision: undefined }))).toBe(false);
    expect(advisoryMatchesCurrentFinancialState(current, advisoryBinding({ portfolio_fingerprint: undefined }))).toBe(false);
    expect(advisoryMatchesCurrentFinancialState(current, advisoryBinding({ allocation_revision_id: undefined }))).toBe(false);
  });
});
