import { describe, expect, it } from 'vitest';
import {
  formatMarketTimestamp,
  formatNullablePercent,
  getMarketDisplayState,
  getMarketEvidenceSource,
  nullableMarketNumber,
} from './marketDataDisplay';

describe('nullable market-data presentation', () => {
  it('does not coerce missing or invalid facts to zero', () => {
    expect(nullableMarketNumber(null)).toBeNull();
    expect(nullableMarketNumber(undefined)).toBeNull();
    expect(nullableMarketNumber('')).toBeNull();
    expect(nullableMarketNumber('unavailable')).toBeNull();
    expect(formatNullablePercent(null)).toBeNull();
  });

  it('preserves a genuinely observed zero', () => {
    expect(nullableMarketNumber(0)).toBe(0);
    expect(formatNullablePercent(0)).toBe('0.0%');
  });

  it('uses backend snapshot status and keeps legacy contexts explicitly last-available', () => {
    expect(getMarketDisplayState(null, { loading: true }).key).toBe('LOADING');
    expect(getMarketDisplayState({ status: 'MARKET_CONTEXT_AVAILABLE', context: 'NORMAL' }).key).toBe('LAST_AVAILABLE');
    expect(getMarketDisplayState({ marketSnapshot: { status: 'MARKET_CLOSED' } }).label).toBe('Market closed');
    expect(getMarketEvidenceSource({
      marketSnapshot: { providerStatus: { quotes: { provider: 'NSE' } } },
    })).toBe('NSE');
  });

  it('formats only valid observed timestamps', () => {
    expect(formatMarketTimestamp('not-a-date')).toBeNull();
    expect(formatMarketTimestamp('2026-09-08T10:00:00.000Z')).toContain('8 Sept 2026');
  });
});
