import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import express from 'express';
import jwt from 'jsonwebtoken';
import taxRoutes from '../routes/tax.js';
import instrumentRoutes from '../routes/instruments.js';
import chatRoutes from '../routes/chatRoutes.js';
import recommendRoutes from '../routes/recommend.js';
import marketRoutes from '../routes/market.js';
import agentRoutes from '../routes/agentRoutes.js';
import { errorHandler, sendError } from '../middleware/errorHandler.js';
import Instrument from '../models/Instrument.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(serverRoot, 'app.js'), 'utf8');
const contract = parse(fs.readFileSync(path.join(serverRoot, 'openapi.yaml'), 'utf8'));
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// Only externally supported route modules belong in the public contract.
// metricsRoutes and mcpRoutes are deliberately private operational protocols.
const publicMounts = [
  ['auth.js', '/api/auth'],
  ['profile.js', '/api/profile'],
  ['recommend.js', '/api/recommend'],
  ['agentRoutes.js', '/api/agent'],
  ['instruments.js', '/api/instruments'],
  ['projection.js', '/api/projection'],
  ['montecarlo.js', '/api/montecarlo'],
  ['goals.js', '/api/goals'],
  ['market.js', '/api/market'],
  ['tax.js', '/api/tax'],
  ['chatRoutes.js', '/api/chat'],
  ['portfolio.js', '/api/portfolio'],
  ['regime.js', '/api/regime'],
  ['health.js', '/health'],
];

function normalizePath(value) {
  const normalized = value.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/+$/, '');
  return normalized || '/';
}

function extractRoutes(source, receiver, prefix = '') {
  const pattern = new RegExp(`${receiver}\\s*\\.\\s*(get|post|put|patch|delete)\\s*\\(\\s*['\"]([^'\"]+)['\"]`, 'g');
  const matches = [...source.matchAll(pattern)];
  return matches.map((match, index) => {
    const end = matches[index + 1]?.index ?? source.length;
    const declaration = source.slice(match.index, end);
    return {
      method: match[1].toLowerCase(),
      path: normalizePath(`${prefix}${match[2] === '/' ? '' : match[2]}`),
      // Authentication middleware appears in the route's argument preamble.
      // Limit the scan so a later route cannot make a long handler look protected.
      authenticated: /\bverifyJWT\b/.test(declaration.slice(0, 300)),
    };
  });
}

function operationKey({ method, path: routePath }) {
  return `${method.toUpperCase()} ${routePath}`;
}

function contractOperations() {
  const operations = [];
  for (const [routePath, pathItem] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (HTTP_METHODS.has(method)) operations.push({ method, path: routePath, operation });
    }
  }
  return operations;
}

function resolveLocalRef(ref) {
  assert.match(ref, /^#\//, `Only local OpenAPI references are supported: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => value[key], contract);
}

function inlineLocalRefs(value, activeRefs = new Set()) {
  if (Array.isArray(value)) return value.map(item => inlineLocalRefs(item, activeRefs));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string') {
    assert.equal(value.$ref.startsWith('#/'), true, `Only local refs are supported: ${value.$ref}`);
    assert.equal(activeRefs.has(value.$ref), false, `Recursive response schema is not supported by this response validator: ${value.$ref}`);
    const nextRefs = new Set(activeRefs);
    nextRefs.add(value.$ref);
    return inlineLocalRefs(resolveLocalRef(value.$ref), nextRefs);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inlineLocalRefs(child, activeRefs)]));
}

const responseAjv = new Ajv2020({ allErrors: true, strict: false });
addFormats(responseAjv);

function assertRuntimeResponseMatchesContract({ method, path: routePath, status, contentType, body }) {
  const operation = contract.paths[routePath]?.[method.toLowerCase()];
  assert.ok(operation, `OpenAPI operation missing: ${method} ${routePath}`);
  const response = operation.responses[String(status)];
  assert.ok(response, `Undocumented runtime status ${status}: ${method} ${routePath}`);
  const resolvedResponse = inlineLocalRefs(response);
  const jsonMedia = resolvedResponse.content?.['application/json'];
  assert.ok(jsonMedia?.schema, `No application/json schema for ${method} ${routePath} ${status}`);
  assert.match(contentType || '', /^application\/json\b/i, `${method} ${routePath} did not return JSON`);
  const validateBody = responseAjv.compile(inlineLocalRefs(jsonMedia.schema));
  assert.equal(validateBody(body), true, `${method} ${routePath} ${status} violates OpenAPI: ${JSON.stringify(validateBody.errors)}`);
}

