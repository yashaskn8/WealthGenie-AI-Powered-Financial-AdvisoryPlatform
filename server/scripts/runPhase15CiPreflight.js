import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { financialProfileCompletionSchema } from '../validation/financialSchemas.js';
import { registerSchema } from '../validation/schemas.js';
import { taxCalculationContextSchema } from '../validation/taxSchemas.js';
import { getCurrentFiscalYear } from '../services/taxEngine.js';
import { verifyBuildProvenance } from '../services/buildProvenance.js';
import { isSafeDemoEnvironmentId } from '../services/demoDatabaseIdentity.js';
import { isSafeDemoUrl, readLocalBuildIdentity, runDemoPreflight } from './demoPreflight.js';
import { runDemoDoctor } from './demoDoctor.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(SERVER_DIR, '..');
const CI_DATABASE = 'wealthgenie-ci-demo';
const CI_MONGO_HOST = 'wealthgenie-mongodb.wealthgenie.svc.cluster.local';
const CI_MONGO_PORT = '27017';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;

function localUrl(value, { api = false } = {}) {
  if (!isSafeDemoUrl(value, { api })) return null;
  try {
    const url = new URL(value);
    return url.hostname === '127.0.0.1' ? url : null;
  } catch {
    return null;
  }
}

export function validatePhase15CiEnvironment(environment) {
  const errors = [];
  const api = localUrl(environment.DEMO_API_BASE_URL, { api: true });
  const frontend = localUrl(environment.DEMO_FRONTEND_URL);
  const backendHealth = localUrl(environment.DEMO_BACKEND_HEALTH_URL);
  if (environment.GITHUB_ACTIONS !== 'true' || environment.CI !== 'true') errors.push('GitHub Actions CI runtime is not explicit');
  if (!SHA40.test(environment.GITHUB_SHA || '') || environment.DEMO_EXPECTED_BUILD_SHA !== environment.GITHUB_SHA) {
    errors.push('expected build SHA does not match the exact workflow SHA');
  }
  if (!SHA40.test(environment.DEMO_EXPECTED_BUILD_TREE_SHA || '')) errors.push('expected Git tree SHA is missing or malformed');
  if (!SHA64.test(environment.DEMO_EXPECTED_BUILD_PROVENANCE_SHA256 || '')) errors.push('expected build provenance SHA-256 is missing or malformed');
  if (!SHA64.test(environment.DEMO_EXPECTED_FRONTEND_ARTIFACT_SET_SHA256 || '')) errors.push('expected frontend artifact-set SHA-256 is missing or malformed');
  for (const [name, value] of [
    ['server', environment.EXPECTED_SERVER_IMAGE_ID],
    ['frontend', environment.EXPECTED_FRONTEND_IMAGE_ID],
    ['ML service', environment.EXPECTED_ML_IMAGE_ID],
  ]) {
    if (!IMAGE_ID.test(value || '')) errors.push(`expected ${name} image identity is missing or malformed`);
  }
  if (!/^[1-9]\d*$/.test(environment.GITHUB_RUN_ID || '')) errors.push('workflow run ID is missing or malformed');
  if (!/^[1-9]\d*$/.test(environment.GITHUB_RUN_ATTEMPT || '')) errors.push('workflow run attempt is missing or malformed');
  if (environment.DEMO_EXPECTED_MONGODB_DATABASE !== CI_DATABASE) errors.push('Mongo database is not the dedicated CI demo database');
  if (environment.DEMO_EXPECTED_MONGODB_HOST !== CI_MONGO_HOST) errors.push('Mongo host is not the in-cluster CI Mongo service');
  if (String(environment.DEMO_EXPECTED_MONGODB_PORT) !== CI_MONGO_PORT) errors.push('Mongo port is not the expected in-cluster port');
  if (!isSafeDemoEnvironmentId(environment.DEMO_EXPECTED_MONGODB_ENVIRONMENT_ID)) errors.push('Mongo environment sentinel ID is not a UUIDv4');
  if (!api || api.pathname.replace(/\/+$/, '') !== '/api') errors.push('demo API URL must be the loopback frontend proxy ending in /api');
  if (!frontend || frontend.pathname !== '/') errors.push('demo frontend URL must be a loopback origin');
  if (!backendHealth || backendHealth.pathname !== '/') errors.push('backend health URL must be a loopback origin');
  if (api && frontend && api.origin !== frontend.origin) errors.push('frontend and browser API must share the same loopback origin');
  if (api && api.protocol !== 'https:') errors.push('browser API origin must use trusted loopback HTTPS');
  if (frontend && frontend.protocol !== 'https:') errors.push('frontend origin must use trusted loopback HTTPS');
  if (frontend && frontend.port !== '8443') errors.push('frontend port is not the scoped CI TLS proxy');
  if (backendHealth && backendHealth.port !== '5000') errors.push('backend health port is not the scoped CI port-forward');
  if (environment.DEMO_TRUSTED_REMOTE_ORIGINS) errors.push('remote demo origins are forbidden in the isolated CI preflight');
  return { valid: errors.length === 0, errors };
}

