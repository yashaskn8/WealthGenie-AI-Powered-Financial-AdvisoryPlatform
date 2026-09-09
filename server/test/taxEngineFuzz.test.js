import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  computeTax as computeTaxForFiscalYear,
  compareTaxRegimes as compareTaxRegimesForFiscalYear,
} from '../services/taxEngine.js';

const computeTax = (income, regime, deductions, incomeSource) =>
  computeTaxForFiscalYear(income, regime, deductions, incomeSource, 'FY2026-27');
const compareTaxRegimes = (income, deductions, incomeSource) =>
  compareTaxRegimesForFiscalYear(income, deductions, incomeSource, 'FY2026-27');

test('PHASE 1.1 — Property-Based Adversarial Fuzzing of Tax Engine', async (t) => {

  await t.test('Property 1: Tax owed is never negative for any income, regime, and deduction payload', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100000000, noNaN: true, noInfinity: true }), // 0 to 10 Crore
        fc.constantFrom('new', 'old'),
        fc.record({
          section80C: fc.double({ min: 0, max: 300000, noNaN: true, noInfinity: true }),
          section80D: fc.double({ min: 0, max: 150000, noNaN: true, noInfinity: true }),
          nps80CCD1B: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
          nps80CCD2: fc.double({ min: 0, max: 500000, noNaN: true, noInfinity: true }),
          basicSalary: fc.double({ min: 0, max: 100000000, noNaN: true, noInfinity: true }),
          isGovtEmployee: fc.boolean(),
          hra: fc.double({ min: 0, max: 1000000, noNaN: true, noInfinity: true }),
          homeLoanInterest: fc.double({ min: 0, max: 500000, noNaN: true, noInfinity: true }),
          savingsInterest: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
          age: fc.integer({ min: 18, max: 95 }),
        }),
        fc.constantFrom('salary', 'pension', 'other'),
        (annualIncome, regime, deductions, incomeSource) => {
          const res = computeTax(annualIncome, regime, deductions, incomeSource);
          assert.ok(res.taxAmount >= 0, `Tax amount must be non-negative, got ${res.taxAmount} for income ${annualIncome}`);
          assert.ok(res.effectiveRate >= 0, `Effective rate must be non-negative, got ${res.effectiveRate}`);
          assert.ok(res.cess >= 0, `Cess must be non-negative, got ${res.cess}`);
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('Property 2: Tax owed never exceeds taxable income', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100000000, noNaN: true, noInfinity: true }),
        fc.constantFrom('new', 'old'),
        fc.record({
          section80C: fc.double({ min: 0, max: 150000, noNaN: true, noInfinity: true }),
          section80D: fc.double({ min: 0, max: 100000, noNaN: true, noInfinity: true }),
          age: fc.integer({ min: 18, max: 95 }),
        }),
        (annualIncome, regime, deductions) => {
          const res = computeTax(annualIncome, regime, deductions, 'salary');
          assert.ok(
            res.taxAmount <= res.taxableIncome + 1, // +1 margin for integer rounding
            `Tax amount (${res.taxAmount}) exceeds taxable income (${res.taxableIncome}) for annual income ${annualIncome}`
          );
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('Property 3: New Regime Section 87A marginal relief invariant (tax never exceeds excess over ₹12L)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1200001, max: 1350000, noNaN: true, noInfinity: true }), // Straddling New Regime 12L threshold
        (taxableIncome) => {
          // Zero out standard deduction effect by passing direct taxable salary
          const res = computeTax(taxableIncome + 75000, 'new', {}, 'salary');
          const excessOver12L = res.taxableIncome - 1200000;
          if (excessOver12L > 0) {
            // Pre-cess tax must not exceed excess income over 12L under Section 87A proviso
            assert.ok(
              res.taxBeforeCess <= excessOver12L + 1,
              `New regime taxBeforeCess (${res.taxBeforeCess}) exceeds excess income (${excessOver12L}) at taxableIncome ${res.taxableIncome}`
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('Property 4: Old Regime Section 87A Statutory Cliff (no marginal relief in Old Regime under Section 87A)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 500001, max: 600000, noNaN: true, noInfinity: true }), // Straddling Old Regime 5L threshold
        (taxableIncome) => {
          // Pass income with 50,000 standard deduction
          const res = computeTax(taxableIncome + 50000, 'old', {}, 'salary');
          if (res.taxableIncome > 500000) {
            // Old Regime has NO Section 87A marginal relief — tax at 500,001 must be at least ₹12,500 + 4% cess
            assert.ok(
              res.taxAmount >= 12500,
              `Old regime tax (${res.taxAmount}) failed statutory cliff at taxableIncome ${res.taxableIncome}. Old Regime does NOT have 87A marginal relief!`
            );
          }
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('Property 5: Surcharge Marginal Relief Invariant (tax increase <= income increase at threshold crossings)', () => {
    const thresholds = [5000000, 10000000, 20000000];
    fc.assert(
      fc.property(
        fc.constantFrom(...thresholds),
        fc.double({ min: 1, max: 200000, noNaN: true, noInfinity: true }), // Excess over surcharge threshold
        fc.constantFrom('new', 'old'),
        (threshold, delta, regime) => {
          const baseIncome = threshold + (regime === 'new' ? 75000 : 50000);
          const higherIncome = baseIncome + delta;

          const resBase = computeTax(baseIncome, regime, {}, 'salary');
          const resHigher = computeTax(higherIncome, regime, {}, 'salary');

          const taxDiff = resHigher.taxAmount - resBase.taxAmount;
          // Marginal relief mandates tax increase cannot exceed income increase plus cess on incremental tax
          const maxAllowedIncrease = Math.round(delta * 1.04) + 5; // 4% cess allowance + 5 rupee rounding buffer

          assert.ok(
            taxDiff <= maxAllowedIncrease,
            `Marginal relief violation at threshold ${threshold} + ${delta} (${regime}): tax increase (${taxDiff}) exceeds allowed increase (${maxAllowedIncrease})`
          );
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('Property 6: Zero-Deduction Regime Comparison (New Regime tax <= Old Regime tax)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100000000, noNaN: true, noInfinity: true }),
        (annualIncome) => {
          const comp = compareTaxRegimes(annualIncome, {}, 'salary');
          assert.ok(
            comp.newRegime.taxAmount <= comp.oldRegime.taxAmount,
            `Zero deduction violation at income ${annualIncome}: New regime tax (${comp.newRegime.taxAmount}) > Old regime tax (${comp.oldRegime.taxAmount})`
          );
        }
      ),
      { numRuns: 1000 }
    );
  });

  await t.test('Property 7: Income Monotonicity (Higher income in same regime never yields lower tax)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50000000, noNaN: true, noInfinity: true }),
        fc.double({ min: 100, max: 1000000, noNaN: true, noInfinity: true }),
        fc.constantFrom('new', 'old'),
        (incomeA, delta, regime) => {
          const incomeB = incomeA + delta;
          const resA = computeTax(incomeA, regime, {}, 'salary');
          const resB = computeTax(incomeB, regime, {}, 'salary');

          assert.ok(
            resB.taxAmount >= resA.taxAmount,
            `Monotonicity violation in ${regime} regime: Income ${incomeA} (tax: ${resA.taxAmount}) vs Income ${incomeB} (tax: ${resB.taxAmount})`
          );
        }
      ),
      { numRuns: 1000 }
    );
  });
});
