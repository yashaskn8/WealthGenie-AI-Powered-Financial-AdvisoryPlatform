/** Cross-platform observability tests that do not require MongoDB. */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import healthRoutes from '../routes/health.js';
import { correlationIdMiddleware } from '../middleware/correlation.js';
import { errorHandler } from '../middleware/errorHandler.js';

process.env.NODE_ENV = 'test';

function buildApp() {
  const app = express();
  app.use(correlationIdMiddleware);
  app.use('/health', healthRoutes);
  app.use(errorHandler);
  return app;
}

async function withServer(fn) {
  const server = buildApp().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Observability: correlation ID generated automatically if missing', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const headerCid = response.headers.get('x-correlation-id');
    assert.ok(headerCid, 'X-Correlation-ID response header must exist');
    assert.match(headerCid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

test('Observability: correlation ID propagated if provided in request', async () => {
  const customCid = 'test-trace-token-9988-7766';
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { 'x-correlation-id': customCid },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-correlation-id'), customCid);
  });
});

test('Observability: malformed correlation and trace headers are replaced safely', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        'x-correlation-id': 'invalid id with spaces',
        traceparent: 'not-a-valid-traceparent',
      },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-correlation-id'), /^[0-9a-f-]{36}$/i);
    assert.equal(response.headers.get('x-request-id'), response.headers.get('x-correlation-id'));
    assert.match(response.headers.get('traceparent'), /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });
});
