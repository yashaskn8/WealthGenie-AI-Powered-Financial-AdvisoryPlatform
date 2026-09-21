/**
 * WealthGenie API Client
 * Configured for the Express backend.
 * Production authentication uses an HttpOnly session cookie. Optional development
 * bearer compatibility is memory-only and never persists authentication material.
 */

import { toFinancialProfilePayload } from '../utils/financialProfile';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
const configuredTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);
const DEFAULT_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
  ? configuredTimeout
  : 20000;
const BEARER_AUTH_ENABLED = !import.meta.env.PROD
  && import.meta.env.VITE_ENABLE_BEARER_AUTH !== 'false';

const LEGACY_SENSITIVE_KEYS = [
  'wg_token', 'wg_user', 'wg_profile', 'wg_profile_complete', 'wealthgenie_user_profile',
];

export function purgeSensitiveBrowserStorage({ includeChatSession = false } = {}) {
  if (typeof window === 'undefined') return;
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[storageName];
      LEGACY_SENSITIVE_KEYS.forEach(key => storage.removeItem(key));
      if (includeChatSession) storage.removeItem('genie_session_id');
    } catch {
      // Privacy-disabled storage needs no cleanup.
    }
  }
}

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const entry of document.cookie.split(';')) {
    const value = entry.trim();
    if (value.startsWith(prefix)) {
      try { return decodeURIComponent(value.slice(prefix.length)); } catch { return null; }
    }
  }
  return null;
}

// Sensitive state is memory-only; a refresh restores it through /auth/session.
let authToken = null;
let csrfToken = readCookie('wg_csrf');
let authRevision = 0;
const authListeners = new Set();

// Track the current authenticated user
let currentUser = null;

purgeSensitiveBrowserStorage();

function notifyAuthChange() {
  authRevision += 1;
  authListeners.forEach(listener => listener());
}

