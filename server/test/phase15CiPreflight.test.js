import test from 'node:test';
import assert from 'node:assert/strict';
import { financialProfileCompletionSchema } from '../validation/financialSchemas.js';
import { registerSchema } from '../validation/schemas.js';
import { taxCalculationContextSchema } from '../validation/taxSchemas.js';
import { runPipeline } from '../services/RecommendationPipeline.js';
import {
  createPhase15CiFixtures,
  createPhase15CiIdentity,
  runPhase15CiPreflight,
  validatePhase15CiEnvironment,
} from '../scripts/runPhase15CiPreflight.js';

function validEnvironment() {
  return {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '123456',
    GITHUB_RUN_ATTEMPT: '1',
    DEMO_EXPECTED_BUILD_SHA: 'a'.repeat(40),
    DEMO_EXPECTED_BUILD_TREE_SHA: 'b'.repeat(40),
    DEMO_EXPECTED_BUILD_PROVENANCE_SHA256: 'c'.repeat(64),
    DEMO_EXPECTED_FRONTEND_ARTIFACT_SET_SHA256: 'd'.repeat(64),
    EXPECTED_SERVER_IMAGE_ID: `sha256:${'e'.repeat(64)}`,
    EXPECTED_FRONTEND_IMAGE_ID: `sha256:${'f'.repeat(64)}`,
    EXPECTED_ML_IMAGE_ID: `sha256:${'1'.repeat(64)}`,
    DEMO_EXPECTED_MONGODB_DATABASE: 'wealthgenie-ci-demo',
    DEMO_EXPECTED_MONGODB_HOST: 'wealthgenie-mongodb.wealthgenie.svc.cluster.local',
    DEMO_EXPECTED_MONGODB_PORT: '27017',
    DEMO_EXPECTED_MONGODB_ENVIRONMENT_ID: '11111111-1111-4111-8111-111111111111',
    DEMO_API_BASE_URL: 'https://127.0.0.1:8443/api',
    DEMO_BACKEND_HEALTH_URL: 'http://127.0.0.1:5000',
    DEMO_FRONTEND_URL: 'https://127.0.0.1:8443',
    NODE_ENV: 'production',
    MARKET_DATA_PRIMARY_PROVIDER: 'NSE',
  };
}

test('CI profile and tax fixtures use strict live schemas and the current deterministic recommendation can open exact Nifty ETF WTI', () => {
  const fixtures = createPhase15CiFixtures();
  assert.equal(financialProfileCompletionSchema.validate(fixtures.profile, { convert: false, stripUnknown: false }).error, undefined);
  assert.equal(taxCalculationContextSchema.validate(fixtures.tax, { convert: false, stripUnknown: false }).error, undefined);
  const recommendation = runPipeline(fixtures.profile);
  assert.equal(recommendation.instruments.some(instrument => instrument.id === 'nifty_etf'), true);
});

test('synthetic CI registration identity meets the real registration schema without sending phone verification', () => {
  const identity = createPhase15CiIdentity();
  assert.match(identity.email, /^phase15-[0-9a-f-]+@example\.com$/);
  assert.match(identity.mobile, /^9\d{9}$/);
  assert.equal(registerSchema.validate({
    name: 'WealthGenie Phase 15 CI Tester',
    ...identity,
  }, { abortEarly: false, convert: false, stripUnknown: false }).error, undefined);
});

test('CI safety validation rejects the default database and untrusted or split browser API origins', () => {
  const environment = validEnvironment();
  assert.equal(validatePhase15CiEnvironment(environment).valid, true);
  assert.equal(validatePhase15CiEnvironment({ ...environment, GITHUB_RUN_ID: '' }).valid, false);
  assert.equal(validatePhase15CiEnvironment({ ...environment, GITHUB_RUN_ATTEMPT: '' }).valid, false);
  assert.equal(validatePhase15CiEnvironment({
    ...environment,
    DEMO_API_BASE_URL: 'http://127.0.0.1:8443/api',
    DEMO_FRONTEND_URL: 'http://127.0.0.1:8443',
  }).valid, false);
  assert.equal(validatePhase15CiEnvironment({ ...environment, DEMO_EXPECTED_MONGODB_DATABASE: 'wealthgenie' }).valid, false);
  assert.equal(validatePhase15CiEnvironment({ ...environment, DEMO_BACKEND_HEALTH_URL: 'https://external.example' }).valid, false);
  assert.equal(validatePhase15CiEnvironment({ ...environment, DEMO_API_BASE_URL: 'https://127.0.0.1:5000/api', DEMO_FRONTEND_URL: 'https://127.0.0.1:5000' }).valid, false);
});

test('failed read-only doctor prevents CI registration and authenticated preflight', async () => {
  let registrations = 0;
  let preflights = 0;
  const result = await runPhase15CiPreflight({
    environment: validEnvironment(),
    write: () => {},
    dependencies: {
      async verifyBuild() { return true; },
      maskSecret() {},
      async runDoctor() { return { exitCode: 1, passed: 0, failed: 1 }; },
      async registerAccount() { registrations += 1; return { passed: true, detail: 'unexpected' }; },
      async runPreflight() { preflights += 1; return { exitCode: 0, passed: 23, failed: 0, notEvaluated: 0 }; },
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(registrations, 0);
  assert.equal(preflights, 0);
});

test('CI runner rejects an incomplete live preflight even if registration succeeds', async () => {
  const result = await runPhase15CiPreflight({
    environment: validEnvironment(),
    write: () => {},
    dependencies: {
      async verifyBuild() { return true; },
      maskSecret() {},
      async runDoctor() { return { exitCode: 0, passed: 1, failed: 0 }; },
      async registerAccount(_apiBase, identity) {
        assert.equal(registerSchema.validate({ name: 'WealthGenie Phase 15 CI Tester', ...identity }, { convert: false }).error, undefined);
        return { passed: true, detail: 'synthetic account registration returned HTTP 201' };
      },
      async runPreflight() { return { exitCode: 1, passed: 22, failed: 1, notEvaluated: 0 }; },
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.preflight.passed, 22);
});