function assertResponseMatchesSchemaRef(schemaRef, body, context) {
  const validateBody = responseAjv.compile(inlineLocalRefs({ $ref: schemaRef }));
  assert.equal(validateBody(body), true, `${context} violates OpenAPI: ${JSON.stringify(validateBody.errors)}`);
}

function buildContractTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tax', taxRoutes);
  app.use('/api/instruments', instrumentRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/recommend', recommendRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/agent', agentRoutes);
  app.use((req, res) => sendError(req, res, 404, 'Route not found.', 'ROUTE_NOT_FOUND'));
  app.use(errorHandler);
  return app;
}

function requestSchema(operation) {
  let body = operation.requestBody;
  if (body?.$ref) body = resolveLocalRef(body.$ref);
  let schema = body?.content?.['application/json']?.schema;
  if (schema?.$ref) schema = resolveLocalRef(schema.$ref);
  return schema;
}

const sourceOperations = publicMounts.flatMap(([filename, prefix]) => {
  const moduleSource = fs.readFileSync(path.join(serverRoot, 'routes', filename), 'utf8');
  return extractRoutes(moduleSource, 'router', prefix);
}).concat(extractRoutes(appSource, 'app'));

test('canonical OpenAPI exactly matches intended public Express methods and paths', () => {
  for (const [filename, prefix] of publicMounts.filter(([name]) => name !== 'health.js')) {
    const importName = filename === 'chatRoutes.js' ? 'chatRoutes'
      : filename === 'metricsRoutes.js' ? 'metricsRoutes'
        : filename.replace(/\.js$/, '').replace('montecarlo', 'montecarlo') + 'Routes';
    assert.match(appSource, new RegExp(`app\\.use\\(['\"]${prefix.replaceAll('/', '\\/')}['\"]`), `${filename} mount changed without updating the contract inventory`);
    void importName;
  }

  const sourceKeys = new Set(sourceOperations.map(operationKey));
  const contractKeys = new Set(contractOperations().map(operationKey));
  assert.deepEqual([...contractKeys].sort(), [...sourceKeys].sort());
  assert.equal([...contractKeys].some((key) => key.includes('/api/metrics')), false);
  assert.equal([...contractKeys].some((key) => key.includes('/api/mcp')), false);
});

test('OpenAPI authentication and cookie-session CSRF metadata match Express routes', () => {
  const operations = new Map(contractOperations().map((entry) => [operationKey(entry), entry.operation]));
  for (const route of sourceOperations) {
    const operation = operations.get(operationKey(route));
    assert.ok(operation, `Missing ${operationKey(route)}`);
    const hasAuth = Array.isArray(operation.security) && operation.security.length > 0;
    assert.equal(hasAuth, route.authenticated, `${operationKey(route)} authentication drifted`);

    if (route.path.startsWith('/api/') && ['post', 'put', 'patch', 'delete'].includes(route.method)) {
      assert.equal(operation['x-csrf-protection'], 'cookie-session', `${operationKey(route)} must document cookie-session CSRF behavior`);
    }
  }
});

test('OpenAPI preserves major runtime-required request fields', () => {
  const expected = new Map([
    ['POST /api/auth/register', ['name', 'email', 'password']],
    ['POST /api/auth/login', ['email', 'password']],
    ['POST /api/profile/build', [
      'monthly_take_home', 'monthly_savings', 'age', 'risk_tolerance',
      'investment_goals', 'investment_horizon_years',
    ]],
    ['POST /api/recommend', ['profileId']],
    ['POST /api/projection/stress-test', ['profileId', 'instrumentId', 'principal']],
    ['POST /api/projection/allocation-split', ['monthlyInvestment', 'equityPct']],
    ['POST /api/goals/create', ['goal_name', 'target_amount', 'target_date', 'current_savings', 'profileId', 'priority']],
    ['POST /api/montecarlo/montecarlo', ['profileId', 'instrument', 'monthly_investment', 'years']],
    ['POST /api/portfolio/rebalance', [
      'profileId', 'current_allocation', 'target_allocation', 'threshold', 'partial_ratio', 'holding_months',
    ]],
    ['POST /api/chat/message', ['message']],
  ]);
  const operations = new Map(contractOperations().map((entry) => [operationKey(entry), entry.operation]));

  for (const [key, requiredFields] of expected) {
    const schema = requestSchema(operations.get(key));
    assert.ok(schema, `${key} has no JSON request schema`);
    assert.deepEqual(new Set(schema.required ?? []), new Set(requiredFields), `${key} required fields drifted`);
  }
});

