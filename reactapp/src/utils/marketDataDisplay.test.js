import { describe, expect, it } from 'vitest';
import { formatNullablePercent, nullableMarketNumber } from './marketDataDisplay';

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
});
