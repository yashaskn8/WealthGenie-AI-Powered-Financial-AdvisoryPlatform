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
  getCurrentRecommendation: vi.fn(),
  getRecommendations: vi.fn(),
  updateRecommendationWeights: vi.fn(),
}));

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchAdvisory: appMocks.fetchAdvisory,
    getCurrentRecommendation: appMocks.getCurrentRecommendation,
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
const profileId = '64b000000000000000000002';
const profileInputHash = 'a'.repeat(64);
const nextProfileInputHash = '9'.repeat(64);
const returnAssumptionHash = 'd'.repeat(64);
const recommendationPolicyVersion = 'recommendation-policy-test-v1';
const regulatoryRuleVersion = 'regulatory-policy-test-v1';
const returnAssumptionVersion = 'assumption-test-v1';
const returnAssumptionSource = 'WEALTHGENIE_MODEL_POLICY';

function currentState(revision, {
  fingerprint = 'b'.repeat(64),
  stateId = '64b000000000000000000005',
  allocationRevisionId = `64b00000000000000000000${revision}`,
  recommendationId: boundRecommendationId = recommendationId,
  profileVersion = 1,
  profileInputHash: boundProfileInputHash = profileInputHash,
} = {}) {
  const recommendationFingerprint = (revision === 4 ? 'c' : 'e').repeat(64);
  const provenance = {
    status: 'PERSISTED_REVISION',
    stateId,
    recommendationId: boundRecommendationId,
    allocationSource: revision === 1 ? 'ORIGINAL_RECOMMENDATION' : 'USER_REBALANCED',
    allocationRevision: revision,
    allocationRevisionId,
    profileVersion,
    profileInputHash: boundProfileInputHash,
    portfolioFingerprint: fingerprint,
    recommendationFingerprint,
    recommendationPolicyVersion,
    regulatoryRuleVersion,
    returnAssumptionVersion,
    returnAssumptionHash,
    returnAssumptionSource,
    previousAllocationRevision: revision > 1 ? revision - 1 : null,
    previousAllocationRevisionId: revision > 1 ? `64b00000000000000000000${revision - 1}` : null,
  };
  return {
    profileId,
    profile_version: profileVersion,
    profile_input_hash: boundProfileInputHash,
    recommendationId: boundRecommendationId,
    recommendation_id: boundRecommendationId,
    allocation_revision: revision,
    allocation_revision_id: allocationRevisionId,
    previous_allocation_revision: provenance.previousAllocationRevision,
    previous_allocation_revision_id: provenance.previousAllocationRevisionId,
    portfolio_fingerprint: fingerprint,
    recommendation_fingerprint: recommendationFingerprint,
    recommendation_policy_version: recommendationPolicyVersion,
    regulatory_rule_version: regulatoryRuleVersion,
    return_assumption_version: returnAssumptionVersion,
    return_assumption_source: returnAssumptionSource,
    return_assumption_hash: returnAssumptionHash,
    current_allocation_source: revision === 1 ? 'ORIGINAL_RECOMMENDATION' : 'USER_REBALANCED',
    response_state: 'CURRENT',
    calculation_freshness: {
      fresh: true,
      reasonCodes: [],
      expectedProfileHash: boundProfileInputHash,
      observedProfileHash: boundProfileInputHash,
      expectedProfileVersion: profileVersion,
      observedProfileVersion: profileVersion,
      allocationRevision: revision,
      currentAllocationSource: revision === 1 ? 'ORIGINAL_RECOMMENDATION' : 'USER_REBALANCED',
      observedRegulatoryVersion: regulatoryRuleVersion,
      currentRegulatoryVersion: regulatoryRuleVersion,
      policyVersion: recommendationPolicyVersion,
      observedRecommendationPolicyVersion: recommendationPolicyVersion,
      assumptionVersion: returnAssumptionVersion,
      assumptionHash: returnAssumptionHash,
      assumptionSource: returnAssumptionSource,
    },
    state_provenance: provenance,
  };
}

const revision4 = {
  ...currentState(4, { fingerprint: 'b'.repeat(64) }),
  recommendationId,
};

