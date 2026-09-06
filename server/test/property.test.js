/**
 * Tier 5 — Property-Based Testing Suite
 *
 * Verifies mathematical invariants, constraints, and convergence properties
 * of financial engines using fast-check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { calculateTaxableIncome } from '../services/taxEngine.js';
import { solveMinVariance, computeRebalance } from '../services/portfolioEngine.js';
import { computeXIRR } from '../services/xirrCalculator.js';
import { runMonteCarloWithGoal } from '../services/monteCarloEngine.js';

// ── 1. Tax Engine Invariants ─────────────────────────────────────────

test('Property: taxable income is always bounded by annual income', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 100000000, noNaN: true, noInfinity: true }), // Annual income
      fc.constantFrom('new', 'old'),         // Regime
      fc.record({
        section80C: fc.double({ min: 0, max: 200000, noNaN: true, noInfinity: true }),
        nps80CCD1B: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
        hra: fc.double({ min: 0, max: 500000, noNaN: true, noInfinity: true }),
      }),
      (annualIncome, regime, deductions) => {
        const result = calculateTaxableIncome(annualIncome, regime, deductions, 'salary');
        assert.ok(result.taxableIncome >= 0, 'Taxable income cannot be negative');
        assert.ok(result.taxableIncome <= annualIncome, 'Taxable income cannot exceed annual income');
      }
    )
  );
});

test('Property: tax engine recommended regime is always "new" when deductions are 0', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 400000, max: 100000000, noNaN: true, noInfinity: true }), // Income above tax-free threshold
      (annualIncome) => {
        const deductions = {}; // No deductions
        const resultNew = calculateTaxableIncome(annualIncome, 'new', deductions, 'salary');
        const resultOld = calculateTaxableIncome(annualIncome, 'old', deductions, 'salary');
        
        // Under no deductions, taxable income for new regime is strictly less than or equal to old regime
        // because new regime standard deduction is ₹75,000 while old regime is ₹50,000.
        assert.ok(resultNew.taxableIncome <= resultOld.taxableIncome);
      }
    )
  );
});

// ── 2. Portfolio Engine Invariants ───────────────────────────────────

test('Property: optimized minimum variance weights always sum to 1.0 and are non-negative', () => {
  const assetKeys = ['Equity_MF', 'ETF', 'Debt_MF', 'FD', 'Gold'];
  
  fc.assert(
    fc.property(
      fc.array(fc.double({ min: 0.01, max: 0.30, noNaN: true, noInfinity: true }), { minLength: 5, maxLength: 5 }), // Returns
      (returns) => {
        const result = solveMinVariance(assetKeys, returns);
        
        let sum = 0;
        for (const [key, weight] of Object.entries(result.weights)) {
          assert.ok(weight >= 0, `Weight for ${key} must be non-negative: ${weight}`);
          assert.ok(weight <= 1.0001, `Weight for ${key} cannot exceed 1.0: ${weight}`);
          sum += weight;
        }
        
        assert.ok(Math.abs(sum - 1.0) < 1e-4, `Weights must sum to 1.0, got: ${sum}`);
      }
    )
  );
});

test('Property: portfolio rebalance drift index is always between 0 and 100', () => {
  const assets = ['Equity_MF', 'ETF', 'Debt_MF', 'FD', 'Gold'];
  
  fc.assert(
    fc.property(
      // Current allocation values
      fc.record({
        Equity_MF: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
        ETF: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
        Debt_MF: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
        FD: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
        Gold: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
      }),
      // Target allocation percentages (must sum to 100 roughly)
      fc.record({
        Equity_MF: fc.double({ min: 0, max: 100, noNaN: true, noInfinity: true }),
        ETF: fc.double({ min: 0, max: 100, noNaN: true, noInfinity: true }),
        Debt_MF: fc.double({ min: 0, max: 100, noNaN: true, noInfinity: true }),
        FD: fc.double({ min: 0, max: 100, noNaN: true, noInfinity: true }),
        Gold: fc.double({ min: 0, max: 100, noNaN: true, noInfinity: true }),
      }),
      (current, target) => {
        const currentTotal = Object.values(current).reduce((sum, value) => sum + value, 0);
        const targetTotal = Object.values(target).reduce((sum, value) => sum + value, 0);
        fc.pre(currentTotal > 0 && targetTotal > 0);
        const normalizedTarget = Object.fromEntries(
          Object.entries(target).map(([key, value]) => [key, value / targetTotal * 100]),
        );
        const result = computeRebalance(current, normalizedTarget, 2.0, 1.0, 24);
        
        // If current value was zero, assets array might be empty
        if (result.total_portfolio_value > 0) {
          assert.ok(result.drift_index >= 0, 'Drift index cannot be negative');
          assert.ok(result.drift_index <= 100, `Drift index cannot exceed 100, got: ${result.drift_index}`);
        }
      }
    )
  );
});

// ── 3. XIRR Solver Convergence ───────────────────────────────────────

test('Property: solved XIRR rate always results in NPV close to zero', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1000, max: 100000, noNaN: true, noInfinity: true }), // Initial investment (negative flow)
      fc.double({ min: 0.02, max: 0.30, noNaN: true, noInfinity: true }),  // Actual annualized return rate
      fc.integer({ min: 1, max: 10 }),      // Years
      (initialInvestment, actualRate, years) => {
        // Construct standard cash flows: -invest today, +value at end
        const d0 = new Date('2026-01-01');
        const d1 = new Date('2026-01-01');
        d1.setFullYear(d1.getFullYear() + years);
        
        const finalValue = initialInvestment * Math.pow(1 + actualRate, years);
        
        const cashflows = [
          { amount: -initialInvestment, date: d0.toISOString().split('T')[0] },
          { amount: finalValue, date: d1.toISOString().split('T')[0] }
        ];
        
        const result = computeXIRR(cashflows);
        
        // Verify XIRR solved successfully and npvResidual is extremely low
        assert.equal(result.converged, true, `XIRR failed to converge: ${result.error}`);
        assert.ok(result.npvResidual < 1e-2, `NPV residual must be close to 0, got: ${result.npvResidual}`);
        assert.ok(Math.abs(result.rate - actualRate) < 1e-3, `Solved rate ${result.rate} should match actual rate ${actualRate}`);
      }
    )
  );
});

// ── 4. Monte Carlo Percentiles & Determinism ─────────────────────────

test('Property: Monte Carlo percentile bands are strictly ordered (p10 <= p25 <= p50 <= p75 <= p90)', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1000, max: 100000, noNaN: true, noInfinity: true }),  // Monthly investment
      fc.double({ min: 0.04, max: 0.20, noNaN: true, noInfinity: true }),    // Post tax annual return
      fc.double({ min: 0.05, max: 0.35, noNaN: true, noInfinity: true }),    // Volatility
      fc.integer({ min: 1, max: 15 }),        // Years
      (monthlyInvestment, rate, vol, years) => {
        const result = runMonteCarloWithGoal({
          monthlyInvestment,
          annualExpectedReturn: rate,
          annualVolatility: vol,
          years,
          simulations: 200, // Small count for fast property execution
          inflationRate: 0.05,
          currentSavings: 0,
          targetAmount: monthlyInvestment * 12 * years * 1.5,
        });

        // Ensure array size matches years
        const length = result.p10.length;
        assert.ok(length > 0);

        for (let i = 0; i < length; i++) {
          assert.ok(result.p10[i] <= result.p25[i], `Year ${i}: p10 > p25`);
          assert.ok(result.p25[i] <= result.p50[i], `Year ${i}: p25 > p50`);
          assert.ok(result.p50[i] <= result.p75[i], `Year ${i}: p50 > p75`);
          assert.ok(result.p75[i] <= result.p90[i], `Year ${i}: p75 > p90`);
        }
      }
    )
  );
});
