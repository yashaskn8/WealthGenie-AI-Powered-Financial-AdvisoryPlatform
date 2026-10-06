import assert from 'node:assert/strict';
import test from 'node:test';
import logger, { formatHttpAccessLog, morganStream, redactLogValue, sanitizeLoggerInfo } from '../utils/logger.js';

test('logger redaction fails closed for credential fields beyond the inspection depth', () => {
  const value = {};
  let cursor = value;
  for (let depth = 0; depth < 12; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.apiKey = 'deep-secret-sentinel';

  const redacted = redactLogValue(value);
  assert.equal(JSON.stringify(redacted).includes('deep-secret-sentinel'), false);
  assert.equal(cursor.apiKey, 'deep-secret-sentinel');
});
test('logger redacts credentials embedded in URL query strings and serialized messages', () => {
  const url = redactLogValue('request failed: https://example.invalid/?access_token=query-sentinel&ok=1');
  const serialized = redactLogValue('{"api_key":"json-sentinel","status":"failed"}');
  const serializedProfile = redactLogValue('{"email":"email-sentinel","pan":"pan-sentinel","monthly_take_home":987654,"risk_tolerance":"risk-sentinel"}');
  const mongoUri = redactLogValue('db=mongodb+srv://user:password-sentinel@cluster.example/db');
  const redisUri = redactLogValue('cache=rediss://user:redis-password-sentinel@cache.example:6379/0');
  const credentialUrl = redactLogValue('fetch https://user:http-password-sentinel@example.invalid/path');
  const bearer = redactLogValue('authorization: Bearer bearer-sentinel');
  const basic = redactLogValue('authorization: Basic YmFzaWMtc2VudGluZWw=');
  const signedUrl = redactLogValue('request https://example.invalid/file?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=presigned-signature-sentinel&ok=1');
  const signatureField = redactLogValue({ signatureMetadata: { signature: 'stored-signature-sentinel' } });
  const malformedSignedQuery = redactLogValue('https://example.invalid/file?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=credential-sentinel&X-Amz-Signature=signature-sentinel&X-Amz-Date=20261004T000000Z');

  for (const result of [url, serialized, serializedProfile, mongoUri, redisUri, credentialUrl, bearer, basic, signedUrl, JSON.stringify(signatureField)]) {
    assert.equal(result.includes('sentinel'), false, result);
  }
  assert.match(url, /ok=1/);
  assert.match(serialized, /status/);
  assert.match(serializedProfile, /\[REDACTED\]/);
  assert.match(signedUrl, /ok=1/);
  assert.equal(malformedSignedQuery, 'https://example.invalid/file?X-Amz-Algorithm=[REDACTED]&X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]&X-Amz-Date=[REDACTED]');
});

test('logger redacts numeric financial fields in nested structured objects', () => {
  const redacted = redactLogValue({
    userId: '64b000000000000000000010',
    profileId: '64b000000000000000000011',
    accountId: '64b000000000000000000012',
    profile: {
      monthly_take_home: 180000,
      salary: 2400000,
      monthlySavings: 32000,
      riskTolerance: 'HIGH',
      taxAmount: 120000,
      safeCounter: 2,
    },
  });
  assert.equal(redacted.userId, '[REDACTED]');
  assert.equal(redacted.profileId, '[REDACTED]');
  assert.equal(redacted.accountId, '[REDACTED]');
  assert.equal(redacted.profile.monthly_take_home, '[REDACTED]');
  assert.equal(redacted.profile.salary, '[REDACTED]');
  assert.equal(redacted.profile.monthlySavings, '[REDACTED]');
  assert.equal(redacted.profile.riskTolerance, '[REDACTED]');
  assert.equal(redacted.profile.taxAmount, '[REDACTED]');
  assert.equal(redacted.profile.safeCounter, 2);
});

test('logger redacts Aadhaar and unlabeled long account numbers in exception text', () => {
  const redacted = redactLogValue('Aadhaar 1234 5678 9012; account 123456789012; profile 64b000000000000000000010');
  assert.doesNotMatch(redacted, /1234 5678 9012|123456789012|64b000000000000000000010/);
});

test('logger redacts token identifiers and circular structures without changing safe fields', () => {
  const value = {
    request_id: 'req-safe',
    jti: 'jti-sentinel',
    accessToken: 'camel-token-sentinel',
    clientSecret: 'camel-secret-sentinel',
    details: { count: 2 },
  };
  value.details.parent = value;

  const redacted = redactLogValue(value);
  assert.equal(redacted.request_id, 'req-safe');
  assert.equal(redacted.jti, '[REDACTED]');
  assert.equal(redacted.accessToken, '[REDACTED]');
  assert.equal(redacted.clientSecret, '[REDACTED]');
  assert.equal(redacted.details.count, 2);
  assert.equal(redacted.details.parent, '[REDACTED:CIRCULAR]');
  assert.equal(JSON.stringify(redacted).includes('jti-sentinel'), false);
  assert.equal(JSON.stringify(redacted).includes('camel-token-sentinel'), false);
  assert.equal(JSON.stringify(redacted).includes('camel-secret-sentinel'), false);
  assert.doesNotMatch(redactLogValue('{"accessToken":"serialized-token-sentinel"}'), /serialized-token-sentinel/);
});

test('logger redacts secrets in Error message and native stack without exposing multiline credentials', () => {
  const error = new Error('provider failed; password: "first-line-secret\nsecond-line-secret"');
  const redacted = redactLogValue(error);
  assert.equal(redacted.message.includes('first-line-secret'), false);
  assert.equal(redacted.message.includes('second-line-secret'), false);
  assert.equal(typeof redacted.stack, 'string');
  assert.equal(redacted.stack.includes('first-line-secret'), false);
  assert.equal(redacted.stack.includes('second-line-secret'), false);

  let customGetterCalled = false;
  Object.defineProperty(error, 'stack', {
    configurable: true,
    get() {
      customGetterCalled = true;
      return 'password: "custom-stack-sentinel"';
    },
  });
  const customStack = redactLogValue(error);
  assert.equal(customGetterCalled, false);
  assert.equal(customStack.stack, undefined, 'custom stack accessors are never executed');
});

test('logger redacts nested Error causes and credentials in Redis and HTTPS URL userinfo', () => {
  const error = new Error('request failed', { cause: new Error('access_token: nested-cause-sentinel') });
  const redacted = redactLogValue(error);
  assert.equal(redacted.cause.message.includes('nested-cause-sentinel'), false);
  assert.match(redactLogValue('rediss://user:redis-sentinel@cache.invalid/0'), /\[REDACTED\]@/);
  assert.match(redactLogValue('https://user:http-sentinel@example.invalid/a'), /\[REDACTED\]@/);
  assert.doesNotMatch(JSON.stringify(redacted), /nested-cause-sentinel/);
});

test('Winston format sanitization prevents toJSON from reintroducing secrets', () => {
  const info = {
    level: 'info',
    message: 'toJSON redaction probe',
    safe: { toJSON: () => ({ apiKey: 'tojson-secret-sentinel' }) },
  };
  const safeInfo = sanitizeLoggerInfo(info);
  const output = JSON.stringify(safeInfo);
  assert.doesNotMatch(output, /tojson-secret-sentinel/);
});

test('actual Morgan stream omits PII query strings and includes request correlation', () => {
  const originalHttp = logger.http;
  let output = '';
  logger.http = message => { output = message; };
  try {
    const line = formatHttpAccessLog({
      method: 'GET',
      path: '/api/profile?email=pii-sentinel%40example.com&pan=pan-sentinel',
      status: '200',
      contentLength: '12',
      responseTime: '4.2',
      requestId: 'request-correlation-sentinel',
    });
    morganStream.write(`${line}\n`);
  } finally {
    logger.http = originalHttp;
  }
  assert.match(output, /request_id=request-correlation-sentinel/);
  assert.doesNotMatch(output, /pii-sentinel|pan-sentinel|email=/);
});
