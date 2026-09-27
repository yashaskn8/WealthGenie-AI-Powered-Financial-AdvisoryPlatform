import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpRouter } from '../routes/mcpRouter.js';
import { getRuntimeConfig } from '../config/runtime.js';
import { createMcpRuntime } from '../mcp/mcpRuntime.js';
import { createMcpCapacityController } from '../mcp/mcpCapacity.js';
import { FinancialToolRegistry } from '../services/financialToolRegistry.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-wealthgenie-phase6';
process.env.JWT_SECRET = JWT_SECRET;
const userId = '60d5ecb8b3b3a72d9c8e4a11';
const token = jwt.sign({ userId, jti: 'phase6-test-token' }, JWT_SECRET, { expiresIn: '1h' });

function dependencies(overrides = {}) {
  const env = { NODE_ENV: 'test', JWT_SECRET };
  const baseConfig = getRuntimeConfig(env);
  const config = {
    ...baseConfig,
    mcp: {
      ...baseConfig.mcp,
      ...(overrides.maxRequestsPerWindow ? { maxRequestsPerWindow: overrides.maxRequestsPerWindow } : {}),
        ...(overrides.mcp || {}),
    },
  };
  const runtime = createMcpRuntime({ toolTimeoutMs: 2000, shutdownGraceMs: 100 });
  runtime.markReady();
  const capacity = createMcpCapacityController({
    config: config.mcp,
    env,
    getRedisState: () => ({ available: false, client: null }),
  });
  return { config, env, runtime, capacity };
}

function buildApp(options = {}) {
  const app = express();
  const deps = dependencies(options);
  app.use('/api/mcp', createMcpRouter(deps));
  app.use(errorHandler);
  return { app, ...deps };
}

async function rawInitialize(baseUrl, headers = {}) {
  return rawRequest(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'phase6-test', version: '1.0.0' } },
    }),
  });
}

