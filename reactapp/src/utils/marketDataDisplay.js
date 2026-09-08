/** Keep absent financial facts absent. JavaScript's Number(null) === 0 must not leak into UI. */
export function nullableMarketNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNullablePercent(value, { decimals = 1, suffix = '%' } = {}) {
  const parsed = nullableMarketNumber(value);
  return parsed === null ? null : `${parsed.toFixed(decimals)}${suffix}`;
}