function advisoryBinding(overrides = {}) {
  return {
    ...revision4,
    profile_version: revision4.profile_version,
    profile_input_hash: revision4.profile_input_hash,
    recommendation_fingerprint: revision4.recommendation_fingerprint,
    recommendation_policy_version: revision4.recommendation_policy_version,
    regulatory_rule_version: revision4.regulatory_rule_version,
    return_assumption_hash: revision4.return_assumption_hash,
    advisory_text: 'Advice generated for allocation revision 4',
    advisory_explanation: { status: 'READY' },
    ...overrides,
  };
}

describe('deferred advisory allocation binding', () => {
  let resolveAdvisory;

  beforeEach(() => {
    appMocks.profile = {
      profileId,
      version: 1,
      age: 34,
      monthly_take_home: 100000,
      monthly_savings: 25000,
      investment_goals: ['Wealth Growth'],
      investment_horizon_years: 10,
      risk_tolerance: 'Moderate',
    };
    appMocks.initialRecommendation = {
      ...revision4,
      instruments: [],
      advisory_text: null,
      advisory_explanation: { status: 'PENDING' },
    };
    appMocks.fetchAdvisory.mockReset();
    appMocks.getCurrentRecommendation.mockReset();
    appMocks.getCurrentRecommendation.mockResolvedValue(revision4);
    appMocks.fetchAdvisory.mockImplementation(() => new Promise(resolve => {
      resolveAdvisory = resolve;
    }));
    appMocks.getRecommendations.mockReset();
    appMocks.updateRecommendationWeights.mockReset();
    appMocks.updateRecommendationWeights.mockResolvedValue({
      ...currentState(5, { fingerprint: 'f'.repeat(64), stateId: '64b000000000000000000006' }),
      recommendation_id: recommendationId,
      instruments: [],
      advisory_text: null,
      advisory_explanation: { status: 'STALE' },
      explanation: null,
      generation_explanation: null,
      portfolio_return_assumption: null,
      return_data_class: null,
      return_assumption_version: returnAssumptionVersion,
      return_assumption_source: returnAssumptionSource,
      return_assumption_hash: returnAssumptionHash,
      observed_market_fact: false,
      provider_forecast: false,
      asset_class_allocation: {},
      dashboard_projection: {},
      current_allocation_source: 'USER_REBALANCED',
      generation_market_adjustment: null,
      market_adjustment: null,
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
      expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
    });

    await act(async () => {
      resolveAdvisory(advisoryBinding());
    });

    expect(screen.getByTestId('allocation-revision')).toHaveTextContent('5');
    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
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
      expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
    });

    await act(async () => {
      resolveAdvisory(advisoryBinding());
    });

    expect(screen.getByTestId('allocation-revision')).toHaveTextContent('5');
    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
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

  it('does not display or generate from a response bound to another profile', async () => {
    appMocks.initialRecommendation = null;
    appMocks.getCurrentRecommendation.mockResolvedValue({
      ...revision4,
      profileId: '64b000000000000000000099',
    });

    render(<App />);

    await waitFor(() => {
      expect(appMocks.getCurrentRecommendation).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('allocation-revision')).toHaveTextContent('missing');
    });
    expect(appMocks.getRecommendations).not.toHaveBeenCalled();
  });

  it('does not let an earlier recompute overwrite a later recompute on the same profile', async () => {
    appMocks.initialRecommendation = {
      ...revision4,
      advisory_text: 'Existing advisory',
      advisory_explanation: { status: 'READY' },
    };
    const pending = [];
    appMocks.getRecommendations.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }));
    const refresh = await screen.findByRole('button', { name: 'Refresh recommendation' });
    fireEvent.click(refresh);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recommendation' }));
    await waitFor(() => expect(pending).toHaveLength(2));

    const laterRecommendationId = '64b000000000000000000011';
    const later = {
      ...currentState(1, {
        fingerprint: 'f'.repeat(64),
        stateId: '64b000000000000000000012',
        allocationRevisionId: '64b000000000000000000013',
        recommendationId: laterRecommendationId,
      }),
      advisory_text: 'Later advisory',
      advisory_explanation: { status: 'READY' },
    };
    await act(async () => pending[1](later));
    fireEvent.click(screen.getByRole('button', { name: 'Open progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View dashboard' }));
    await waitFor(() => expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64)));

    await act(async () => pending[0](currentState(1, {
      fingerprint: 'a'.repeat(64),
      stateId: '64b000000000000000000014',
      allocationRevisionId: '64b000000000000000000015',
    })));
    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
    view.unmount();
  });

  it('rejects a late recompute from the old profile version after a newer profile state is restored', async () => {
    appMocks.initialRecommendation = {
      ...revision4,
      advisory_text: 'Existing advisory',
      advisory_explanation: { status: 'READY' },
    };
    const pending = [];
    appMocks.getRecommendations.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh recommendation' }));
    await waitFor(() => expect(pending).toHaveLength(1));

    appMocks.profile = { ...appMocks.profile, version: 2, monthly_savings: 30000 };
    const restoredProfileState = {
      ...currentState(1, {
        fingerprint: 'd'.repeat(64),
        stateId: '64b000000000000000000016',
        allocationRevisionId: '64b000000000000000000017',
        recommendationId: '64b000000000000000000018',
        profileVersion: 2,
        profileInputHash: nextProfileInputHash,
      }),
      advisory_text: 'Profile version 2 advisory',
      advisory_explanation: { status: 'READY' },
    };
    appMocks.getCurrentRecommendation.mockResolvedValueOnce(restoredProfileState);
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View dashboard' }));
    await waitFor(() => expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('d'.repeat(64)));

    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recommendation' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    const newerProfileState = {
      ...currentState(1, {
        fingerprint: 'f'.repeat(64),
        stateId: '64b000000000000000000019',
        allocationRevisionId: '64b000000000000000000020',
        recommendationId: '64b000000000000000000021',
        profileVersion: 2,
        profileInputHash: nextProfileInputHash,
      }),
      advisory_text: 'Recomputed version 2 advisory',
      advisory_explanation: { status: 'READY' },
    };
    await act(async () => pending[1](newerProfileState));
    fireEvent.click(screen.getByRole('button', { name: 'Open progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View dashboard' }));
    await waitFor(() => expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64)));
    await act(async () => pending[0](currentState(1, {
      fingerprint: 'a'.repeat(64),
      stateId: '64b000000000000000000022',
      allocationRevisionId: '64b000000000000000000023',
    })));

    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
    expect(screen.getByTestId('allocation-revision')).toHaveTextContent('1');
    view.unmount();
  });

  it('ignores an old advisory failure after the active profile version changes', async () => {
    appMocks.initialRecommendation = {
      ...revision4,
      advisory_text: null,
      advisory_explanation: { status: 'PENDING' },
    };
    let rejectOldAdvisory;
    appMocks.fetchAdvisory.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectOldAdvisory = reject;
    }));
    const view = render(<App />);
    await waitFor(() => expect(rejectOldAdvisory).toBeTypeOf('function'));

    const nextProfileState = {
      ...currentState(1, {
        fingerprint: 'f'.repeat(64),
        stateId: '64b000000000000000000024',
        allocationRevisionId: '64b000000000000000000025',
        recommendationId: '64b000000000000000000026',
        profileVersion: 2,
        profileInputHash: nextProfileInputHash,
      }),
      advisory_text: 'Version 2 advisory',
      advisory_explanation: { status: 'READY' },
    };
    appMocks.profile = { ...appMocks.profile, version: 2, monthly_savings: 30000 };
    appMocks.getCurrentRecommendation.mockResolvedValueOnce(nextProfileState);
    view.rerender(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View dashboard' }));
    await waitFor(() => expect(screen.getByTestId('advisory-text')).toHaveTextContent('Version 2 advisory'));

    await act(async () => rejectOldAdvisory({ status: 500, message: 'Old profile advisory failed' }));
    expect(screen.getByTestId('portfolio-fingerprint')).toHaveTextContent('f'.repeat(64));
    expect(screen.getByTestId('advisory-text')).toHaveTextContent('Version 2 advisory');
    expect(screen.getByTestId('advisory-status')).toHaveTextContent('READY');
    view.unmount();
  });
});