async function makeClient(url, fetchImpl = fetch) {
  const client = new Client({ name: 'WealthGenie Phase 6 test client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', url), {
    fetch: fetchImpl,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

after(() => {
  // The tests use a syntactically valid test-only token and never contact a provider.
});

describe('MCP stateless Streamable HTTP boundary', () => {
  it('returns the documented 503 MCP_DISABLED response when remote MCP is disabled', async () => {
    const { app } = buildApp({ mcp: { enabled: false, remoteEnabled: false } });
    await withServer(app, async baseUrl => {
      const response = await rawInitialize(baseUrl);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, 'MCP_DISABLED');
      assert.ok(body.request_id);
    });
  });

  it('requires Bearer authentication; a session cookie is not an MCP credential', async () => {
    const { app } = buildApp();
    await withServer(app, async baseUrl => {
      const response = await rawInitialize(baseUrl, { cookie: 'session=not-a-bearer' });
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.code, 'MCP_AUTH_REQUIRED');
      assert.ok(body.request_id);
      assert.equal(body.stack, undefined);
    });
  });

  it('speaks the real MCP protocol and routes one stateless client across independent instances', async () => {
    const podA = buildApp();
    const podB = buildApp();
    await withServer(podA.app, async urlA => withServer(podB.app, async urlB => {
      let index = 0;
      const endpoints = [urlA, urlB];
      const roundRobinFetch = (input, init) => {
        const source = new URL(input instanceof Request ? input.url : String(input));
        const base = endpoints[index++ % endpoints.length];
        return fetch(new URL(`${source.pathname}${source.search}`, base), init);
      };
      const { client, transport } = await makeClient(urlA, roundRobinFetch);
      try {
        const listed = await client.listTools();
        assert.equal(listed.tools.length, 7);
        assert.ok(listed.tools.every(tool => tool.outputSchema?.properties?.authority?.const === 'NON_AUTHORITATIVE'));
        const result = await client.callTool({ name: 'sip_projection', arguments: { monthlyInvestment: 10000, annualRate: 0.1, years: 5 } });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.authority, 'NON_AUTHORITATIVE');
        assert.equal(result.structuredContent.profileGrounded, false);
        assert.equal(result.structuredContent.result.futureValue, 780824);
        assert.equal(transport.sessionId, undefined);
        assert.match(PrometheusMetrics.getPrometheusFormat(), /wealthgenie_mcp_tool_execution_duration_ms_count [1-9]/);
      } finally {
        await client.close();
      }
    }));
  });

  it('supports ten independent simultaneous protocol clients without shared session state', async () => {
    const { app } = buildApp();
    await withServer(app, async baseUrl => {
      const clients = await Promise.all(Array.from({ length: 10 }, () => makeClient(baseUrl)));
      try {
        const results = await Promise.all(clients.map(({ client }) => client.callTool({
          name: 'lump_sum_projection',
          arguments: { principal: 10000, annualRate: 0.08, years: 2 },
        })));
        assert.equal(results.length, 10);
        assert.ok(results.every(result => result.structuredContent?.authority === 'NON_AUTHORITATIVE'));
      } finally {
        await Promise.all(clients.map(({ client }) => client.close()));
      }
    });
  });

  it('propagates an HTTP client disconnect to running tool work and releases its active slot', async () => {
    const { app, runtime } = buildApp();
    const original = FinancialToolRegistry.executeTool;
    let markStarted;
    let markAborted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const aborted = new Promise(resolve => { markAborted = resolve; });
    FinancialToolRegistry.executeTool = async (_name, _args, context) => new Promise(resolve => {
      const onAbort = () => {
        markAborted(context.signal.reason?.code);
        resolve({ success: true, result: { futureValue: 1 } });
      };
      if (context.signal.aborted) onAbort();
      else context.signal.addEventListener('abort', onAbort, { once: true });
      markStarted();
    });
    try {
      await withServer(app, async baseUrl => {
        const { client } = await makeClient(baseUrl);
        const pending = client.callTool({
          name: 'sip_projection',
          arguments: { monthlyInvestment: 10000, annualRate: 0.1, years: 5 },
        }).catch(error => error);
        await started;
        await client.close();
        const abortCode = await aborted;
        await pending;
        const drain = await runtime.drain({ graceMs: 500 });
        assert.equal(abortCode, 'MCP_CLIENT_CANCELLED');
        assert.equal(drain.drained, true);
        assert.equal(runtime.snapshot().activeTools, 0);
      });
    } finally {
      FinancialToolRegistry.executeTool = original;
    }
  });

  it('rejects unknown routes, legacy SSE, non-allowlisted Host and Origin', async () => {
    const { app } = buildApp();
    await withServer(app, async baseUrl => {
      const bearer = { authorization: `Bearer ${token}` };
      assert.equal((await rawRequest(`${baseUrl}/api/mcp/sse`, { method: 'GET', headers: bearer })).status, 404);
      assert.equal((await rawRequest(`${baseUrl}/api/mcp/messages`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{}' })).status, 404);
      const badHost = await rawInitialize(baseUrl, { ...bearer, host: 'attacker.invalid' });
      assert.equal(badHost.status, 403);
      const badOrigin = await rawInitialize(baseUrl, { ...bearer, origin: 'https://attacker.invalid' });
      assert.equal(badOrigin.status, 403);
      const forwardedSpoof = await rawInitialize(baseUrl, { ...bearer, 'x-forwarded-host': 'attacker.invalid' });
      assert.equal(forwardedSpoof.status, 200);
      const query = await rawRequest(`${baseUrl}/api/mcp?sessionId=not-supported`, {
        method: 'POST',
        headers: { ...bearer, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      assert.equal(query.status, 400);
      assert.equal((await query.json()).code, 'MCP_QUERY_NOT_SUPPORTED');
      const method = await rawRequest(`${baseUrl}/api/mcp`, { method: 'GET', headers: bearer });
      assert.equal(method.status, 405);
      assert.equal(method.headers.get('allow'), 'POST');
    });
  });

  it('contains unexpected MCP executor exception text and unrecognized internal codes', async () => {
    const { app } = buildApp();
    const original = FinancialToolRegistry.executeTool;
    FinancialToolRegistry.executeTool = async () => {
      const error = new Error('DATABASE_PASSWORD=secret C:/internal/path.js raw investor profile');
      error.code = 'MCP_DATABASE_PASSWORD_SECRET';
      throw error;
    };
    try {
      await withServer(app, async baseUrl => {
        const { client } = await makeClient(baseUrl);
        try {
          const result = await client.callTool({ name: 'sip_projection', arguments: { monthlyInvestment: 10000, annualRate: 0.1, years: 5 } });
          assert.equal(result.isError, true);
          const text = result.content.map(part => part.text || '').join('\n');
          assert.equal(text.includes('DATABASE_PASSWORD'), false);
          assert.equal(text.includes('secret'), false);
          assert.equal(text.includes('C:/internal/path.js'), false);
          assert.equal(text.includes('raw investor profile'), false);
          assert.equal(text.includes('MCP_DATABASE_PASSWORD_SECRET'), false);
          assert.equal(JSON.parse(text).code, 'MCP_TOOL_EXECUTION_FAILED');
        } finally {
          await client.close();
        }
      });
    } finally {
      FinancialToolRegistry.executeTool = original;
    }
  });

  it('rejects disabled remote access and returns stable request-limit errors', async () => {
    const disabled = buildApp();
    disabled.config.mcp.remoteEnabled = false;
    await withServer(disabled.app, async baseUrl => {
      const response = await rawInitialize(baseUrl);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'MCP_DISABLED');
    });

    const limited = buildApp({ maxRequestsPerWindow: 1 });
    await withServer(limited.app, async baseUrl => {
      const headers = { authorization: `Bearer ${token}` };
      assert.equal((await rawInitialize(baseUrl, headers)).status, 200);
      const second = await rawInitialize(baseUrl, headers);
      assert.equal(second.status, 429);
      assert.equal((await second.json()).code, 'MCP_CAPACITY_EXCEEDED');
    });
  });

  it('handles malformed JSON-RPC and negotiates an unsupported client protocol version safely', async () => {
    const { app } = buildApp();
    await withServer(app, async baseUrl => {
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      const malformedJson = await rawRequest(`${baseUrl}/api/mcp`, { method: 'POST', headers, body: '{' });
      assert.equal(malformedJson.status, 400);
      assert.equal((await malformedJson.json()).code, 'MCP_INVALID_JSON');

      const unsupportedVersion = await rawRequest(`${baseUrl}/api/mcp`, {
        method: 'POST', headers,
        body: JSON.stringify({
          jsonrpc: '2.0', id: 3, method: 'initialize',
          params: { protocolVersion: '1900-01-01', capabilities: {}, clientInfo: { name: 'unsupported-version', version: '1.0.0' } },
        }),
      });
      assert.equal(unsupportedVersion.status, 200);
      const negotiated = await unsupportedVersion.json();
      assert.equal(negotiated.result.protocolVersion, '2025-11-25');
      assert.ok(negotiated.result.capabilities.tools);

      const unsupportedMethod = await rawRequest(`${baseUrl}/api/mcp`, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'not/a/supported-method', params: {} }),
      });
      assert.equal(unsupportedMethod.status, 200);
      assert.equal((await unsupportedMethod.json()).error.code, -32601);
    });
  });
});
