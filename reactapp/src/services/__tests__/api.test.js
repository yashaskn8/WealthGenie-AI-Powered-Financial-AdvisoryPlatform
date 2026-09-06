import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api.js';

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: { get: vi.fn(name => headers[name.toLowerCase()] || null) },
  };
}

const CANONICAL_PROFILE = Object.freeze({
  monthly_take_home: 100000,
  monthly_savings: 20000,
  age: 35,
  risk_tolerance: 'Moderate',
  sold_property_proceeds: 0,
  has_lump_sum: false,
  lump_sum_amount: 0,
  liquid_savings: 200000,
  emi_burden_pct: 10,
  financial_dependents: 1,
  emergency_fund_months: 6,
  investment_goals: ['Wealth Growth'],
  investment_horizon_years: 10,
});

describe('frontend API contracts', () => {
  beforeEach(() => {
    api.clearAuthToken();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends the mobile number collected by registration to the backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ token: 'token', user: {} }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await api.register('Test User', 'test@example.com', 'StrongPass1!', '9876543210');

    const [, config] = fetchMock.mock.calls[0];
    expect(JSON.parse(config.body)).toEqual({
      name: 'Test User',
      email: 'test@example.com',
      password: 'StrongPass1!',
      mobile: '9876543210',
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('sends explicit Monte Carlo inputs and the authoritative profile ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.runMonteCarlo('FD', 5000, 10, null, '64b000000000000000000001');

    const [, config] = fetchMock.mock.calls[0];
    expect(JSON.parse(config.body)).toEqual({
      profileId: '64b000000000000000000001',
      instrument: 'FD',
      monthly_investment: 5000,
      years: 10,
    });
  });

  it('surfaces backend validation details instead of a generic error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: 'Validation failed',
      details: ['target_amount must be at least 1000'],
    }, 400)));

    await expect(api.runMonteCarlo('FD', 5000, 10, 500, '64b000000000000000000001')).rejects.toThrow(
      'target_amount must be at least 1000'
    );
  });

  it('requires explicit fractional weights and preserves them exactly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ instruments: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await api.updateRecommendationWeights('64b000000000000000000001', {
      Equity_MF: 0.75,
      Debt_MF: 0.25,
    });

    const [, config] = fetchMock.mock.calls[0];
    expect(JSON.parse(config.body)).toEqual({
      profileId: '64b000000000000000000001',
      weights: {
        Equity_MF: 0.75,
        Debt_MF: 0.25,
      },
    });
  });

  it('routes market data through the same-origin API client and includes auth on refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ instrument_data_sources: {} }))
      .mockResolvedValueOnce(jsonResponse({ refreshed: true }));
    vi.stubGlobal('fetch', fetchMock);
    api.setAuthToken('market-token');

    await api.getMarketRates();
    await api.refreshMarketRates();

    const ratesUrl = fetchMock.mock.calls[0][0];
    const refreshUrl = fetchMock.mock.calls[1][0];
    expect(ratesUrl).toMatch(/\/api\/market\/rates$/);
    expect(refreshUrl).toBe(ratesUrl.replace('/market/rates', '/market/refresh'));
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer market-token');
  });

  it('routes personalized product ranking to Express with explicit decision options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ products: [{ id: 'index' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await api.rankInvestmentCandidates(
      '64b000000000000000000001',
      'Index_MF',
      [{ id: 'index', name: 'Index Fund', highlight: 'Low-cost option' }],
    );

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/instruments\/rank-wti$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      profileId: '64b000000000000000000001',
      parentInstrumentId: 'Index_MF',
      candidates: [{ id: 'index', name: 'Index Fund', highlight: 'Low-cost option' }],
    });
  });

  it('adds a correlation ID and does not retry failed mutations', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createGoal({ goal_name: 'Home' })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NETWORK_ERROR',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers['X-Correlation-ID']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('preserves the canonical server error code, request ID, and structured details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: 'Version conflict.',
      message: 'Version conflict.',
      code: 'PROFILE_VERSION_CONFLICT',
      request_id: '8ba3f55e-4719-41b5-a5b1-671af22871b4',
      details: { currentVersion: 4, expectedVersion: 3 },
    }, 409)));

    await expect(api.updateProfile('profile-1', { ...CANONICAL_PROFILE, version: 3 })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'PROFILE_VERSION_CONFLICT',
      requestId: '8ba3f55e-4719-41b5-a5b1-671af22871b4',
      details: { currentVersion: 4, expectedVersion: 3 },
    });
  });

  it('aborts requests that exceed their timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url, config) => new Promise((resolve, reject) => {
      config.signal.addEventListener('abort', () => {
        const error = new Error(`aborted ${url}`);
        error.name = 'AbortError';
        reject(error);
      });
    })));

    const pending = api.healthCheck({ timeoutMs: 10, retries: 0 });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
  });

  it('logs out through the backend and clears user-scoped browser data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Logout successful.' }));
    vi.stubGlobal('fetch', fetchMock);
    api.setAuthToken('logout-token');
    api.setUserInfo({ id: 'user-1' });
    localStorage.setItem('wealthgenie_user_profile', '{"age":30}');
    sessionStorage.setItem('genie_session_id', 'session-1');

    await api.logout();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/logout$/);
    expect(api.getAuthToken()).toBeNull();
    expect(api.getUserInfo()).toBeNull();
    expect(localStorage.getItem('wealthgenie_user_profile')).toBeNull();
    expect(sessionStorage.getItem('genie_session_id')).toBeNull();
  });

  it('encodes chat session IDs as query data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await api.getChatHistory('session&limit=999');

    expect(fetchMock.mock.calls[0][0]).toContain('session_id=session%26limit%3D999');
    expect(fetchMock.mock.calls[0][0]).toContain('&limit=50');
  });

  it('restores an HttpOnly cookie session without requiring a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      user: { id: 'cookie-user', email: 'cookie@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.restoreSession();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/session$/);
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(api.getUserInfo()).toMatchObject({ id: 'cookie-user' });
    expect(localStorage.getItem('wg_user')).toBeNull();
    expect(localStorage.getItem('wg_token')).toBeNull();
  });

  it('never persists financial lifecycle payloads in browser storage', async () => {
    const responses = [
      { csrfToken: 'csrf', user: { id: 'privacy-user', email: 'privacy@example.com' } },
      { profileId: '64b000000000000000000001', ...CANONICAL_PROFILE },
      { recommendationId: 'rec-1', auditId: 'audit-1', instruments: [{ type: 'ETF' }] },
      { id: 'goal-1', goal_name: 'Private home goal', target_amount: 7654321 },
      { message: 'Logout successful.' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(responses.shift()))));
    const localSet = vi.spyOn(Storage.prototype, 'setItem');

    await api.login('privacy@example.com', 'StrongPass1!');
    await api.buildProfile(CANONICAL_PROFILE);
    await api.getRecommendations('64b000000000000000000001');
    await api.createGoal({ goal_name: 'Private home goal', target_amount: 7654321, target_date: '2035-01-01' });
    await api.logout();

    const persisted = [...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index))).join(' ')
      + [...Array(sessionStorage.length)].map((_, index) => sessionStorage.getItem(sessionStorage.key(index))).join(' ');
    expect(persisted).not.toContain('100000');
    expect(persisted).not.toContain('20000');
    expect(persisted).not.toContain('200000');
    expect(persisted).not.toContain('7654321');
    expect(persisted).not.toContain('rec-1');
    expect(persisted).not.toContain('privacy@example.com');
    expect(localSet).not.toHaveBeenCalled();
  });

  it('binds cookie-authenticated mutations to the server-issued CSRF token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        csrfToken: 'server-csrf-token',
        user: { id: 'cookie-user' },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'goal-1' }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await api.login('cookie@example.com', 'StrongPass1!');
    await api.createGoal({ goal_name: 'Retirement' });

    const mutation = fetchMock.mock.calls[1][1];
    expect(mutation.credentials).toBe('include');
    expect(mutation.headers.Authorization).toBeUndefined();
    expect(mutation.headers['X-CSRF-Token']).toBe('server-csrf-token');
  });

  it('honours Retry-After when retrying safe requests', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.healthCheck();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
