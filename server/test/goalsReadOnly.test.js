import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import Goal from '../models/Goal.js';
import goalsRouter from '../routes/goals.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'goals-read-only-test-secret-2026';
process.env.DISABLE_RATE_LIMIT = 'true';

const userId = '60d5ecb8b3b3a72d9c8e4a11';
const token = jwt.sign({ userId, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

test('GET /api/goals is read-only and does not regenerate stale advice', async () => {
  const originalFind = Goal.find;
  let saveCalled = false;
  Goal.find = () => ({
    sort: () => ({
      lean: async () => [{
        _id: '60d5ecb8b3b3a72d9c8e4a12',
        userId,
        profileId: '60d5ecb8b3b3a72d9c8e4a13',
        goal_name: 'Emergency buffer',
        gemini_advice: 'Advice temporarily unavailable',
        chart_data: [],
        save: async () => { saveCalled = true; },
      }],
    }),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/goals', goalsRouter);
  app.use(errorHandler);

  try {
    await withServer(app, async baseUrl => {
      const response = await rawRequest(`${baseUrl}/api/goals`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.goals.length, 1);
      assert.equal(body.goals[0].advice_stale, true);
      assert.deepEqual(body.goals[0].chartData, []);
      assert.equal(saveCalled, false);
    });
  } finally {
    Goal.find = originalFind;
  }
});