export function createPhase15CiIdentity() {
  const id = randomUUID();
  const email = `phase15-${id}@example.com`;
  const password = `P15-${randomBytes(24).toString('base64url')}aZ7!`;
  const mobile = `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
  return { email, password, mobile };
}

export function createPhase15CiFixtures() {
  return {
    profile: {
      monthly_take_home: 500000,
      monthly_savings: 150000,
      age: 31,
      risk_tolerance: 'Moderate',
      liquid_savings: 500000,
      emi_burden_pct: 0,
      financial_dependents: 4,
      emergency_fund_months: 3,
      has_lump_sum: false,
      lump_sum_amount: 0,
      investment_goals: ['Wealth Growth', 'Emergency Fund'],
      investment_horizon_years: 20,
    },
    tax: {
      annualGrossIncome: 7500000,
      incomeSource: 'salary',
      regime: 'new',
      fiscalYear: getCurrentFiscalYear(),
      userAge: 31,
      holdingPeriodMonths: 18,
      section112AExemptionUsed: 0,
      sttConditionAssumedSatisfied: true,
      illustrativePrincipal: 1000000,
    },
  };
}

async function verifyExactCiBuild(environment) {
  const source = await readLocalBuildIdentity();
  if (source.clean !== true || source.sha !== environment.GITHUB_SHA) return false;
  let treeSha;
  try {
    treeSha = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return false;
  }
  if (treeSha !== environment.DEMO_EXPECTED_BUILD_TREE_SHA) return false;
  try {
    const manifest = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'build', 'provenance.json'), 'utf8'));
    return verifyBuildProvenance(manifest, {
      gitCommitSha: environment.GITHUB_SHA,
      gitTreeSha: treeSha,
      provenanceSha256: environment.DEMO_EXPECTED_BUILD_PROVENANCE_SHA256,
      frontendArtifactSetSha256: environment.DEMO_EXPECTED_FRONTEND_ARTIFACT_SET_SHA256,
      serverImageIdentity: environment.EXPECTED_SERVER_IMAGE_ID,
      frontendImageIdentity: environment.EXPECTED_FRONTEND_IMAGE_ID,
      mlImageIdentity: environment.EXPECTED_ML_IMAGE_ID,
      workflowRunId: environment.GITHUB_RUN_ID,
      workflowRunAttempt: environment.GITHUB_RUN_ATTEMPT,
    }).valid;
  } catch {
    return false;
  }
}

async function registerSyntheticAccount(apiBase, identity, fetcher = globalThis.fetch) {
  const response = await fetcher(`${apiBase}/auth/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      name: 'WealthGenie Phase 15 CI Tester',
      email: identity.email,
      password: identity.password,
      mobile: identity.mobile,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel().catch(() => {});
  return response.status === 201
    ? { passed: true, detail: 'one disposable synthetic account was created through the authenticated application registration route' }
    : { passed: false, detail: `synthetic account registration returned HTTP ${response.status}` };
}

/**
 * CI-only live runner. It proves the exact build and database through the
 * read-only doctor before creating a synthetic account or running the real
 * authenticated browser preflight.
 */
