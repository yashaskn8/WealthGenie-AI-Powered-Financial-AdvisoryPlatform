import test from 'node:test';
import assert from 'node:assert/strict';
import { financialProfileCompletionSchema } from '../validation/financialSchemas.js';
import { registerSchema } from '../validation/schemas.js';
import { taxCalculationContextSchema } from '../validation/taxSchemas.js';
import { runPipeline } from '../services/RecommendationPipeline.js';
import {
  createPhase15CiFixtures,
  createPhase15CiIdentity,
  formatSafePhase15CiError,
  runPhase15CiPreflight,
  validatePhase15CiEnvironment,
  verifyExactCiBuild,
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

test('exact CI build verifier identifies dirty source and commit binding mismatches without exposing values', async () => {
  const environment = validEnvironment();
  const result = await verifyExactCiBuild(environment, {
    async readSourceIdentity() { return { clean: false, sha: 'f'.repeat(40) }; },
    async readTreeIdentity() { return environment.DEMO_EXPECTED_BUILD_TREE_SHA; },
    async readManifest() { return JSON.stringify({}); },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('SOURCE_TREE_NOT_CLEAN'));
  assert.ok(result.errors.includes('CHECKED_OUT_COMMIT_MISMATCH'));
  assert.equal(JSON.stringify(result).includes('f'.repeat(40)), false);
});

test('Phase 15 runner logs exact safe build-binding failure codes before any account mutation', async () => {
  const environment = validEnvironment();
  const output = [];
  let registrationCalls = 0;
  const result = await runPhase15CiPreflight({
    environment,
    write: line => output.push(line),
    dependencies: {
      async verifyBuild() {
        return verifyExactCiBuild(environment, {
          async readSourceIdentity() { return { clean: false, sha: 'f'.repeat(40) }; },
          async readTreeIdentity() { return environment.DEMO_EXPECTED_BUILD_TREE_SHA; },
          async readManifest() { return JSON.stringify({}); },
        });
      },
      async registerAccount() { registrationCalls += 1; return { passed: true }; },
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(output.join('\n'), /SOURCE_TREE_NOT_CLEAN, CHECKED_OUT_COMMIT_MISMATCH/);
  assert.equal(registrationCalls, 0);
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

test('Phase 15 runner reports a safe pre-mutation doctor exception and never registers after it throws', async () => {
  const output = [];
  let registrationCalls = 0;
  let generatedIdentity;
  const result = await runPhase15CiPreflight({
    environment: validEnvironment(),
    write: line => output.push(line),
    dependencies: {
      async verifyBuild() { return true; },
      maskSecret() {},
      async runDoctor({ environment }) {
        generatedIdentity = [environment.DEMO_EMAIL, environment.DEMO_PASSWORD];
        const error = new Error(`connection to ${environment.DEMO_EMAIL} failed with ${environment.DEMO_PASSWORD}`);
        error.code = 'ECONNRESET';
        throw error;
      },
      async registerAccount() { registrationCalls += 1; return { passed: true }; },
      async runPreflight() { assert.fail('preflight must not run when the read-only doctor throws'); },
    },
  });

  const report = output.join('\n');
  assert.equal(result.exitCode, 1);
  assert.equal(result.doctor.failed, 1);
  assert.equal(result.registration, null);
  assert.equal(registrationCalls, 0);
  assert.match(report, /pre-mutation doctor threw/);
  assert.match(report, /ECONNRESET/);
  for (const value of generatedIdentity) assert.equal(report.includes(value), false);
});

test('Phase 15 runner reports a safe live-preflight exception without treating it as a pass', async () => {
  const output = [];
  let generatedIdentity;
  let preflightCalls = 0;
  const result = await runPhase15CiPreflight({
    environment: validEnvironment(),
    write: line => output.push(line),
    dependencies: {
      async verifyBuild() { return true; },
      maskSecret() {},
      async runDoctor() { return { exitCode: 0, passed: 1, failed: 0 }; },
      async registerAccount(_apiBase, identity) {
        generatedIdentity = [identity.email, identity.password];
        return { passed: true, detail: 'synthetic account registration returned HTTP 201' };
      },
      async runPreflight({ environment }) {
        preflightCalls += 1;
        const error = new Error(`browser request failed for ${environment.DEMO_EMAIL} with ${environment.DEMO_PASSWORD}`);
        error.code = 'ETIMEDOUT';
        throw error;
      },
    },
  });

  const report = output.join('\n');
  assert.equal(result.exitCode, 1);
  assert.equal(result.preflight, null);
  assert.equal(result.registration.passed, true);
  assert.equal(preflightCalls, 1);
  assert.match(report, /live preflight execution threw/);
  assert.match(report, /ETIMEDOUT/);
  for (const value of generatedIdentity) assert.equal(report.includes(value), false);
});

test('safe Phase 15 error formatter retains classification and code while redacting environment secrets', () => {
  const error = new TypeError('request failed with sensitive-fixture-value');
  error.code = 'ECONNRESET';
  const formatted = formatSafePhase15CiError(error, { NVIDIA_API_KEY: 'sensitive-fixture-value' });
  assert.match(formatted, /TypeError/);
  assert.match(formatted, /ECONNRESET/);
  assert.match(formatted, /request failed/);
  assert.equal(formatted.includes('sensitive-fixture-value'), false);
});