test('advisory idempotency is required and profile/goal idempotency is documented', () => {
  const operations = new Map(contractOperations().map((entry) => [operationKey(entry), entry.operation]));
  assert.equal(operations.get('POST /api/recommend')['x-idempotency-key'], 'required');
  assert.equal(operations.get('POST /api/profile/build')['x-idempotency-key'], 'required');
  assert.equal(operations.get('POST /api/goals/create')['x-idempotency-key'], 'required');
  assert.equal(operations.get('POST /api/profile/build').responses['503'].$ref, '#/components/responses/Unavailable');
  assert.equal(operations.get('POST /api/goals/create').responses['503'].$ref, '#/components/responses/Unavailable');
});

test('goal-advice reconciliation contract distinguishes committed operation from current goal state', () => {
  const operation = contract.paths['/api/goals/{goalId}/refresh-advice'].patch;
  const response = resolveLocalRef(operation.responses['200'].$ref);
  const responseSchema = response.content['application/json'].schema;
  const schema = responseSchema.$ref ? resolveLocalRef(responseSchema.$ref) : responseSchema;
  assert.ok(schema.required.includes('operation_result'));
  assert.deepEqual(schema.properties.operation_result.required, ['committed', 'goal_version', 'response_state']);
  assert.ok(['CURRENT', 'STALE'].every(value => schema.properties.operation_result.properties.response_state.enum.includes(value)));
  assert.ok(operation.responses['503'], 'committed-but-unreconciled responses must be documented');
});

