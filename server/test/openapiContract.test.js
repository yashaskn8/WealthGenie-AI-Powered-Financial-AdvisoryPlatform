import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

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
      'sold_property_proceeds', 'has_lump_sum', 'lump_sum_amount',
      'liquid_savings', 'emi_burden_pct', 'financial_dependents',
      'emergency_fund_months', 'investment_goals', 'investment_horizon_years',
    ]],
    ['POST /api/recommend', ['profileId']],
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
  assert.equal(operations.get('POST /api/profile/build')['x-idempotency-key'], 'optional');
  assert.equal(operations.get('POST /api/goals/create')['x-idempotency-key'], 'optional');
});
