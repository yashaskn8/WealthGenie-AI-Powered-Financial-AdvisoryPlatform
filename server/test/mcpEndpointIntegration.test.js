import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import mcpRouter from '../routes/mcpRouter.js';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-wealthgenie-2026';
process.env.JWT_SECRET = JWT_SECRET;

const mockUserId = '60d5ecb8b3b3a72d9c8e4a11';
const validToken = jwt.sign({ userId: mockUserId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });

function buildMcpApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRouter);
  app.use(errorHandler);
  return app;
}

describe('MCP SSE & HTTP Endpoint Integration Tests', () => {
  // ── Authentication Gate Tests ──

  it('GET /api/mcp/sse rejects unauthenticated request with 401', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/sse`, { method: 'GET' });
      assert.equal(res.status, 401);
    });
  });

  it('GET /api/mcp/sse rejects expired JWT token with 401', async () => {
    const expiredToken = jwt.sign({ userId: mockUserId }, JWT_SECRET, { expiresIn: '-1s' });
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/sse`, {
        method: 'GET',
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      assert.equal(res.status, 401);
    });
  });

  it('GET /api/mcp/sse rejects malformed JWT with 401', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/sse`, {
        method: 'GET',
        headers: { authorization: 'Bearer invalid.jwt.garbage' },
      });
      assert.equal(res.status, 401);
    });
  });

  it('POST /api/mcp/messages rejects unauthenticated request with 401', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test' }),
      });
      assert.equal(res.status, 401);
    });
  });

  it('POST /api/mcp/messages rejects expired JWT with 401', async () => {
    const expiredToken = jwt.sign({ userId: mockUserId }, JWT_SECRET, { expiresIn: '-1s' });
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${expiredToken}`,
        },
        body: JSON.stringify({ message: 'test' }),
      });
      assert.equal(res.status, 401);
    });
  });

  // ── Session Validation Tests ──

  it('POST /api/mcp/messages with valid JWT but missing sessionId returns safe 404', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      // Unknown sessions use a safe not-found response without exposing ownership.
      assert.equal(res.status, 404);
    });
  });

  it('POST /api/mcp/messages with non-existent sessionId returns safe 404 error', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/messages?sessionId=non-existent-session-xyz`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      assert.equal(res.status, 404);
      const data = await res.json();
      assert.ok(data.error, 'Response must contain error field for invalid session');
    });
  });

  // ── HTTP Method Enforcement Tests ──

  it('PUT /api/mcp/sse returns 404 (only GET is wired)', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/sse`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${validToken}` },
      });
      assert.ok([404, 405].includes(res.status), `Expected 404/405 for PUT on /sse, got ${res.status}`);
    });
  });

  it('GET /api/mcp/messages returns 404 (only POST is wired)', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/mcp/messages`, {
        method: 'GET',
        headers: { authorization: `Bearer ${validToken}` },
      });
      assert.ok([404, 405].includes(res.status), `Expected 404/405 for GET on /messages, got ${res.status}`);
    });
  });

  // ── SSE Connection Establishment Tests ──

  it('GET /api/mcp/sse with valid JWT initiates SSE stream (text/event-stream content-type)', async () => {
    await withServer(buildMcpApp(), async (baseUrl) => {
      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/api/mcp/sse`, {
          method: 'GET',
          headers: { authorization: `Bearer ${validToken}` },
          signal: controller.signal,
        });
        assert.equal(response.status, 200);
        const contentType = response.headers.get('content-type');
        assert.ok(contentType && contentType.includes('text/event-stream'),
          `Expected text/event-stream content-type, got ${contentType}`);
      } finally {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
  });

  it('SSE session disconnect reaps session transport and active count drops back to 0', async () => {
    const { mcpServerInstance } = await import('../mcp/wealthgenieMcpServer.js');
    await withServer(buildMcpApp(), async (baseUrl) => {
      // Ensure no residual sessions
      const countStart = mcpServerInstance.getActiveSessionCount();

      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/api/mcp/sse`, {
          method: 'GET',
          headers: { authorization: `Bearer ${validToken}` },
          signal: controller.signal,
        });
        assert.equal(response.status, 200);

        // Session established
        const activeCount = mcpServerInstance.getActiveSessionCount();
        console.log(`[VERIFY] SSE Session count during active connection: ${activeCount}`);
        assert.equal(activeCount, countStart + 1, 'Active session count must increase by 1 while connected');
      } finally {
        // Abort connection to simulate client disconnect
        controller.abort();
      }

      // Wait for socket and response close event handlers to fire
      await new Promise((resolve) => setTimeout(resolve, 100));

      const finalCount = mcpServerInstance.getActiveSessionCount();
      console.log(`[VERIFY] SSE Session count AFTER client disconnect: ${finalCount}`);
      assert.equal(finalCount, 0, 'Active session count must return to 0 after disconnect');
    });
  });
});
