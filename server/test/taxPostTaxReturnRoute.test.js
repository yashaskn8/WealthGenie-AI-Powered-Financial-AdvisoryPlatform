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
          fiscalYear: 'FY2026-27',
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
          fiscalYear: 'FY2026-27',
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

  test('Batch summary is truthful for partial and unavailable portfolios', async () => {
    await withServer(app, async (baseUrl) => {
      const partial = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [
            { instrumentType: 'FD', nominalRate: 0.07, holdingYears: 3, monthlySIP: 10000 },
            { instrumentType: 'ETF', nominalRate: 0.12, holdingYears: 3, monthlySIP: 10000 },
          ],
          annualIncome: 1000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 30,
          inflationRate: 0.06,
          fiscalYear: 'FY2026-27',
        }),
      });
      assert.equal(partial.response.status, 200);
      assert.equal(partial.body.portfolioStatus, 'PARTIAL');
      assert.equal(partial.body.summary.status, 'PARTIAL');
      assert.equal(partial.body.summary.totalTaxDrag !== null, true);
      assert.equal(partial.body.excludedInstruments.length, 1);

      const unavailable = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [{ instrumentType: 'Gold_ETF', nominalRate: 0.1, holdingYears: 3, monthlySIP: 10000 }],
          annualIncome: 1000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 30,
          inflationRate: 0.06,
          fiscalYear: 'FY2026-27',
        }),
      });
      assert.equal(unavailable.response.status, 200);
      assert.equal(unavailable.body.portfolioStatus, 'UNAVAILABLE');
      assert.equal(unavailable.body.summary.totalTaxDrag, null);
      assert.equal(unavailable.body.summary.keptPerThousand, null);
      assert.equal(unavailable.body.summary.erodedPerThousand, null);
      assert.equal(unavailable.body.summary.retentionEfficiencyPercent, null);
      assert.equal(unavailable.body.summary.maxTaxRate, null);
    });
  });

  test('Batch Section 112A exemption is allocated once and is permutation-stable', async () => {
    await withServer(app, async (baseUrl) => {
      const shared = {
        annualIncome: 3000000,
        regime: 'new',
        incomeSource: 'salary',
        userAge: 35,
        inflationRate: 0.06,
        fiscalYear: 'FY2026-27',
      };
      const instruments = [
        { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 10000 },
        { instrumentType: 'Equity_MF', nominalRate: 0.15, holdingYears: 2, monthlySIP: 5000 },
      ];
      const first = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST', body: JSON.stringify({ ...shared, instruments }),
      });
      const reversed = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST', body: JSON.stringify({ ...shared, instruments: [...instruments].reverse() }),
      });
      assert.equal(first.response.status, 200);
      assert.equal(reversed.response.status, 200);
      assert.equal(first.body.portfolioStatus, 'COMPLETE');
      assert.equal(first.body.assumptions.section112APortfolioAllocation.policy, 'PROPORTIONAL_QUALIFYING_LTCG_ALLOCATED_ONCE_PER_BATCH');
      assert.equal(first.body.assumptions.section112APortfolioAllocation.allocationComplete, true);
      assert.equal(first.body.summary.totalTaxDrag, reversed.body.summary.totalTaxDrag);
      assert.equal(first.body.summary.retentionEfficiencyPercent, reversed.body.summary.retentionEfficiencyPercent);
      assert.equal(
        first.body.assumptions.section112APortfolioAllocation.exemptionAppliedAcrossBatch,
        reversed.body.assumptions.section112APortfolioAllocation.exemptionAppliedAcrossBatch,
      );
      assert.ok(Math.abs(
        first.body.results.reduce((sum, item) => sum + item.exemptionApplied, 0)
        - first.body.assumptions.section112APortfolioAllocation.exemptionAppliedAcrossBatch,
      ) < 0.001);
    });
  });

  test('Partial equity portfolio does not grant the full 112A exemption to the known subset', async () => {
    await withServer(app, async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 100000 },
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 3000000 },
          ],
          annualIncome: 3000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 35,
          inflationRate: 0.06,
          fiscalYear: 'FY2026-27',
        }),
      });
      const allocation = body.assumptions.section112APortfolioAllocation;
      assert.equal(response.status, 200);
      assert.equal(body.portfolioStatus, 'PARTIAL');
      assert.equal(allocation.allocationComplete, false);
      assert.equal(allocation.policy, 'CONSERVATIVE_PARTIAL_PORTFOLIO_112A_ASSUMPTION');
      assert.equal(allocation.exemptionAppliedAcrossBatch, 0);
      assert.deepEqual(allocation.unavailableReasons, ['SECTION_112A_PORTFOLIO_ALLOCATION_INCOMPLETE']);
      assert.equal(body.results[0].status, 'CALCULATED');
      assert.equal(body.results[0].exemptionApplied, 0);
      assert.equal(body.results[1].status, 'MODELLED_POST_TAX_PROJECTION_UNAVAILABLE');
    });
  });

  test('Mixed partial portfolio keeps non-equity results while marking 112A allocation incomplete', async () => {
    await withServer(app, async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [
            { instrumentType: 'FD', nominalRate: 0.07, holdingYears: 3, monthlySIP: 10000 },
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 100000 },
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 3000000 },
          ],
          annualIncome: 3000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 35,
          inflationRate: 0.06,
          fiscalYear: 'FY2026-27',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal(body.portfolioStatus, 'PARTIAL');
      assert.equal(body.results[0].status, 'CALCULATED');
      assert.equal(body.assumptions.section112APortfolioAllocation.allocationComplete, false);
      assert.equal(body.assumptions.section112APortfolioAllocation.exemptionAppliedAcrossBatch, 0);
      assert.equal(body.summary.status, 'PARTIAL');
    });
  });

  test('All equity unavailable keeps the portfolio summary numeric fields null', async () => {
    await withServer(app, async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 3000000 },
            { instrumentType: 'Equity_MF', nominalRate: 0.12, holdingYears: 2, monthlySIP: 4000000 },
          ],
          annualIncome: 3000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 35,
          inflationRate: 0.06,
          fiscalYear: 'FY2026-27',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal(body.portfolioStatus, 'UNAVAILABLE');
      assert.equal(body.summary.totalTaxDrag, null);
      assert.equal(body.summary.keptPerThousand, null);
      assert.equal(body.summary.erodedPerThousand, null);
      assert.equal(body.summary.retentionEfficiencyPercent, null);
      assert.equal(body.summary.maxTaxRate, null);
      assert.equal(body.assumptions.section112APortfolioAllocation.allocationComplete, false);
      assert.deepEqual(body.assumptions.section112APortfolioAllocation.unavailableReasons, ['SECTION_112A_PORTFOLIO_ALLOCATION_INCOMPLETE']);
    });
  });

  test('Validation - rejects dependency-sensitive deductions without supporting facts', async () => {
    await withServer(app, async (baseUrl) => {
      const invalid = await jsonRequest(`${baseUrl}/api/tax/post-tax-return/batch`, {
        method: 'POST',
        body: JSON.stringify({
          instruments: [{ instrumentType: 'FD', nominalRate: 0.07, holdingYears: 3, monthlySIP: 10000 }],
          annualIncome: 1000000,
          regime: 'new',
          incomeSource: 'salary',
          userAge: 30,
          inflationRate: 0.06,
          fiscalYear: 'FY2026-27',
          deductions: { nps80CCD2: 10000 },
        }),
      });
      assert.equal(invalid.response.status, 400);
      assert.equal(invalid.body.error, 'Validation failed');
    });
  });
});
