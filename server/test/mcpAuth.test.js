import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { verifyMcpBearer } from '../middleware/mcpAuth.js';
import { correlationIdMiddleware } from '../middleware/correlation.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';

const secret = 'mcp-auth-test-secret-with-more-than-thirty-two-characters';
const config = { jwtAudience: 'wealthgenie-mcp', requiredScope: 'mcp:tools' };
const revoked = new Set();

function signedToken(claims = {}, options = {}) {
  return jwt.sign({
    userId: '60d5ecb8b3b3a72d9c8e4a11',
    jti: 'phase6-auth-test-token',
    ...claims,
  }, secret, { expiresIn: '5m', audience: 'wealthgenie-mcp', ...options });
}

function buildApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.get('/protected', verifyMcpBearer({
    config,
    env: { JWT_SECRET: secret },
    checkRevocation: async jti => revoked.has(jti),
  }), (req, res) => res.json({ principal: req.mcpPrincipal }));
  return app;
}

async function request(baseUrl, authorization, extraHeaders = {}) {
  return rawRequest(`${baseUrl}/protected`, {
    method: 'GET',
    headers: { ...(authorization ? { authorization } : {}), ...extraHeaders },
  });
}

after(() => revoked.clear());

describe('dedicated MCP Bearer authentication', () => {
  it('accepts an unrevoked scoped token and binds the verified principal', async () => {
    await withServer(buildApp(), async baseUrl => {
      const token = signedToken({ scope: 'profile:read mcp:tools' });
      const response = await request(baseUrl, `Bearer ${token}`);
      assert.equal(response.status, 200);
      const { principal } = await response.json();
      assert.equal(principal.userId, '60d5ecb8b3b3a72d9c8e4a11');
      assert.deepEqual(principal.scopes, ['profile:read', 'mcp:tools']);
    });
  });

  it('rejects cookie-only, malformed, expired, wrong-audience, and wrong-scope credentials', async () => {
    await withServer(buildApp(), async baseUrl => {
      const cases = [
        [null, { cookie: 'session=some-jwt' }],
        ['Bearer not.a.jwt', {}],
        [`Bearer ${signedToken({ scope: 'mcp:tools' }, { expiresIn: '-1s' })}`, {}],
        [`Bearer ${signedToken({ scope: 'mcp:tools' }, { audience: 'another-api' })}`, {}],
        [`Bearer ${signedToken({ scope: 'profile:read' })}`, {}],
        [`Basic ${signedToken({ scope: 'mcp:tools' })}`, {}],
      ];
      for (const [authorization, headers] of cases) {
        const response = await request(baseUrl, authorization, headers);
        assert.equal(response.status, 401);
        const body = await response.json();
        assert.equal(typeof body.code, 'string');
        assert.equal(typeof body.message, 'string');
        assert.ok(body.request_id);
      }
    });
  });

  it('rejects tokens without expiry/revocation identity and tokens revoked after issuance', async () => {
    await withServer(buildApp(), async baseUrl => {
      const noJti = jwt.sign({ userId: '60d5ecb8b3b3a72d9c8e4a11', scope: 'mcp:tools' }, secret, { audience: 'wealthgenie-mcp', expiresIn: '5m' });
      const noExpiry = jwt.sign({ userId: '60d5ecb8b3b3a72d9c8e4a11', jti: 'no-exp', scope: 'mcp:tools' }, secret, { audience: 'wealthgenie-mcp' });
      assert.equal((await request(baseUrl, `Bearer ${noJti}`)).status, 401);
      assert.equal((await request(baseUrl, `Bearer ${noExpiry}`)).status, 401);
      revoked.add('phase6-auth-test-token');
      const response = await request(baseUrl, `Bearer ${signedToken({ scope: 'mcp:tools' })}`);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, 'MCP_AUTH_TOKEN_REVOKED');
    });
  });
});
