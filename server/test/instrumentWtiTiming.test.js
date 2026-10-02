import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWtiTiming } from '../routes/instruments.js';

test('WTI timing logger projects only bounded allowlisted diagnostic fields', () => {
  const result = sanitizeWtiTiming({
    stage: 'tax_enrichment',
    elapsedMs: 12.4,
    status: 'ERROR',
    code: 'ECONNRESET',
    provider: 'AMFI',
    profileId: 'sensitive-profile-id',
    cookie: 'session-cookie-secret',
    csrf: 'csrf-secret',
    authorization: 'Bearer private-token',
    taxPayload: { income: 999999 },
    url: 'https://provider.invalid/?api_key=private-secret',
    mongoUri: 'mongodb+srv://private',
  });

  assert.deepEqual(result, {
    stage: 'tax_enrichment',
    elapsedMs: 12,
    status: 'ERROR',
    code: 'ECONNRESET',
    provider: 'AMFI',
  });
});

test('WTI timing logger rejects unknown stages and neutralizes uncontrolled status/code values', () => {
  assert.equal(sanitizeWtiTiming({ stage: 'secret-stage', elapsedMs: 10, status: 'COMPLETED' }), null);
  assert.equal(sanitizeWtiTiming({ stage: 'tax_enrichment', elapsedMs: -1, status: 'COMPLETED' }), null);
  assert.equal(sanitizeWtiTiming({ stage: 'tax_enrichment', elapsedMs: Infinity, status: 'COMPLETED' }), null);
  assert.deepEqual(sanitizeWtiTiming({
    stage: 'tax_enrichment',
    elapsedMs: 10,
    status: 'SECRET_ACCESS_TOKEN',
    code: { value: 'object-code' },
    provider: 'untrusted-provider',
    extra: 'must not be logged',
  }), {
    stage: 'tax_enrichment',
    elapsedMs: 10,
    status: 'UNKNOWN',
  });
});