export function subscribeAuth(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export function getAuthSnapshot() {
  return authRevision;
}

export function setUserInfo(user) {
  currentUser = user;
  notifyAuthChange();
}

export function getUserInfo() {
  return currentUser;
}

export function setAuthToken(token) {
  authToken = BEARER_AUTH_ENABLED ? token : null;
  notifyAuthChange();
}

export function getAuthToken() {
  return authToken;
}

export function clearAuthToken() {
  authToken = null;
  csrfToken = null;
  currentUser = null;
  purgeSensitiveBrowserStorage();
  notifyAuthChange();
}

export function clearUserSession() {
  clearAuthToken();
  purgeSensitiveBrowserStorage({ includeChatSession: true });
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class ApiError extends Error {
  constructor(message, {
    status = null,
    code = 'API_ERROR',
    requestId = null,
    details = [],
    retryable = false,
    retryAfterMs = null,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(30000, Math.max(0, date - Date.now())) : null;
}

function retryDelay(attempt, retryAfterMs) {
  if (Number.isFinite(retryAfterMs)) return retryAfterMs;
  const exponential = Math.min(5000, 300 * (2 ** attempt));
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('Request cancelled.', { code: 'REQUEST_ABORTED' }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError('Request cancelled.', { code: 'REQUEST_ABORTED' }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function request(method, path, data = null, options = {}) {
  const url = `${API_BASE}${path}`;
  const upperMethod = method.toUpperCase();
  const isMutating = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(upperMethod);
  const {
    headers: optionHeaders = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = isMutating ? 0 : 1,
    signal: externalSignal,
    ...fetchOptions
  } = options;
  const headers = { Accept: 'application/json', ...optionHeaders };
  if (data !== null && data !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  if (!headers['X-Correlation-ID'] && !headers['x-correlation-id']) {
    headers['X-Correlation-ID'] = generateUUID();
  }

  // Attach Idempotency-Key for mutating requests (POST, PUT, DELETE, PATCH)
  if (isMutating) {
    if (!headers['Idempotency-Key'] && !headers['idempotency-key']) {
      headers['Idempotency-Key'] = generateUUID();
    }
    const activeCsrfToken = csrfToken || readCookie('wg_csrf');
    if (!authToken && activeCsrfToken && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
      headers['X-CSRF-Token'] = activeCsrfToken;
    }
  }

  const maxRetries = Math.max(0, Math.min(3, Number(retries) || 0));
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : DEFAULT_TIMEOUT_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (externalSignal?.aborted) {
      throw new ApiError('Request cancelled.', { code: 'REQUEST_ABORTED' });
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, boundedTimeout);

    const config = {
      method: upperMethod,
      headers,
      credentials: 'include',
      ...fetchOptions,
      signal: controller.signal,
    };
    if (data !== null && data !== undefined) config.body = JSON.stringify(data);

    try {
      const res = await fetch(url, config);
      let json = null;
      try {
        json = await res.json();
      } catch {
        // Some proxies and valid 204 responses do not return a JSON body.
      }

      const requestId = res.headers?.get?.('x-correlation-id') || json?.request_id || headers['X-Correlation-ID'];
      if (!res.ok) {
        if (res.status === 401) {
          clearUserSession();
          if (typeof window !== 'undefined' && window.location.pathname !== '/' && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        const responseDetails = (Array.isArray(json?.details)
          || (json?.details && typeof json.details === 'object'))
          ? json.details
          : [];
        const validationMessage = Array.isArray(responseDetails) ? responseDetails.join(' ') : '';
        throw new ApiError(
          json?.message || validationMessage || json?.error || `Request failed with status ${res.status}`,
          {
            status: res.status,
            code: json?.code || 'HTTP_ERROR',
            requestId,
            details: responseDetails,
            retryable: RETRYABLE_STATUS.has(res.status),
            retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')),
          }
        );
      }
      return json;
    } catch (error) {
      let apiError = error;
      if (!(error instanceof ApiError)) {
        if (timedOut) {
          apiError = new ApiError('The server took too long to respond.', {
            code: 'REQUEST_TIMEOUT', retryable: true, cause: error,
          });
        } else if (externalSignal?.aborted) {
          apiError = new ApiError('Request cancelled.', { code: 'REQUEST_ABORTED', cause: error });
        } else {
          apiError = new ApiError('Unable to reach the server. Check your connection and try again.', {
            code: 'NETWORK_ERROR', retryable: true, cause: error,
          });
        }
      }

      if (apiError.retryable && attempt < maxRetries) {
        await wait(retryDelay(attempt, apiError.retryAfterMs), externalSignal);
        continue;
      }
      throw apiError;
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw new ApiError('Request failed.', { code: 'API_ERROR' });
}

// ─── AUTH ─────────────────────────────────────────────────
export async function register(name, email, password, mobile) {
  const data = await request('POST', '/auth/register', { name, email, password, mobile });
  csrfToken = data.csrfToken || readCookie('wg_csrf');
  setAuthToken(data.token || null);
  if (data.user) setUserInfo(data.user);
  return data;
}

export async function login(email, password) {
  const data = await request('POST', '/auth/login', { email, password });
  csrfToken = data.csrfToken || readCookie('wg_csrf');
  setAuthToken(data.token || null);
  if (data.user) setUserInfo(data.user);
  return data;
}

export async function logout() {
  try {
    if (authToken || currentUser) {
      return await request('POST', '/auth/logout', {}, { timeoutMs: 5000, retries: 0 });
    }
    return null;
  } finally {
    clearUserSession();
  }
}

export async function restoreSession(options = {}) {
  const data = await request('GET', '/auth/session', null, { retries: 0, ...options });
  csrfToken = data?.csrfToken || readCookie('wg_csrf');
  if (data?.user) setUserInfo(data.user);
  return data;
}

// ─── PROFILE ─────────────────────────────────────────────
export async function buildProfile(profile, requestOptions = {}) {
  return request('POST', '/profile/build', toFinancialProfilePayload(profile), requestOptions);
}

export async function precomputeProfile(profile, requestOptions = {}) {
  return request('POST', '/profile/precompute', toFinancialProfilePayload(profile), {
    timeoutMs: 90000,
    ...requestOptions,
  });
}

export async function completeFinancialProfile(profile, candidateId = null, requestOptions = {}) {
  return request('POST', '/profile/complete', {
    ...toFinancialProfilePayload(profile),
    ...(candidateId ? { candidateId } : {}),
  }, {
    timeoutMs: 90000,
    ...requestOptions,
  });
}

export async function getCurrentProfile(options = {}) {
  return request('GET', '/profile/current', null, { retries: 0, ...options });
}

export async function getFinancialHealthScore(profileId, options = {}) {
  return request('GET', `/profile/${profileId}/health-score`, null, options);
}

export async function updateProfile(profileId, profile, requestOptions = {}) {
  return request(
    'PUT',
    `/profile/${profileId}`,
    toFinancialProfilePayload(profile, { requireVersion: true }),
    requestOptions,
  );
}
// ─── RECOMMENDATIONS ─────────────────────────────────────
export async function getRecommendations(profileId, options = {}) {
  // Recommendation generation can include a cold ML-service prediction and an
  // audited MongoDB transaction. Keep the UI request alive for the same bounded
  // window used by the real-dependency browser contract instead of aborting at
  // the generic 20-second API timeout and leaving every dashboard panel empty.
  return request('POST', '/recommend', { profileId }, { timeoutMs: 90000, ...options });
}

export async function fetchAdvisory(recommendationId, options = {}) {
  return request('POST', `/recommend/${recommendationId}/advisory`, {}, { timeoutMs: 90000, ...options });
}

// ─── VERIFIED MARKET DATA (PHASE 1) ──────────────────────
export async function getBenchmarkMarketFacts(options = {}) {
  return request('GET', '/market/benchmarks', null, options);
}

export async function getMutualFundNavFacts(schemeCodes, options = {}) {
  const normalized = [...new Set((schemeCodes || []).map(value => String(value).trim()).filter(Boolean))];
  if (normalized.length === 0 || normalized.length > 50 || normalized.some(code => !/^\d+$/.test(code))) {
    throw new TypeError('schemeCodes must contain 1-50 AMFI numeric scheme codes.');
  }
  return request('GET', `/market/mutual-funds/nav?schemeCodes=${encodeURIComponent(normalized.join(','))}`, null, options);
}

// ─── INSTRUMENTS ─────────────────────────────────────────
export async function getInstruments(type, sort = 'rate', order = 'desc', limit = 20) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  params.set('sort', sort);
  params.set('order', order);
  params.set('limit', limit);
  return request('GET', `/instruments?${params.toString()}`);
}

export async function rankInvestmentCandidates(profileId, parentInstrumentId, taxCalculationContext = null, requestOptions = {}) {
  let actualTaxContext = null;
  let actualOptions = requestOptions;
  if (taxCalculationContext && !taxCalculationContext.signal && !taxCalculationContext.timeoutMs && !taxCalculationContext.headers) {
    actualTaxContext = taxCalculationContext;
  } else if (taxCalculationContext && (taxCalculationContext.signal || taxCalculationContext.timeoutMs || taxCalculationContext.headers)) {
    actualOptions = taxCalculationContext;
    actualTaxContext = null;
  }

  const payload = {
    profileId,
    parentInstrumentId,
  };
  if (actualTaxContext) {
    payload.taxCalculationContext = actualTaxContext;
  }

  return request('POST', '/instruments/rank-wti', payload, { timeoutMs: 90000, ...actualOptions });
}

// ─── PROJECTIONS ─────────────────────────────────────────
export async function getProjections(profileId, instruments, monthlyInvestment, years) {
  const payload = {
    profileId,
    instruments,
    monthly_investment: monthlyInvestment,
  };
  if (years !== undefined) payload.years = years;
  return request('POST', '/projection', payload);
}

export async function calculateStepUpProjection(monthlyInvestment, annualReturnRate, years, annualStepUpRate, options = {}) {
  return request('POST', '/projection/step-up', {
    monthlyInvestment,
    annualReturnRate,
    years,
    annualStepUpRate,
  }, options);
}

export async function calculateAllocationSplit(monthlyInvestment, equityPct, options = {}) {
  return request('POST', '/projection/allocation-split', {
    monthlyInvestment,
    equityPct,
  }, options);
}

export async function compareInvestmentProjection(monthlyInvestment, annualReturnRate, benchmarkRate, inflationRate, years, options = {}) {
  return request('POST', '/projection/compare', {
    monthlyInvestment,
    annualReturnRate,
    benchmarkRate,
    inflationRate,
    years,
  }, options);
}

export async function getCustomPortfolioProjection(profileId, allocations, years, options = {}) {
  return request('POST', '/projection/custom-portfolio', { profileId, allocations, years }, options);
}

export async function runInstrumentStressTest(profileId, instrumentId, principal, options = {}) {
  return request('POST', '/projection/stress-test', {
    profileId,
    instrumentId,
    principal,
  }, options);
}

// ─── MONTE CARLO ─────────────────────────────────────────
export async function runMonteCarlo(instrument, monthlyInvestment, years, targetAmount, profileId) {
  const payload = {
    profileId,
    instrument,
    monthly_investment: monthlyInvestment,
    years,
  };
  if (targetAmount !== null && targetAmount !== undefined && targetAmount !== '') {
    payload.target_amount = targetAmount;
  }
  return request('POST', '/montecarlo/montecarlo', payload);
}

export async function runPortfolioMonteCarlo(profileId, allocations, years, targetAmount, options = {}) {
  const payload = { profileId, allocations, years };
  if (targetAmount !== null && targetAmount !== undefined && targetAmount !== '') {
    payload.target_amount = targetAmount;
  }
  return request('POST', '/montecarlo/portfolio', payload, options);
}

// ─── GOALS ───────────────────────────────────────────────
export async function createGoal(goalData) {
  return request('POST', '/goals/create', goalData);
}

export async function getGoals() {
  return request('GET', '/goals');
}

export async function updateGoal(goalId, goalData) {
  return request('PATCH', `/goals/${goalId}`, goalData);
}

export async function simulateGoal(goalId, monthlyContribution, options = {}) {
  return request('POST', `/goals/${goalId}/simulate`, { monthly_contribution: monthlyContribution }, options);
}

export async function deleteGoal(goalId) {
  return request('DELETE', `/goals/${goalId}`);
}

// ─── HEALTH ──────────────────────────────────────────────
export async function healthCheck(options = {}) {
  return request('GET', '/health', null, options);
}

// ─── MARKET DATA ─────────────────────────────────────────
export async function getMarketRates(options = {}) {
  return request('GET', '/market/rates', null, options);
}

export async function refreshMarketRates() {
  return request('POST', '/market/refresh');
}

// ─── CHAT (Genie) ────────────────────────────────────────
export async function sendChatMessage(message, sessionId, options = {}) {
  return request('POST', '/chat/message', { message, session_id: sessionId }, { timeoutMs: 45000, ...options });
}

export async function getChatHistory(sessionId, options = {}) {
  const params = new URLSearchParams({ session_id: String(sessionId), limit: '50' });
  return request('GET', `/chat/history?${params.toString()}`, null, options);
}

export async function clearChatSession(sessionId) {
  return request('DELETE', `/chat/session/${encodeURIComponent(sessionId)}`);
}

export async function computeTax(income, regime, deductions = {}) {
  const params = new URLSearchParams({ income: String(income), regime });
  Object.entries(deductions).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  });
  return request('GET', `/tax/compute?${params.toString()}`);
}

export async function compareTax(income, deductions = {}) {
  const params = new URLSearchParams({ income: String(income) });
  Object.entries(deductions).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  });
  return request('GET', `/tax/compare?${params.toString()}`);
}

export async function getTaxPolicyMetadata(options = {}) {
  return request('GET', '/tax/policies', null, options);
}

export async function getCurrentMarketContext(options = {}) {
  return request('GET', '/regime/current', null, options);
}

export async function previewMarketContextAdjustment(profileId, options = {}) {
  return request('POST', '/regime/adjust', { profileId }, options);
}

export async function rebalancePortfolio(profileId, currentAllocation, targetAllocation, threshold, partialRatio, holdingMonths) {
  return request('POST', '/portfolio/rebalance', {
    profileId,
    current_allocation: currentAllocation,
    target_allocation: targetAllocation,
    threshold,
    partial_ratio: partialRatio,
    holding_months: holdingMonths,
  });
}

export async function updateRecommendationWeights(profileId, weights) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    throw new TypeError('weights must be an explicit instrument-weight map');
  }
  const entries = Object.entries(weights);
  if (!entries.length || entries.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('Every recommendation weight must be a number from 0 to 1');
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (Math.abs(total - 1) > 0.0001) throw new RangeError('Recommendation weights must sum to exactly 1');
  return request('POST', '/recommend/weights', { profileId, weights });
}

export async function optimisePortfolio(profileId, assets, strategy) {
  return request('POST', '/portfolio/optimise', {
    profileId,
    assets,
    strategy,
  });
}

// ─── POST-TAX RETURN (WG-038: backend single source of truth) ────
export async function computePostTaxReturn(instrumentType, nominalRate, annualIncome, holdingYears, regime, monthlySIP, userAge, incomeSource, fiscalYear, options = {}) {
  return request('POST', '/tax/post-tax-return', {
    instrumentType, nominalRate, annualIncome, holdingYears, regime, monthlySIP, userAge, incomeSource, fiscalYear,
    ...(options.body || {}),
  }, options);
}

export async function computePostTaxReturnBatch(instruments, annualIncome, regime, userAge, incomeSource, inflationRate, fiscalYear, options = {}) {
  return request('POST', '/tax/post-tax-return/batch', {
    instruments, annualIncome, regime, userAge, incomeSource, inflationRate, fiscalYear,
    ...(options.body || options),
  });
}

// Default export for convenience
const api = {
  register, login, logout, restoreSession,
  setAuthToken, getAuthToken, clearAuthToken, clearUserSession,
  subscribeAuth, getAuthSnapshot,
  setUserInfo, getUserInfo,
  buildProfile, precomputeProfile, completeFinancialProfile, getCurrentProfile, getFinancialHealthScore, updateProfile, getRecommendations, getInstruments, rankInvestmentCandidates, getProjections, calculateStepUpProjection, calculateAllocationSplit, compareInvestmentProjection, getCustomPortfolioProjection, runInstrumentStressTest,
  runMonteCarlo, runPortfolioMonteCarlo, createGoal, getGoals, updateGoal, simulateGoal, deleteGoal, healthCheck,
  getMarketRates, getBenchmarkMarketFacts, getMutualFundNavFacts, refreshMarketRates,
  sendChatMessage, getChatHistory, clearChatSession, rebalancePortfolio,
  updateRecommendationWeights, optimisePortfolio,
  computeTax, compareTax, getTaxPolicyMetadata, getCurrentMarketContext, previewMarketContextAdjustment, computePostTaxReturn, computePostTaxReturnBatch,
};

export default api;
