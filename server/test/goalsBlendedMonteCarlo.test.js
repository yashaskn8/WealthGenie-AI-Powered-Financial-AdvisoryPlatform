import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMonteCarloWithGoal, getInstrumentVolatility } from '../services/monteCarloEngine.js';
import { buildCovarianceMatrix, portfolioReturn, portfolioVol } from '../services/portfolioEngine.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

test('Blended Portfolio Monte Carlo: diversification reduces portfolio volatility and improves goal probability', () => {
  // Setup sample instruments matching a moderate recommendation portfolio
  const instruments = [
    { name: 'Public Provident Fund (PPF)', type: 'PPF', allocationWeight: 0.50, nominalReturn: 7.1, returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null },
    { name: 'Nifty 50 Index Fund', type: 'Equity_MF', allocationWeight: 0.25, nominalReturn: 14.5, returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null },
    { name: 'Invesco QQQ Trust ETF', type: 'ETF', allocationWeight: 0.25, nominalReturn: 12.5, returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null },
  ];

  // 1. Single instrument standalone volatility (Equity_MF)
  const singleVol = getInstrumentVolatility('Equity_MF');
  assert.equal(singleVol.stdDev, 0.18); // 18% equity volatility

  // 2. Blended portfolio metrics using covariance matrix
  const weights = instruments.map(i => i.allocationWeight);
  const returnsDecimal = instruments.map(i => i.nominalReturn / 100);
  const assetKeys = instruments.map(i => i.type);

  const blendedReturnDecimal = portfolioReturn(weights, returnsDecimal);
  const { matrix: cov } = buildCovarianceMatrix(assetKeys);
  const blendedVolDecimal = portfolioVol(cov, weights);

  // Assert blended volatility is significantly lower than standalone equity volatility due to PPF diversification
  assert.ok(blendedVolDecimal < 0.10, `Blended volatility (${blendedVolDecimal}) must be < 10% (diversified vs 15% single equity)`);
  assert.ok(blendedVolDecimal < singleVol.stdDev, 'Blended volatility must be lower than single instrument equity volatility');

  // 3. Compare Monte Carlo goal probability
  const targetAmount = 1_000_000;
  const monthlyInvestment = 10_000;
  const years = 5;

  const blendedPortfolioMC = runMonteCarloWithGoal({
    monthlyInvestment,
    annualExpectedReturn: blendedReturnDecimal,
    annualVolatility: blendedVolDecimal,
    years,
    simulations: 2000,
    targetAmount,
    currentSavings: 100_000,
    inflationRate: 0.05,
  });

  const equalReturnEquityMC = runMonteCarloWithGoal({
    monthlyInvestment,
    annualExpectedReturn: blendedReturnDecimal,
    annualVolatility: singleVol.stdDev,
    years,
    simulations: 2000,
    targetAmount,
    currentSavings: 100_000,
    inflationRate: 0.05,
  });

  // Verify valid probability in [0, 1]
  assert.ok(blendedPortfolioMC.goal_probability >= 0 && blendedPortfolioMC.goal_probability <= 1);

  // Lower volatility in blended portfolio provides a tighter, more reliable distribution for reaching the goal
  assert.ok(blendedPortfolioMC.p10[4] > equalReturnEquityMC.p10[4],
    'P10 downside outcome for blended portfolio must be higher than undiversified single asset at equal return due to lower volatility');
});

test('Stage 5 Optimizer / Goals glue: _getBlendedPortfolioMetrics returns decimal scale rates for reverseSIP and Monte Carlo', async () => {
  const { _getBlendedPortfolioMetrics } = await import('../routes/goals.js');
  const { reverseSIP } = await import('../services/monteCarloEngine.js');

  // No fallback return assumption is permitted when an authoritative recommendation is absent.
  await assert.rejects(
    _getBlendedPortfolioMetrics('507f1f77bcf86cd799439011', null, undefined, { instruments: [] }),
    error => error.code === 'RECOMMENDATION_REQUIRED',
  );

  // Test 2: Sanity check reverseSIP with decimal rate vs 100x buggy percentage rate
  const targetAmount = 1_000_000;
  const years = 5;
  const currentSavings = 100_000;
  const decimalRate = 0.103; // 10.3% decimal

  const saneSIP = reverseSIP(targetAmount, decimalRate, years, currentSavings);
  assert.ok(saneSIP > 5000 && saneSIP < 20000,
    `Required SIP (${saneSIP}) with decimal rate 0.103 must be realistic (₹5k - ₹20k/mo)`);

  assert.throws(() => reverseSIP(targetAmount, 10.3, years, currentSavings), /annualRate/);

  // Test 3: Sanity check Monte Carlo p50 output scale
  const mcDecimal = runMonteCarloWithGoal({
    monthlyInvestment: saneSIP,
    annualExpectedReturn: decimalRate,
    annualVolatility: 0.068,
    years,
    simulations: 500,
    targetAmount,
    currentSavings,
    inflationRate: 0.05,
  });
  assert.ok(mcDecimal.p50[4] > targetAmount * 0.8 && mcDecimal.p50[4] < targetAmount * 3.0,
    `Monte Carlo P50 (${mcDecimal.p50[4]}) must be realistic (< 3x target), not 2.7e+27`);

  assert.throws(() => runMonteCarloWithGoal({
    monthlyInvestment: saneSIP,
    annualExpectedReturn: 10.3,
    annualVolatility: 0.068,
    years,
    simulations: 500,
    targetAmount,
    currentSavings,
    inflationRate: 0.05,
  }), /annualExpectedReturn/);

  // Test 4: Direct test of main blended-weight branch of _getBlendedPortfolioMetrics with multi-instrument recommendation
  const mockRec = {
    instruments: [
      { name: 'Public Provident Fund', type: 'PPF', allocationWeight: 0.50, nominalReturn: 7.1, returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null },
      { name: 'Nifty 50 Index Fund', type: 'Equity_MF', allocationWeight: 0.25, nominalReturn: 14.5, returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null },
      { name: 'Invesco QQQ ETF', type: 'ETF', allocationWeight: 0.25, nominalReturn: 12.5, returnBasis: 'PRE_TAX_NOMINAL', postTaxReturn: null },
    ],
  };

  const mockMetrics = await _getBlendedPortfolioMetrics(null, null, undefined, mockRec);
  assert.ok(mockMetrics.expectedReturn > 0 && mockMetrics.expectedReturn < 1.0,
    `Main path blended expectedReturn (${mockMetrics.expectedReturn}) must be on DECIMAL scale (< 1.0, e.g. 0.103)`);
  assert.equal(mockMetrics.expectedReturn, 0.103);
  assert.ok(mockMetrics.volatility > 0 && mockMetrics.volatility < 0.10,
    `Main path blended volatility (${mockMetrics.volatility}) must be on DECIMAL scale and diversified (< 0.10)`);

  await assert.rejects(
    _getBlendedPortfolioMetrics(null, null, canonicalProfile(), {
      ...mockRec,
      modelVersion: 'model-4.0.0',
      profileInputHash: '0'.repeat(64),
    }),
    error => error.code === 'RECOMMENDATION_STALE',
  );
});
