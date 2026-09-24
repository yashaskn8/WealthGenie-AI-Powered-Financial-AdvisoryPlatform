import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import portfolioRoutes from '../routes/portfolio.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { closeServer, rawRequest } from '../test-utils/httpTestUtils.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';
import { assertRuntimeResponseMatchesContract } from './helpers/openapiRuntimeContract.js';

process.env.JWT_SECRET = 'portfolio-route-test-secret';

test('portfolio optimise route responds for all frontend-exposed strategies', async (t) => {
  const userId = '64b000000000000000000001';
  const profileId = '65b000000000000000000001';
  const originalFindById = FinancialProfile.findById;
  const originalFindOne = FinancialProfile.findOne;

  const mockProfileObj = {
    lean: async () => ({
      _id: profileId,
      userId,
      ...canonicalProfile({
        age: 25, monthlyTakeHome: 400000, monthlySavings: 120000,
        liquidSavings: 1000000, emergencyFundMonths: 12,
        riskTolerance: 'Aggressive', investmentHorizonYears: 20,
      }),
    }),
  };

  FinancialProfile.findById = () => mockProfileObj;
  FinancialProfile.findOne = () => mockProfileObj;
  t.after(() => {
    FinancialProfile.findById = originalFindById;
    FinancialProfile.findOne = originalFindOne;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/portfolio', portfolioRoutes);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await closeServer(server); });

  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/portfolio/optimise`;

  for (const strategy of ['min_variance', 'max_sharpe', 'risk_parity']) {
    const response = await rawRequest(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId,
        assets: ['Equity_MF', 'Debt_MF', 'Gold'],
        strategy,
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 200, `${strategy}: ${JSON.stringify(body)}`);
    assertRuntimeResponseMatchesContract({
      method: 'POST', path: '/api/portfolio/optimise', status: response.status,
      contentType: response.headers.get('content-type'), body,
    });
    assert.equal(body.strategy, strategy);
    assert.ok(Number.isFinite(body.portfolio_return_assumption), `${strategy} portfolio_return_assumption`);
    assert.equal(body.return_data_class, 'MODEL_ASSUMPTION');
    assert.equal(body.observed_market_fact, false);
    assert.equal(body.provider_forecast, false);
    assert.ok(Number.isFinite(body.volatility), `${strategy} volatility`);
    assert.ok(Number.isFinite(body.sharpe_ratio), `${strategy} sharpe_ratio`);
    assert.ok(Math.abs(Object.values(body.weights).reduce((sum, value) => sum + value, 0) - 1) < 0.00001);
  }
});
