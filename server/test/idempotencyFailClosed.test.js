import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { errorHandler } from '../middleware/errorHandler.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import { withServer } from '../test-utils/httpTestUtils.js';

process.env.NODE_ENV = 'test';

test('durable idempotency dependency failure returns canonical 503 before mutation handler', async () => {
  const originalIndexes = IdempotencyKey.collection.indexes;
  const originalInit = IdempotencyKey.init;
  const originalFindById = IdempotencyKey.findById;
  IdempotencyKey.collection.indexes = async () => [];
  IdempotencyKey.init = async () => IdempotencyKey;
  IdempotencyKey.findById = () => { throw new Error('simulated Mongo idempotency read outage'); };
  let mutationExecutions = 0;

  try {
    // A unique ESM module URL gives the readiness promise a fresh instance,
    // while the imported Mongoose model remains the same shared model.
    const { idempotency } = await import('../middleware/idempotency.js?fail-closed-test');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { userId: new mongoose.Types.ObjectId().toString() };
      next();
    });
    app.post('/mutate', idempotency({
      operation: 'test.fail-closed-mutation',
      resolveReplay: async () => ({ replay: true }),
    }), (_req, res) => {
      mutationExecutions += 1;
      res.status(201).json({ changed: true });
    });
    app.use(errorHandler);

    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/mutate`, {
        method: 'POST',
        headers: { 'Idempotency-Key': 'valid-fail-closed-key' },
      });
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.code, 'IDEMPOTENCY_UNAVAILABLE');
      assert.equal(typeof body.request_id, 'string');
      assert.equal(mutationExecutions, 0, 'the business mutation must not run without durable idempotency coordination');
    });
  } finally {
    IdempotencyKey.collection.indexes = originalIndexes;
    IdempotencyKey.init = originalInit;
    IdempotencyKey.findById = originalFindById;
  }
});
