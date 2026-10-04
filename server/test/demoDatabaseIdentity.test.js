import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeDemoEnvironmentId,
  isSafeDemoDatabasePort,
  normalizeDemoDatabasePort,
  verifyDemoDatabaseIdentity,
  verifyDemoEnvironmentSentinel,
} from '../services/demoDatabaseIdentity.js';

const ENVIRONMENT_ID = '11111111-1111-4111-8111-111111111111';
const SENTINEL = {
  _id: 'wealthgenie-phase15-demo',
  environmentId: ENVIRONMENT_ID,
  purpose: 'WEALTHGENIE_PHASE15_DEMO',
  schemaVersion: 1,
};

function databaseReturning(value, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    database: {
      collection(name) {
        return {
          async findOne(filter) {
            calls.push({ name, filter });
            if (fail) throw new Error('database failure');
            return value;
          },
        };
      },
    },
  };
}

test('demo environment identifier accepts only UUIDv4 values', () => {
  assert.equal(isSafeDemoEnvironmentId(ENVIRONMENT_ID), true);
  assert.equal(isSafeDemoEnvironmentId(ENVIRONMENT_ID.toUpperCase()), true);
  assert.equal(isSafeDemoEnvironmentId('11111111-1111-1111-8111-111111111111'), false);
  assert.equal(isSafeDemoEnvironmentId('not-a-uuid'), false);
  assert.equal(isSafeDemoEnvironmentId(undefined), false);
});

test('demo database port accepts only canonical valid TCP ports', () => {
  assert.equal(normalizeDemoDatabasePort('27017'), 27017);
  assert.equal(normalizeDemoDatabasePort(27017), 27017);
  for (const value of ['', undefined, null, '027017', '27017junk', '0', 0, 65536, 2.5]) {
    assert.equal(isSafeDemoDatabasePort(value), false, `unexpectedly accepted ${String(value)}`);
  }
});

test('demo database identity requires exact actual/configured/requested host, database, and port', () => {
  const identity = {
    actual: 'wealthgenie_demo',
    configuredExpected: 'wealthgenie_demo',
    requestedExpected: 'wealthgenie_demo',
    actualHost: 'cluster.demo.example',
    configuredExpectedHost: 'cluster.demo.example',
    requestedExpectedHost: 'cluster.demo.example',
    actualPort: 27017,
    configuredExpectedPort: '27017',
    requestedExpectedPort: '27017',
  };
  assert.equal(verifyDemoDatabaseIdentity(identity), true);
  assert.equal(verifyDemoDatabaseIdentity({ ...identity, actualPort: 27018 }), false);
  assert.equal(verifyDemoDatabaseIdentity({ ...identity, requestedExpectedPort: '27018' }), false);
  assert.equal(verifyDemoDatabaseIdentity({ ...identity, actualPort: undefined }), false);
  assert.equal(verifyDemoDatabaseIdentity({ ...identity, configuredExpectedPort: undefined }), false);
});

test('demo environment sentinel is verified by an exact read-only document match', async () => {
  const fixture = databaseReturning(SENTINEL);
  assert.equal(await verifyDemoEnvironmentSentinel({ database: fixture.database, expectedEnvironmentId: ENVIRONMENT_ID }), true);
  assert.deepEqual(fixture.calls, [{
    name: 'demo_environment_sentinels',
    filter: { _id: 'wealthgenie-phase15-demo' },
  }]);
});

test('demo environment sentinel fails closed for absent, mismatched, malformed, extended, or unreadable state', async t => {
  const cases = [
    ['missing marker', null],
    ['different environment ID', { ...SENTINEL, environmentId: '22222222-2222-4222-8222-222222222222' }],
    ['wrong purpose', { ...SENTINEL, purpose: 'OTHER' }],
    ['wrong schema version', { ...SENTINEL, schemaVersion: 2 }],
    ['unexpected fields', { ...SENTINEL, createdAt: '2026-10-04T00:00:00.000Z' }],
  ];
  for (const [label, document] of cases) {
    await t.test(label, async () => {
      const fixture = databaseReturning(document);
      assert.equal(await verifyDemoEnvironmentSentinel({ database: fixture.database, expectedEnvironmentId: ENVIRONMENT_ID }), false);
    });
  }

  const invalidExpected = databaseReturning(SENTINEL);
  assert.equal(await verifyDemoEnvironmentSentinel({ database: invalidExpected.database, expectedEnvironmentId: 'not-a-uuid' }), false);
  assert.deepEqual(invalidExpected.calls, [], 'invalid configuration must not query Mongo');

  const unavailable = databaseReturning(SENTINEL, { fail: true });
  assert.equal(await verifyDemoEnvironmentSentinel({ database: unavailable.database, expectedEnvironmentId: ENVIRONMENT_ID }), false);
});
