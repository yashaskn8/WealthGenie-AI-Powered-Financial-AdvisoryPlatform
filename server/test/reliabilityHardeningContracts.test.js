import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sessionCookieOptions } from '../services/authSession.js';

const rootDir = fs.existsSync(path.join(process.cwd(), 'docker-compose.yml'))
  ? process.cwd()
  : path.resolve(process.cwd(), '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

test('market refresh is admin-only, rate limited, and uses the shared distributed lease', () => {
  const source = read('server/routes/market.js');
  assert.match(source, /router\.post\('\/refresh', verifyJWT, requireRole\('admin'\), marketRefreshLimiter/);
  assert.match(source, /createEndpointRateLimiter/);
  assert.match(source, /withMarketRefreshLease\('Manual Market Refresh'/);
  assert.doesNotMatch(source, /Promise\.allSettled\(\[[\s\S]*\]\)\.catch\(\(\) => \{\}\);/);
});

test('GET goals is a lean read path and explicit advice refresh remains separate', () => {
  const source = read('server/routes/goals.js');
  const getStart = source.indexOf("router.get('/',");
  const getEnd = source.indexOf("router.post('/:goalId/simulate'", getStart);
  const getBlock = source.slice(getStart, getEnd);
  assert.match(getBlock, /\.lean\(\)/);
  assert.doesNotMatch(getBlock, /generateGoalAdvice|\.save\(|getGoalAdvisory/);
  assert.match(source, /router\.patch\('\/:goalId\/refresh-advice'/);
});

test('MCP is stateless, bearer-authenticated, and rejects legacy session transport', () => {
  const source = read('server/mcp/wealthgenieMcpServer.js');
  const router = read('server/routes/mcpRouter.js');
  const runtime = read('server/mcp/mcpRuntime.js');
  assert.match(source, /StreamableHTTPServerTransport/);
  assert.match(source, /sessionIdGenerator: undefined/);
  assert.match(router, /verifyMcpBearer/);
  assert.match(router, /MCP_DISABLED/);
  assert.match(runtime, /MCP_DRAINING/);
  assert.doesNotMatch(source, /SSEServerTransport|sseTransports|mcpServerInstance/);
  assert.doesNotMatch(router, /\/sse|\/messages/);
});

test('production overlay requires HTTPS host and pre-created TLS/DocumentDB CA secrets', () => {
  const overlay = read('k8s/overlays/production/ingress-patch.yaml');
  const overlayReadme = read('k8s/overlays/production/README.md');
  assert.match(overlay, /ssl-redirect.*true|value: "true"/);
  assert.match(overlay, /WEALTHGENIE_PRODUCTION_HOST/);
  assert.match(overlay, /WEALTHGENIE_PRODUCTION_TLS_SECRET/);
  assert.match(overlayReadme, /must already exist/);
  assert.match(overlayReadme, /Application compute\/runtime attachment remains a separate/);
});

test('production session cookies remain Secure while local Compose cookies stay usable over HTTP', () => {
  assert.equal(sessionCookieOptions({ NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }).secure, true);
  assert.equal(sessionCookieOptions({ NODE_ENV: 'development', AUTH_COOKIE_SECURE: 'false' }).secure, false);
});

test('Terraform uses explicit DocumentDB safety inputs and workload security-group wiring', () => {
  const root = read('terraform/main.tf');
  const variables = read('terraform/variables.tf');
  const database = read('terraform/modules/database/main.tf');
  assert.match(root, /app_security_group_id\s*=\s*var\.app_security_group_id/);
  assert.match(root, /documentdb_engine_version\s*=\s*var\.documentdb_engine_version/);
  assert.match(variables, /variable "documentdb_engine_version"/);
  assert.match(variables, /variable "app_security_group_id"/);
  assert.match(database, /engine_version\s*=\s*var\.documentdb_engine_version/);
  assert.match(database, /deletion_protection\s*=\s*var\.documentdb_deletion_protection/);
  assert.match(database, /skip_final_snapshot\s*=\s*var\.documentdb_skip_final_snapshot/);
  assert.match(database, /final_snapshot_identifier\s*=\s*local\.final_snapshot_identifier/);
  assert.doesNotMatch(root, /app_security_group\s*=\s*module\.alb/);
});
