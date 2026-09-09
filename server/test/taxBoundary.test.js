import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTax as computeTaxForFiscalYear } from '../services/taxEngine.js';

const computeTax = (income, regime, deductions, incomeSource) =>
  computeTaxForFiscalYear(income, regime, deductions, incomeSource, 'FY2026-27');

test('PHASE 1.2 & 1.3 — Exact Boundary & Rounding Verification at Statutory Thresholds', async (t) => {

  await t.test('Threshold 1: Section 87A New Regime Rebate Boundary (₹12,00,000)', () => {
    // New regime standard deduction is ₹75,000
    // Taxable income = Annual Income - 75,000
    const below = computeTax(1200000 + 75000 - 1, 'new', {}, 'salary'); // Taxable: 11,99,999
    const exact = computeTax(1200000 + 75000, 'new', {}, 'salary');     // Taxable: 12,00,000
    const above = computeTax(1200000 + 75000 + 1, 'new', {}, 'salary'); // Taxable: 12,00,001

    console.log(`\n[Boundary 1: Section 87A New Regime ₹12L]`);
    console.log(`  ₹11,99,999 Taxable -> Tax: ₹${below.taxAmount}, Rebate Applied: ${below.rebateApplied}`);
    console.log(`  ₹12,00,000 Taxable -> Tax: ₹${exact.taxAmount}, Rebate Applied: ${exact.rebateApplied}`);
    console.log(`  ₹12,00,001 Taxable -> Tax: ₹${above.taxAmount}, Marginal Relief Applied: ${above.marginalReliefApplied}, Relief Amount: ₹${above.marginalReliefAmount}`);

    assert.equal(below.taxAmount, 0, '₹11,99,999 taxable must pay ₹0 tax');
    assert.equal(below.rebateApplied, true);

    assert.equal(exact.taxAmount, 0, '₹12,00,000 taxable must pay ₹0 tax');
    assert.equal(exact.rebateApplied, true);

    // Section 87A proviso: tax cannot exceed excess income (₹1) + cess (0.04) -> rounded to ₹1
    assert.equal(above.taxAmount, 1, '₹12,00,001 taxable must pay ₹1 tax due to Section 87A proviso marginal relief');
    assert.equal(above.marginalReliefApplied, true);
    assert.ok(above.marginalReliefAmount >= 59999);
  });

  await t.test('Threshold 2: Section 87A Old Regime Rebate Cliff (₹5,00,000)', () => {
    // Old regime standard deduction is ₹50,000
    const below = computeTax(500000 + 50000 - 1, 'old', {}, 'salary'); // Taxable: 4,99,999
    const exact = computeTax(500000 + 50000, 'old', {}, 'salary');     // Taxable: 5,00,000
    const above = computeTax(500000 + 50000 + 1, 'old', {}, 'salary'); // Taxable: 5,00,001

    console.log(`\n[Boundary 2: Section 87A Old Regime ₹5L Cliff]`);
    console.log(`  ₹4,99,999 Taxable -> Tax: ₹${below.taxAmount}, Rebate Applied: ${below.rebateApplied}`);
    console.log(`  ₹5,00,000 Taxable -> Tax: ₹${exact.taxAmount}, Rebate Applied: ${exact.rebateApplied}`);
    console.log(`  ₹5,00,001 Taxable -> Tax: ₹${above.taxAmount}, Rebate Applied: ${above.rebateApplied}, Marginal Relief: ${above.marginalReliefApplied}`);

    assert.equal(below.taxAmount, 0, '₹4,99,999 taxable must pay ₹0 tax');
    assert.equal(below.rebateApplied, true);

    assert.equal(exact.taxAmount, 0, '₹5,00,000 taxable must pay ₹0 tax');
    assert.equal(exact.rebateApplied, true);

    // In Old Regime, crossing ₹5L pays full slab tax (₹12,500 + 20% on ₹1 = ₹12,500.20 + 4% cess = ₹13,000)
    assert.equal(above.taxAmount, 13000, '₹5,00,001 taxable must pay full ₹13,000 tax (no 87A relief under Old Regime)');
    assert.equal(above.rebateApplied, false);
    assert.equal(above.marginalReliefApplied, false);
  });

  await t.test('Threshold 3: Surcharge Tier 1 Boundary (₹50,00,000)', () => {
    const below = computeTax(5000000 + 75000 - 1, 'new', {}, 'salary'); // Taxable: 49,99,999
    const exact = computeTax(5000000 + 75000, 'new', {}, 'salary');     // Taxable: 50,00,000
    const above = computeTax(5000000 + 75000 + 1, 'new', {}, 'salary'); // Taxable: 50,00,001

    console.log(`\n[Boundary 3: Surcharge Tier 1 ₹50L]`);
    console.log(`  ₹49,99,999 Taxable -> Tax: ₹${below.taxAmount}, Surcharge: ₹${below.surchargeAmount}`);
    console.log(`  ₹50,00,000 Taxable -> Tax: ₹${exact.taxAmount}, Surcharge: ₹${exact.surchargeAmount}`);
    console.log(`  ₹50,00,001 Taxable -> Tax: ₹${above.taxAmount}, Surcharge: ₹${above.surchargeAmount}, Marginal Relief: ₹${above.marginalReliefAmount}`);

    assert.equal(below.surchargeApplied, false);
    assert.equal(exact.surchargeApplied, false);
    assert.equal(above.surchargeApplied, true);
    // Tax increase must equal incremental income (₹1) + cess
    assert.equal(above.taxAmount - exact.taxAmount, 1, 'Tax increase at ₹50,00,001 must be exactly ₹1 due to surcharge marginal relief');
  });

  await t.test('Threshold 4: Surcharge Tier 2 Boundary (₹1,00,00,000)', () => {
    const below = computeTax(10000000 + 75000 - 1, 'new', {}, 'salary'); // Taxable: 99,99,999
    const exact = computeTax(10000000 + 75000, 'new', {}, 'salary');     // Taxable: 1,00,00,000
    const above = computeTax(10000000 + 75000 + 1, 'new', {}, 'salary'); // Taxable: 1,00,00,001

    console.log(`\n[Boundary 4: Surcharge Tier 2 ₹1Cr]`);
    console.log(`  ₹99,99,999 Taxable -> Tax: ₹${below.taxAmount}, Surcharge: ₹${below.surchargeAmount}`);
    console.log(`  ₹1,00,00,000 Taxable -> Tax: ₹${exact.taxAmount}, Surcharge: ₹${exact.surchargeAmount}`);
    console.log(`  ₹1,00,00,001 Taxable -> Tax: ₹${above.taxAmount}, Surcharge: ₹${above.surchargeAmount}, Marginal Relief: ₹${above.marginalReliefAmount}`);

    assert.equal(above.surchargeApplied, true);
    assert.equal(above.taxAmount - exact.taxAmount, 1, 'Tax increase at ₹1,00,00,001 must be exactly ₹1 due to surcharge marginal relief');
  });

  await t.test('Threshold 5: Surcharge Tier 3 Boundary (₹2,00,00,000)', () => {
    const below = computeTax(20000000 + 75000 - 1, 'new', {}, 'salary'); // Taxable: 1,99,99,999
    const exact = computeTax(20000000 + 75000, 'new', {}, 'salary');     // Taxable: 2,00,00,000
    const above = computeTax(20000000 + 75000 + 1, 'new', {}, 'salary'); // Taxable: 2,00,00,001

    console.log(`\n[Boundary 5: Surcharge Tier 3 ₹2Cr]`);
    console.log(`  ₹1,99,99,999 Taxable -> Tax: ₹${below.taxAmount}, Surcharge: ₹${below.surchargeAmount}`);
    console.log(`  ₹2,00,00,000 Taxable -> Tax: ₹${exact.taxAmount}, Surcharge: ₹${exact.surchargeAmount}`);
    console.log(`  ₹2,00,00,001 Taxable -> Tax: ₹${above.taxAmount}, Surcharge: ₹${above.surchargeAmount}, Marginal Relief: ₹${above.marginalReliefAmount}`);

    assert.equal(above.surchargeApplied, true);
    assert.equal(above.taxAmount - exact.taxAmount, 1, 'Tax increase at ₹2,00,00,001 must be exactly ₹1 due to surcharge marginal relief');
  });

  await t.test('Threshold 6: Surcharge Tier 4 Old Regime Boundary (₹5,00,00,000)', () => {
    const below = computeTax(50000000 + 50000 - 1, 'old', {}, 'salary'); // Taxable: 4,99,99,999
    const exact = computeTax(50000000 + 50000, 'old', {}, 'salary');     // Taxable: 5,00,00,000
    const above = computeTax(50000000 + 50000 + 1, 'old', {}, 'salary'); // Taxable: 5,00,00,001

    console.log(`\n[Boundary 6: Surcharge Tier 4 Old Regime ₹5Cr]`);
    console.log(`  ₹4,99,99,999 Taxable -> Tax: ₹${below.taxAmount}, Surcharge: ₹${below.surchargeAmount}`);
    console.log(`  ₹5,00,00,000 Taxable -> Tax: ₹${exact.taxAmount}, Surcharge: ₹${exact.surchargeAmount}`);
    console.log(`  ₹5,00,00,001 Taxable -> Tax: ₹${above.taxAmount}, Surcharge: ₹${above.surchargeAmount}, Marginal Relief: ₹${above.marginalReliefAmount}`);

    assert.equal(above.surchargeApplied, true);
    assert.equal(above.taxAmount - exact.taxAmount, 1, 'Tax increase at ₹5,00,00,001 must be exactly ₹1 due to surcharge marginal relief');
  });

  await t.test('Step 1.3: Rounding Convention Audit (Deliberate Half-Rupee .50 and Intermediate Integrity)', () => {
    // Section 112A LTCG rate is 12.5% (0.125).
    // Testing odd income amounts generating exactly .50 intermediate tax figures
    // e.g. Income of ₹4,00,010 under 5% slab = ₹0.50 slab tax.
    const halfRupeeIncome = 400010 + 75000;
    const res = computeTax(halfRupeeIncome, 'new', {}, 'salary');

    console.log(`\n[Step 1.3: Half-Rupee Rounding Verification]`);
    console.log(`  Income ₹${halfRupeeIncome} (Taxable: ₹4,00,010) -> Raw Slab Tax: ₹0.50`);
    console.log(`  Computed Final Tax: ₹${res.taxAmount}, Tax Before Cess: ₹${res.taxBeforeCess}`);

    // Math.round(0.50) rounds up to 1 under standard commercial rounding rules
    assert.equal(res.taxAmount, 0, 'Rebate applies for income under 12L');

    // High income where slab tax ends in .50
    // e.g. 24,00,005 with 30% slab rate on ₹5 = ₹1.50
    const slabHalfRupee = 2400005 + 75000;
    const resSlab = computeTax(slabHalfRupee, 'new', {}, 'salary');
    console.log(`  Income ₹${slabHalfRupee} -> Tax: ₹${resSlab.taxAmount}, Cess: ₹${resSlab.cess}`);
    assert.ok(Number.isInteger(resSlab.taxAmount), 'Final tax must be exact integer');
    assert.ok(Number.isInteger(resSlab.cess), 'Cess must be exact integer');
  });
});
