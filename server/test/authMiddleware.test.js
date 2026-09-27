import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { verifyJWT } from '../middleware/authMiddleware.js';

process.env.JWT_SECRET = 'unit-test-secret';

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('verifyJWT accepts a valid bearer token and attaches req.user', () => {
  const token = jwt.sign({ userId: '64b000000000000000000001' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockResponse();
  let called = false;

  verifyJWT(req, res, () => { called = true; });

  assert.equal(called, true);
  assert.equal(req.user.userId, '64b000000000000000000001');
});

test('verifyJWT rejects missing bearer tokens', () => {
  const req = { headers: {} };
  const res = mockResponse();
  let called = false;

  verifyJWT(req, res, () => { called = true; });

  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /No token/);
});

test('verifyJWT rejects an MCP-purpose token even if it is signed with the session key', () => {
  const token = jwt.sign({
    userId: '64b000000000000000000001',
    token_use: 'mcp',
    aud: 'wealthgenie-mcp',
    scope: 'mcp:tools',
  }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockResponse();
  let called = false;
  verifyJWT(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_TOKEN_INVALID');
});
