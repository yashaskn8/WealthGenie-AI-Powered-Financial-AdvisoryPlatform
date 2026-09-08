function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeIsin(value) {
  const isin = clean(value).toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin) ? isin : null;
}

export function buildAmfiProductIdentity({ schemeCode, primaryIsin, secondaryIsin }) {
  const normalizedSchemeCode = clean(String(schemeCode ?? ''));
  if (!/^\d+$/.test(normalizedSchemeCode)) {
    throw new TypeError('AMFI scheme code must be numeric.');
  }
  const isins = [...new Set([normalizeIsin(primaryIsin), normalizeIsin(secondaryIsin)].filter(Boolean))];
  return {
    canonicalProductId: `mf:amfi:${normalizedSchemeCode}`,
    externalIds: [
      { source: 'AMFI_SCHEME_CODE', value: normalizedSchemeCode },
      ...isins.map(isin => ({ source: 'ISIN', value: isin })),
    ],
  };
}

export function buildUpstoxInstrumentIdentity(instrumentKey) {
  const normalizedKey = clean(instrumentKey);
  if (!normalizedKey || normalizedKey.length > 200) {
    throw new TypeError('Upstox instrument key is required and must be at most 200 characters.');
  }
  return {
    canonicalProductId: `market:upstox:${normalizedKey}`,
    externalIds: [{ source: 'UPSTOX_INSTRUMENT_KEY', value: normalizedKey }],
  };
}