test('OpenAPI runtime contracts exercise real HTTP success and canonical error responses', async () => {
  const oldSecret = process.env.JWT_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  const oldFind = Instrument.find;
  const oldCountDocuments = Instrument.countDocuments;
  process.env.JWT_SECRET = 'openapi-runtime-contract-test-secret-at-least-32';
  process.env.NODE_ENV = 'test';
  Instrument.find = () => ({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [{
      id: 'catalog:fd:contract', name: 'Contract Bank Deposit', type: 'FD', interestRate: 6.5,
      internalPersistenceFlag: 'must-not-escape',
    }],
  });
  Instrument.countDocuments = async () => 1;

  try {
    await withServer(buildContractTestApp(), async baseUrl => {
      const userId = '65b000000000000000000001';
      const authToken = jwt.sign({ userId, jti: 'openapi-contract-jti' }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const authorization = { Authorization: `Bearer ${authToken}` };
      const cases = [
        {
          method: 'GET', path: '/api/tax/compare', url: '/api/tax/compare?income=1200000&incomeSource=salary&fiscalYear=FY2026-27&age=30', status: 200,
        },
        { method: 'GET', path: '/api/instruments', url: '/api/instruments?page=1&limit=10', status: 200 },
        { method: 'GET', path: '/api/tax/compare', url: '/api/tax/compare?income=bad&incomeSource=salary&fiscalYear=FY2026-27&age=30', status: 400 },
        { method: 'GET', path: '/api/tax/compare', url: '/api/tax/compare?income=1200000&incomeSource=salary&fiscalYear=FY2099-00&age=30', status: 422 },
        { method: 'GET', path: '/api/chat/history', url: '/api/chat/history', status: 401 },
        { method: 'GET', path: '/api/instruments', url: '/api/instruments?notAFilter=x', status: 400 },
      ];
      for (const item of cases) {
        const response = await rawRequest(`${baseUrl}${item.url}`, { method: item.method });
        assert.equal(response.status, item.status, `${item.method} ${item.url}`);
        assertRuntimeResponseMatchesContract({
          ...item,
          contentType: response.headers.get('content-type'),
          body: await response.json(),
        });
      }

      const authenticatedQueryCases = [
        { method: 'GET', path: '/api/recommend/audit', url: '/api/recommend/audit?profileId=garbage' },
        { method: 'GET', path: '/api/chat/history', url: '/api/chat/history?limit=20garbage' },
        { method: 'GET', path: '/api/agent/plan-health', url: '/api/agent/plan-health?profileId=garbage' },
      ];
      for (const item of authenticatedQueryCases) {
        const response = await rawRequest(`${baseUrl}${item.url}`, { method: item.method, headers: authorization });
        assert.equal(response.status, 400, `${item.method} ${item.url}`);
        assertRuntimeResponseMatchesContract({
          ...item,
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: await response.json(),
        });
      }

      const unknownMarketQuery = await rawRequest(`${baseUrl}/api/market/mutual-funds/nav?schemeCodes=1001&extra=unexpected`);
      assert.equal(unknownMarketQuery.status, 400);
      assertRuntimeResponseMatchesContract({
        method: 'GET', path: '/api/market/mutual-funds/nav', status: unknownMarketQuery.status,
        contentType: unknownMarketQuery.headers.get('content-type'), body: await unknownMarketQuery.json(),
      });

      const missingRoute = await rawRequest(`${baseUrl}/api/not-a-public-route`);
      assert.equal(missingRoute.status, 404);
      assert.match(missingRoute.headers.get('content-type') || '', /^application\/json\b/i);
      assertResponseMatchesSchemaRef(
        '#/components/schemas/Error',
        await missingRoute.json(),
        'Canonical 404 error envelope',
      );

      const priorFind = Instrument.find;
      Instrument.find = () => ({
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        lean: async () => [{ name: 'Broken catalog row', type: 'FD' }],
      });
      try {
        const unavailable = await rawRequest(`${baseUrl}/api/instruments`);
        assert.equal(unavailable.status, 503);
        assertRuntimeResponseMatchesContract({
          method: 'GET', path: '/api/instruments', status: unavailable.status,
          contentType: unavailable.headers.get('content-type'), body: await unavailable.json(),
        });
      } finally {
        Instrument.find = priorFind;
      }
    });
  } finally {
    Instrument.find = oldFind;
    Instrument.countDocuments = oldCountDocuments;
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }
});

test('deferred advisory success contract requires exact allocation provenance', () => {
  const operation = contractOperations().find(entry => operationKey(entry) === 'POST /api/recommend/{recommendationId}/advisory')?.operation;
  assert.ok(operation);
  const response = resolveLocalRef(operation.responses['200'].$ref);
  const schema = resolveLocalRef(response.content['application/json'].schema.$ref);
  assert.ok(['recommendationId', 'allocation_revision', 'allocation_revision_id', 'portfolio_fingerprint', 'advisory_text', 'advisory_explanation']
    .every(field => schema.required.includes(field)));
  const explanation = schema.properties.advisory_explanation;
  assert.ok(['recommendationId', 'allocation_revision', 'allocation_revision_id', 'portfolio_fingerprint']
    .every(field => explanation.required.includes(field)));
});

test('all authoritative recommendation mutations and reads require the canonical current-state schema', () => {
  const operations = new Map(contractOperations().map((entry) => [operationKey(entry), entry.operation]));
  const canonicalFields = [
    'recommendationId',
    'allocation_revision',
    'allocation_revision_id',
    'portfolio_fingerprint',
    'calculation_freshness',
    'state_provenance',
  ];
  for (const key of [
    'POST /api/recommend',
    'GET /api/recommend/current',
    'POST /api/recommend/weights',
  ]) {
    const responseRef = operations.get(key)?.responses?.['200']?.$ref;
    assert.ok(responseRef, `${key} must document its successful response`);
    const response = resolveLocalRef(responseRef);
    const schemaRef = response.content?.['application/json']?.schema?.$ref;
    assert.ok(schemaRef, `${key} must reference a response schema`);
    const schema = resolveLocalRef(schemaRef);
    assert.ok(canonicalFields.every(field => schema.required.includes(field)), `${key} must require the complete binding`);
    assert.equal(schema.properties.response_state.const, 'CURRENT');
  }
});

test('profile completion nests the same strict authoritative recommendation schema', () => {
  const response = resolveLocalRef(contract.paths['/api/profile/complete'].post.responses['200'].$ref);
  const schema = resolveLocalRef(response.content['application/json'].schema.$ref);
  const nestedRef = schema.properties.recommendation.$ref;
  assert.equal(nestedRef, '#/components/schemas/RecommendationResponse');
  const recommendation = resolveLocalRef(nestedRef);
  assert.ok([
    'recommendationId', 'allocation_revision', 'allocation_revision_id',
    'portfolio_fingerprint', 'calculation_freshness', 'state_provenance',
  ].every(field => recommendation.required.includes(field)));
});

test('committed superseded operations document their result separately from current financial state', () => {
  const recommendationOperation = contract.paths['/api/recommend'].post;
  assert.ok(recommendationOperation.responses['503'], 'post-commit reconciliation integrity failure uses a documented service-unavailable response');
  const recommendationResponse = resolveLocalRef('#/components/schemas/RecommendationResponse');
  assert.equal(recommendationResponse.properties.operation_result.$ref, '#/components/schemas/CommittedOperationResult');
  const completionResponse = resolveLocalRef('#/components/schemas/ProfileCompletion');
  assert.equal(completionResponse.properties.operation_result.$ref, '#/components/schemas/CommittedOperationResult');

  const operationResult = resolveLocalRef('#/components/schemas/CommittedOperationResult');
  assert.deepEqual(operationResult.required, ['committed', 'generated_recommendation_id', 'superseded_before_response']);
  assert.equal(operationResult.properties.committed.const, true);
  assert.equal(operationResult.properties.superseded_before_response.const, true);
});
