import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import taxRoutes from '../routes/tax.js';
import { withServer, jsonRequest } from '../test-utils/httpTestUtils.js';

describe('WG-038: POST /api/tax/post-tax-return & /batch Endpoints', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tax', taxRoutes);

  test('POST /api/tax/post-tax-return - FD 7% at ₹10L income under new regime returns 0.07 (0% tax drag due to 87A rebate)', async () => {
    await withServer(app, async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/tax/post-tax-return`, {
        method: 'POST',
        body: JSON.stringify({
          instrumentType: 'FD',
          nominalRate: 0.07,
          annualIncome: 1000000,
          holdingYears: 3,
          regime: 'new',
          incomeSource: 'salary',
          monthlySIP: 10000,
          userAge: 30,
        }),
      });

      assert.equal(response.status, 200);
      assert.equal(body.postTaxReturn, 0.07);
      assert.equal(body.taxRate, 0);
    });
  });

  test('POST /api/tax/post-tax-return/batch - Batch computation correctly computes multiple instruments with rebate', async () => {
    await withServer(app, async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [
            { instrumentType: 'FD', nominalRate: 0.07, holdingYears: 3, monthlySIP: 10000 },
            { instrumentType: 'PPF', nominalRate: 0.071, holdingYears: 15, monthlySIP: 10000 },
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 5, monthlySIP: 10000 },
          ],
          annualIncome: 1000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 30,
          inflationRate: 0.06,
        }),
      });

      assert.equal(response.status, 200);
      assert.equal(body.results.length, 3);

      // FD: postTaxReturn should be 0.07 (0% tax rate at ₹10L income under new regime)
      assert.equal(body.results[0].postTaxReturn, 0.07);
      assert.equal(body.results[0].taxRate, 0);

      // PPF: EEE, postTaxReturn = 0.071
      assert.equal(body.results[1].postTaxReturn, 0.071);

      // Equity_MF: LTCG with exemption
      assert.ok(body.results[2].postTaxReturn > 0);
      assert.equal(body.calculation_classification, 'SEPARATE_TAX_WHAT_IF');
      assert.equal(body.assumptions.inflationRate, 0.06);
      assert.ok(Number.isFinite(body.results[0].nominalFutureValue));
      assert.ok(Number.isFinite(body.results[0].postTaxFutureValue));
      assert.ok(Number.isFinite(body.results[0].realFutureValue));
      assert.ok(Number.isFinite(body.summary.keptPerThousand));
    });
  });

  test('Validation - Bad input returns 400', async () => {
    await withServer(app, async (baseUrl) => {
      const { response } = await jsonRequest(`${baseUrl}/api/tax/post-tax-return`, {
        method: 'POST',
        body: JSON.stringify({
          instrumentType: '',
          nominalRate: 0.07,
          annualIncome: 1000000,
        }),
      });
      assert.equal(response.status, 400);
    });
  });

  test('Validation - Rejects out-of-range rates and malformed batch entries', async () => {
    await withServer(app, async (baseUrl) => {
      const invalidRate = await jsonRequest(`${baseUrl}/api/tax/post-tax-return`, {
        method: 'POST',
        body: JSON.stringify({ instrumentType: 'FD', nominalRate: 7, annualIncome: 1000000 }),
      });
      assert.equal(invalidRate.response.status, 400);
      assert.equal(invalidRate.body.error, 'Validation failed');

      const invalidBatch = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [{ instrumentType: 'FD', nominalRate: -0.1 }],
          annualIncome: 1000000,
          regime: 'new',
          inflationRate: 0.06,
        }),
      });
      assert.equal(invalidBatch.response.status, 400);
      assert.equal(invalidBatch.body.error, 'Validation failed');
    });
  });
});