export async function runPhase15CiPreflight({
  environment = process.env,
  write = line => process.stdout.write(`${line}\n`),
  dependencies = {},
} = {}) {
  const configuration = validatePhase15CiEnvironment(environment);
  if (!configuration.valid) {
    write(`FAIL Phase 15 CI safety configuration — ${configuration.errors.join('; ')}`);
    return { exitCode: 1, doctor: null, preflight: null, registration: null };
  }
  const sourceVerified = await (dependencies.verifyBuild || verifyExactCiBuild)(environment);
  if (!sourceVerified) {
    write('FAIL Phase 15 CI source/provenance binding — checked-out SHA, tree, manifest, image identities, or workflow run did not match the build outputs');
    return { exitCode: 1, doctor: null, preflight: null, registration: null };
  }
  write('PASS Phase 15 CI source/provenance binding — exact clean source, manifest, image identities, and workflow run match');

  const identity = createPhase15CiIdentity();
  (dependencies.maskSecret || (value => process.stdout.write(`::add-mask::${value}\n`)))(identity.email);
  (dependencies.maskSecret || (value => process.stdout.write(`::add-mask::${value}\n`)))(identity.password);
  (dependencies.maskSecret || (value => process.stdout.write(`::add-mask::${value}\n`)))(identity.mobile);

  const fixtures = createPhase15CiFixtures();
  const profileValidation = financialProfileCompletionSchema.validate(fixtures.profile, { abortEarly: false, convert: false, stripUnknown: false });
  const taxValidation = taxCalculationContextSchema.validate(fixtures.tax, { abortEarly: false, convert: false, stripUnknown: false });
  const accountValidation = registerSchema.validate({
    name: 'WealthGenie Phase 15 CI Tester',
    email: identity.email,
    password: identity.password,
    mobile: identity.mobile,
  }, { abortEarly: false, convert: false, stripUnknown: false });
  if (profileValidation.error || taxValidation.error || accountValidation.error) {
    write('FAIL Phase 15 synthetic fixture validation — generated CI fixture or registration identity did not satisfy the current strict schema');
    return { exitCode: 1, doctor: null, preflight: null, registration: null };
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wealthgenie-phase15-ci-'));
  const liveEnvironment = {
    ...environment,
    DEMO_LIVE_PREFLIGHT: '1',
    DEMO_PROFILE_COMPLETION_FILE: path.join(temporaryDirectory, 'profile-completion.json'),
    DEMO_TAX_CONTEXT_FILE: path.join(temporaryDirectory, 'tax-context.json'),
    DEMO_COMPLETION_IDEMPOTENCY_KEY: `phase15-${randomUUID()}`,
    DEMO_NIFTY_ETF_PARENT_ID: 'nifty_etf',
    DEMO_EMAIL: identity.email,
    DEMO_PASSWORD: identity.password,
  };
  try {
    await Promise.all([
      writeFile(liveEnvironment.DEMO_PROFILE_COMPLETION_FILE, `${JSON.stringify(fixtures.profile)}\n`, { flag: 'wx', mode: 0o600 }),
      writeFile(liveEnvironment.DEMO_TAX_CONTEXT_FILE, `${JSON.stringify(fixtures.tax)}\n`, { flag: 'wx', mode: 0o600 }),
    ]);

    const doctor = await (dependencies.runDoctor || runDemoDoctor)({ environment: liveEnvironment, write });
    if (doctor?.exitCode !== 0) {
      write('FAIL Phase 15 CI pre-mutation doctor — registration and authenticated browser operations were not attempted');
      return { exitCode: 1, doctor, preflight: null, registration: null };
    }

    const registration = await (dependencies.registerAccount || registerSyntheticAccount)(
      liveEnvironment.DEMO_API_BASE_URL,
      identity,
      dependencies.fetcher,
    ).catch(() => ({ passed: false, detail: 'synthetic account registration did not receive a safe successful response' }));
    write(`${registration.passed ? 'PASS' : 'FAIL'} Phase 15 synthetic registration — ${registration.detail}`);
    if (registration.passed !== true) return { exitCode: 1, doctor, preflight: null, registration };

    const preflight = await (dependencies.runPreflight || runDemoPreflight)({ environment: liveEnvironment, write });
    return {
      exitCode: preflight?.exitCode === 0 && preflight.passed === 23 && preflight.failed === 0 && preflight.notEvaluated === 0 ? 0 : 1,
      doctor,
      preflight,
      registration,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runPhase15CiPreflight();
  process.exitCode = result.exitCode;
}
