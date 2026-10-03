import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNseDailyHistoryFreshness,
  evaluateNseQuoteFreshness,
} from '../services/marketData/nseTradingCalendar.js';

test('NSE quote freshness rejects a future provider observation on the expected trading date', () => {
  const now = new Date('2026-10-05T06:00:00.000Z');
  const result = evaluateNseQuoteFreshness({
    observedAt: '2026-10-05T06:01:00.000Z',
    fetchedAt: '2026-10-05T06:00:00.000Z',
    now,
  });

  assert.equal(result.marketSession, 'MARKET_OPEN');
  assert.equal(result.tradingDate, '2026-10-05');
  assert.equal(result.status, 'STALE');
});

test('NSE quote freshness rejects a future retrieval timestamp even when the quote itself is current', () => {
  const now = new Date('2026-10-05T06:00:00.000Z');
  const result = evaluateNseQuoteFreshness({
    observedAt: '2026-10-05T05:59:00.000Z',
    fetchedAt: '2026-10-05T06:01:00.000Z',
    now,
  });

  assert.equal(result.status, 'STALE');
});

test('NSE daily-history freshness rejects future-dated evidence instead of clamping its age to zero', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const result = evaluateNseDailyHistoryFreshness({
    effectiveTradingDate: '2026-10-05',
    requestedToDate: '2026-10-05',
    observedAt: '2026-10-05T12:01:00.000Z',
    fetchedAt: '2026-10-05T12:00:00.000Z',
    now,
  });

  assert.equal(result.status, 'STALE');
});
