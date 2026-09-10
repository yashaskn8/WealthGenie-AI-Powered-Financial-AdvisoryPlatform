import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMarketContextRefreshDelay,
  MARKET_CONTEXT_CLOSED_REFRESH_MS,
  MARKET_CONTEXT_HOLIDAY_REFRESH_MS,
  MARKET_CONTEXT_OPEN_REFRESH_MS,
} from '../jobs/marketDataRefresh.js';

function resultForSession(status) {
  return { marketSnapshot: { marketSession: { status } } };
}

test('market context refresh cadence stays inside the open-session age contract', () => {
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('MARKET_OPEN')),
    MARKET_CONTEXT_OPEN_REFRESH_MS,
  );
  assert.ok(MARKET_CONTEXT_OPEN_REFRESH_MS < 15 * 60 * 1000);
  assert.ok(MARKET_CONTEXT_OPEN_REFRESH_MS >= 5 * 60 * 1000);
});

test('market context refresh cadence backs off outside an active session', () => {
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('MARKET_CLOSED')),
    MARKET_CONTEXT_CLOSED_REFRESH_MS,
  );
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('MARKET_HOLIDAY')),
    MARKET_CONTEXT_HOLIDAY_REFRESH_MS,
  );
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('UNKNOWN')),
    MARKET_CONTEXT_CLOSED_REFRESH_MS,
  );
});
