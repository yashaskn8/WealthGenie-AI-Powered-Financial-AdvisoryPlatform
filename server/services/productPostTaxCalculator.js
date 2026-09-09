/**
 * productPostTaxCalculator.js
 * 
 * WealthGenie Beginner-First Post-Tax Calculation & Product Metadata Enrichment Service
 * 
 * Responsibilities:
 * 1. Calculate defensible post-tax outcomes using the authoritative versioned taxEngine
 *    via the incremental tax method:
 *      baselineTax = computeTax(annualIncome)
 *      taxWithIncome = computeTax(annualIncome + productIncome)
 *      incrementalTax = taxWithIncome - baselineTax
 *      netGain = grossGain - incrementalTax
 *      postTaxReturnPct = (netGain / principal) * 100
 * 2. Never calculate tax in React.
 * 3. Never use a fake marginal-rate shortcut (rate * (1 - marginalRate)) that ignores progressive slabs.
 * 4. Never show exact future post-tax returns for mutual funds; label as HISTORICAL (not a forecast).
 * 5. Handle RBI FRSB correctly: "Current coupon after tax", disclaiming semiannual reset (never guaranteed 7-year).
 * 6. Handle PPF / SSY correctly: Section 10(11)/10(11A) EEE tax-free (incrementalTax = 0).
 * 7. Generate deterministic, plain-English "Why this fits you", risk tier, and access-to-money copy.
 */

import { computeTax } from './taxEngine.js';

export const POST_TAX_SERVICE_VERSION = 'product-post-tax-calculator-1.0.0';

/**
 * Classify product tax category from product DTO and parent category
 */
export function classifyProductTaxType(product, parentInstrumentId) {
  const id = String(parentInstrumentId || product?.parentInstrumentId || product?.id || '').toLowerCase();
  const name = String(product?.name || '').toLowerCase();
  const canonicalId = String(product?.canonicalProductId || '').toLowerCase();

  // EEE Exempt-Exempt-Exempt
  if (id === 'ppf' || canonicalId.includes('ppf') || name.includes('public provident fund')) {
    return 'EEE_TAX_FREE';
  }
  if (id === 'sukanya' || canonicalId.includes('sukanya') || name.includes('sukanya samriddhi')) {
    return 'EEE_TAX_FREE';
  }

  // RBI Floating Rate Savings Bonds
  if (id === 'rbi_bonds' || canonicalId.includes('rbi') || name.includes('floating rate savings bond')) {
    return 'RBI_FLOATING_RATE_BOND';
  }

  // Bank Fixed Deposits
  if (id === 'fd' || id === 'sbi_fd' || canonicalId.includes('sbi') || name.includes('fixed deposit') || name.includes('term deposit')) {
    return 'BANK_FIXED_DEPOSIT';
  }

  // Government Small Savings (Taxable at slab)
  if (['scss', 'nsc', 'kvp', 'pomis', 'po_rd', 'po_td_1yr'].includes(id) ||
      canonicalId.includes('nsc') || canonicalId.includes('scss') || canonicalId.includes('kvp') || canonicalId.includes('pomis')) {
    return 'GOVERNMENT_TAXABLE_SAVINGS';
  }

  // ELSS Mutual Funds (Section 80C + Section 112A)
  if (id === 'elss' || id === 'elss_mf' || name.includes('elss') || name.includes('tax saver')) {
    return 'EQUITY_MF_ELSS';
  }

  // Debt Mutual Funds (Section 50AA - slab rate STCG)
  if (id.includes('debt') || id.includes('liquid') || id.includes('gilt') || id.includes('corporate_bond') ||
      id.includes('banking_psu') || id.includes('dynamic_bond') || id.includes('credit_risk')) {
    return 'DEBT_MF_SECTION_50AA';
  }

  // Default for Mutual Funds: Equity LTCG (Section 112A)
  if (product?.productType === 'MUTUAL_FUND' || product?.historicalReturn || id.includes('mf') || id.includes('equity')) {
    return 'EQUITY_MF_SECTION_112A';
  }

  return 'STANDARD_TAXABLE';
}

/**
 * Calculate defensible after-tax outcome for a single product.
 * Returns postTaxAnalysis object.
 */
export function calculateProductPostTaxOutcome({ product, profile = {}, taxCalculationContext = null }) {
  const principal = Number(taxCalculationContext?.illustrativePrincipal) || 10000;
  const taxType = classifyProductTaxType(product, product?.parentInstrumentId);

  // 1. EEE Tax-Free Products (PPF, SSY) — Section 10(11) / 10(11A)
  if (taxType === 'EEE_TAX_FREE') {
    const annualRate = Number(product?.officialRate?.value);
    if (!Number.isFinite(annualRate) || annualRate <= 0) {
      return {
        status: 'UNAVAILABLE',
        illustrativePrincipal: principal,
        grossGain: null,
        incrementalTax: null,
        netGain: null,
        postTaxRatePct: null,
        metricLabel: 'Current after-tax rate',
        taxClassification: 'EEE_TAX_FREE',
        disclosure: 'Exempt under Section 10(11) / 10(11A) (EEE). Interest and maturity proceeds are 100% tax-free.',
        isHistoricalEstimate: false,
      };
    }

    const grossGain = Math.round(principal * (annualRate / 100));
    return {
      status: 'CALCULATED',
      illustrativePrincipal: principal,
      grossGain,
      incrementalTax: 0,
      netGain: grossGain,
      postTaxRatePct: Number(annualRate.toFixed(2)),
      metricLabel: 'Current after-tax rate',
      taxClassification: 'EEE_TAX_FREE',
      disclosure: 'Exempt under Section 10(11) / 10(11A) of the Income Tax Act (EEE status). 100% tax-free interest.',
      isHistoricalEstimate: false,
    };
  }

  // For all taxable products, we need explicit tax calculation context
  const annualIncome = Number(taxCalculationContext?.annualGrossIncome);
  const regime = taxCalculationContext?.regime;
  const fiscalYear = taxCalculationContext?.fiscalYear || 'FY2025-26';
  const incomeSource = taxCalculationContext?.incomeSource || 'salary';
  const _userAge = Number(taxCalculationContext?.userAge || profile?.age || 30);
  const deductions = taxCalculationContext?.deductions || {};

  // If explicit tax inputs are missing, do NOT calculate fake 0% or fail; invite user to add tax details
  if (!Number.isFinite(annualIncome) || !regime || !['new', 'old'].includes(regime)) {
    return {
      status: 'REQUIRES_TAX_INPUTS',
      illustrativePrincipal: principal,
      grossGain: null,
      incrementalTax: null,
      netGain: null,
      postTaxRatePct: null,
      metricLabel: taxType === 'RBI_FLOATING_RATE_BOND' ? 'Current coupon after tax' : 'After-tax return',
      taxClassification: taxType,
      disclosure: 'Add tax details (income and regime) to calculate your personalized after-tax return.',
      isHistoricalEstimate: product?.productType === 'MUTUAL_FUND',
      message: 'Add tax details to calculate your after-tax return',
    };
  }

  // 2. RBI Floating Rate Savings Bonds (RBI FRSB)
  if (taxType === 'RBI_FLOATING_RATE_BOND') {
    const annualRate = Number(product?.officialRate?.value);
    if (!Number.isFinite(annualRate) || annualRate <= 0) {
      return {
        status: 'UNAVAILABLE',
        illustrativePrincipal: principal,
        grossGain: null,
        incrementalTax: null,
        netGain: null,
        postTaxRatePct: null,
        metricLabel: 'Current coupon after tax',
        taxClassification: 'RBI_FLOATING_RATE_BOND',
        disclosure: 'Current coupon rate is unavailable.',
        isHistoricalEstimate: false,
      };
    }

    const grossGain = Math.round(principal * (annualRate / 100));
    const baseline = computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear);
    const withGain = computeTax(annualIncome + grossGain, regime, deductions, incomeSource, fiscalYear);
    const incrementalTax = Math.max(0, withGain.taxAmount - baseline.taxAmount);
    const netGain = Math.max(0, grossGain - incrementalTax);
    const postTaxRatePct = Number(Math.min(annualRate, (netGain / principal) * 100).toFixed(2));

    return {
      status: 'CALCULATED',
      illustrativePrincipal: principal,
      grossGain,
      incrementalTax,
      netGain,
      postTaxRatePct,
      metricLabel: 'Current coupon after tax',
      taxClassification: 'TAXABLE_SLAB_RATE',
      disclosure: 'Coupon resets every six months (1 Jan & 1 Jul), so future rates may differ. Not a guaranteed 7-year return.',
      isHistoricalEstimate: false,
    };
  }

  // 3. Bank Fixed Deposits & Taxable Government Savings
  if (taxType === 'BANK_FIXED_DEPOSIT' || taxType === 'GOVERNMENT_TAXABLE_SAVINGS' || taxType === 'STANDARD_TAXABLE') {
    const annualRate = Number(product?.officialRate?.value);
    if (!Number.isFinite(annualRate) || annualRate <= 0) {
      return {
        status: 'UNAVAILABLE',
        illustrativePrincipal: principal,
        grossGain: null,
        incrementalTax: null,
        netGain: null,
        postTaxRatePct: null,
        metricLabel: 'Current after-tax rate',
        taxClassification: 'TAXABLE_SLAB_RATE',
        disclosure: 'Official rate unavailable.',
        isHistoricalEstimate: false,
      };
    }

    const grossGain = Math.round(principal * (annualRate / 100));
    const baseline = computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear);
    const withGain = computeTax(annualIncome + grossGain, regime, deductions, incomeSource, fiscalYear);
    const incrementalTax = Math.max(0, withGain.taxAmount - baseline.taxAmount);
    const netGain = Math.max(0, grossGain - incrementalTax);
    const postTaxRatePct = Number(Math.min(annualRate, (netGain / principal) * 100).toFixed(2));

    return {
      status: 'CALCULATED',
      illustrativePrincipal: principal,
      grossGain,
      incrementalTax,
      netGain,
      postTaxRatePct,
      metricLabel: 'Current after-tax rate',
      taxClassification: 'TAXABLE_SLAB_RATE',
      disclosure: 'Calculated using your tax slab with backend incremental tax method. TDS may apply at source.',
      isHistoricalEstimate: false,
    };
  }

  // 4. Mutual Funds (AMFI) — Historical 1Y After-Tax Only
  if (product?.historicalReturn?.valuePct !== undefined && product?.historicalReturn?.valuePct !== null) {
    const historicalRate = Number(product.historicalReturn.valuePct);
    if (!Number.isFinite(historicalRate)) {
      return {
        status: 'UNAVAILABLE',
        illustrativePrincipal: principal,
        grossGain: null,
        incrementalTax: null,
        netGain: null,
        postTaxRatePct: null,
        metricLabel: 'Historical 1Y after-tax return',
        taxClassification: taxType,
        disclosure: 'Historical return is unavailable.',
        isHistoricalEstimate: true,
      };
    }

    const grossGain = Math.round(principal * (historicalRate / 100));

    // For Debt Mutual Funds under Section 50AA: Slab rate STCG
    if (taxType === 'DEBT_MF_SECTION_50AA') {
      if (grossGain <= 0) {
        return {
          status: 'CALCULATED',
          illustrativePrincipal: principal,
          grossGain,
          incrementalTax: 0,
          netGain: grossGain,
          postTaxRatePct: Number(historicalRate.toFixed(2)),
          metricLabel: 'Historical 1Y after-tax return',
          taxClassification: 'DEBT_MF_SECTION_50AA',
          disclosure: 'HISTORICAL — NOT A FORECAST. Taxed at your income tax slab rate under Section 50AA.',
          isHistoricalEstimate: true,
        };
      }

      const baseline = computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear);
      const withGain = computeTax(annualIncome + grossGain, regime, deductions, incomeSource, fiscalYear);
      const incrementalTax = Math.max(0, withGain.taxAmount - baseline.taxAmount);
      const netGain = Math.max(0, grossGain - incrementalTax);
      const postTaxRatePct = Number(Math.min(historicalRate, (netGain / principal) * 100).toFixed(2));

      return {
        status: 'CALCULATED',
        illustrativePrincipal: principal,
        grossGain,
        incrementalTax,
        netGain,
        postTaxRatePct,
        metricLabel: 'Historical 1Y after-tax return',
        taxClassification: 'DEBT_MF_SECTION_50AA',
        disclosure: 'HISTORICAL — NOT A FORECAST. Debt mutual fund gains are taxed at slab rates under Section 50AA.',
        isHistoricalEstimate: true,
      };
    }

    // For Equity Mutual Funds (Section 112A LTCG: 12.5% + 4% cess = 13.0%)
    if (grossGain <= 0) {
      return {
        status: 'CALCULATED',
        illustrativePrincipal: principal,
        grossGain,
        incrementalTax: 0,
        netGain: grossGain,
        postTaxRatePct: Number(historicalRate.toFixed(2)),
        metricLabel: 'Historical 1Y after-tax return',
        taxClassification: 'EQUITY_LTCG_SECTION_112A',
        disclosure: 'HISTORICAL — NOT A FORECAST. Negative or zero historical return incurs no capital gains tax.',
        isHistoricalEstimate: true,
      };
    }

    // Standard Section 112A equity LTCG rate is 12.5% + 4% cess = 13.0%
    const ltcgTaxRate = 0.13;
    const incrementalTax = Math.round(grossGain * ltcgTaxRate);
    const netGain = Math.max(0, grossGain - incrementalTax);
    const postTaxRatePct = Number(Math.min(historicalRate, (netGain / principal) * 100).toFixed(2));

    return {
      status: 'CALCULATED',
      illustrativePrincipal: principal,
      grossGain,
      incrementalTax,
      netGain,
      postTaxRatePct,
      metricLabel: 'Historical 1Y after-tax return',
      taxClassification: 'EQUITY_LTCG_SECTION_112A',
      disclosure: 'HISTORICAL — NOT A FORECAST. Assumes 12.5% LTCG + 4% cess under Section 112A for units held at least 1 year. Annual exemption up to ₹1.25L applies across total equity gains.',
      isHistoricalEstimate: true,
    };
  }

  return {
    status: 'REQUIRES_TAX_INPUTS',
    illustrativePrincipal: principal,
    grossGain: null,
    incrementalTax: null,
    netGain: null,
    postTaxRatePct: null,
    metricLabel: 'After-tax return',
    taxClassification: taxType,
    disclosure: 'Add tax details to calculate your after-tax return.',
    isHistoricalEstimate: product?.productType === 'MUTUAL_FUND',
    message: 'Add tax details to calculate your after-tax return',
  };
}

/**
 * Deterministically generate plain-English "Why this fits you", risk tier,
 * and access-to-money copy based on profile goals, horizon, and suitability.
 */
export function generateBeginnerSuitability({ product, profile = {}, parentCatalog = null }) {
  const parentId = String(product?.parentInstrumentId || parentCatalog?.id || '').toLowerCase();
  const canonicalId = String(product?.canonicalProductId || '').toLowerCase();
  const name = String(product?.name || '').toLowerCase();
  const goals = Array.isArray(profile?.investmentGoals) && profile.investmentGoals.length > 0
    ? profile.investmentGoals.join(' and ')
    : 'Wealth Growth';
  const horizon = profile?.investmentHorizonYears
    ? `${profile.investmentHorizonYears} years`
    : 'a multi-year investment horizon';
  const riskCapacity = profile?.finalSuitabilityRisk || profile?.riskTolerance || 'Moderate';

  // 1. Risk Tier
  let riskTier = 'Moderate Risk';
  if (['ppf', 'sukanya', 'scss', 'nsc', 'kvp', 'pomis', 'po_rd', 'po_td_1yr', 'fd', 'sbi_fd', 'rbi_bonds'].includes(parentId) ||
      canonicalId.includes('ppf') || canonicalId.includes('sbi') || canonicalId.includes('rbi') || canonicalId.includes('govt')) {
    riskTier = 'Very Low Risk';
  } else if (parentId.includes('liquid') || parentId.includes('debt') || parentId.includes('gilt') || parentId.includes('corporate_bond')) {
    riskTier = 'Low Risk';
  } else if (parentId.includes('hybrid') || parentId.includes('large_cap') || parentId.includes('index')) {
    riskTier = 'Moderate Risk';
  } else if (parentId.includes('mid') || parentId.includes('small') || parentId.includes('thematic') || parentId.includes('sector')) {
    riskTier = 'High Risk';
  }

  // 2. Access to Money (Liquidity)
  let accessToMoney = 'Easy access (redeem anytime, typically 1–3 business days)';
  if (parentId === 'ppf' || canonicalId.includes('ppf')) {
    accessToMoney = '15-year term (partial withdrawal permitted from year 7)';
  } else if (parentId === 'sukanya' || canonicalId.includes('sukanya')) {
    accessToMoney = 'Lock-in (until girl child turns 21 or marries after 18)';
  } else if (parentId === 'scss' || canonicalId.includes('scss')) {
    accessToMoney = '5-year term (extendable by 3 years)';
  } else if (parentId === 'nsc' || canonicalId.includes('nsc')) {
    accessToMoney = '5-year lock-in (payable at maturity)';
  } else if (parentId === 'kvp' || canonicalId.includes('kvp')) {
    accessToMoney = 'Lock-in (~115 months; premature exit allowed after 2.5 years)';
  } else if (parentId === 'pomis' || canonicalId.includes('pomis')) {
    accessToMoney = '5-year term (premature closure allowed with penalty after 1 year)';
  } else if (parentId === 'po_td_1yr' || canonicalId.includes('po_td')) {
    accessToMoney = '1-year fixed tenure (premature closure allowed after 6 months)';
  } else if (parentId === 'fd' || parentId === 'sbi_fd' || canonicalId.includes('sbi')) {
    const tenureLabel = product?.tenure?.label || 'selected tenure';
    accessToMoney = `Limited access (${tenureLabel}; premature withdrawal penalty applies)`;
  } else if (parentId === 'rbi_bonds' || canonicalId.includes('rbi')) {
    accessToMoney = '7-year lock-in (premature exit only for senior citizens age 60+)';
  } else if (parentId.includes('elss') || name.includes('elss')) {
    accessToMoney = '3-year lock-in (mandatory under Section 80C)';
  }

  // 3. Why this fits you (plain-English explanation)
  let whyThisFitsYou = '';
  if (parentId === 'ppf' || parentId === 'sukanya') {
    whyThisFitsYou = `Shown because you selected ${goals}. Backed by the Government of India with 100% sovereign safety and tax-free returns matching your conservative capital protection needs.`;
  } else if (parentId === 'rbi_bonds') {
    whyThisFitsYou = `Shown because you selected ${goals} with a ${horizon} horizon. Issued directly by the RBI with sovereign safety, paying a floating coupon that automatically resets every 6 months.`;
  } else if (parentId === 'fd' || parentId === 'sbi_fd') {
    whyThisFitsYou = `Shown because you selected ${goals}. SBI term deposits provide predictable, guaranteed returns backed by India's largest bank with DICGC insurance up to ₹5 lakh.`;
  } else if (parentId === 'scss') {
    whyThisFitsYou = `Shown because you selected ${goals}. Designed for senior citizens seeking high quarterly income with sovereign backing from the Government of India.`;
  } else if (['nsc', 'kvp', 'pomis'].includes(parentId)) {
    whyThisFitsYou = `Shown because you selected ${goals}. A dependable small-savings option backed by the Government of India for steady capital accumulation.`;
  } else if (parentId.includes('elss')) {
    whyThisFitsYou = `Shown because you selected ${goals}. Offers dual benefits of equity compounding and Section 80C tax deduction with the shortest lock-in (3 years) among tax-saving instruments.`;
  } else if (parentId.includes('debt') || parentId.includes('liquid') || parentId.includes('gilt')) {
    whyThisFitsYou = `Shown because you selected ${goals}. Provides liquidity and portfolio stability with lower price volatility, matching your ${riskCapacity} suitability tier.`;
  } else {
    whyThisFitsYou = `Shown because you selected ${goals}, have a ${horizon} investment horizon, and this category passed your ${riskCapacity}-risk suitability rules for long-term growth.`;
  }

  // 4. Verified Fact Label & Value
  let verifiedFactLabel = 'Verified Fact';
  let verifiedFactValue = 'Available';
  if (product?.officialRate?.value !== undefined && product?.officialRate?.value !== null) {
    const rateVal = Number(product.officialRate.value);
    if (parentId === 'rbi_bonds') {
      verifiedFactLabel = 'Current RBI bond coupon';
    } else if (parentId === 'fd' || parentId === 'sbi_fd') {
      verifiedFactLabel = 'Current official bank rate';
    } else {
      verifiedFactLabel = 'Current official rate';
    }
    verifiedFactValue = `${rateVal.toFixed(2)}% p.a.`;
  } else if (product?.historicalReturn?.valuePct !== undefined && product?.historicalReturn?.valuePct !== null) {
    const histVal = Number(product.historicalReturn.valuePct);
    verifiedFactLabel = 'Historical 1Y return';
    verifiedFactValue = `${histVal.toFixed(2)}% historical`;
  } else if (product?.nav?.value !== undefined && product?.nav?.value !== null) {
    const navVal = Number(product.nav.value);
    verifiedFactLabel = 'Current NAV';
    verifiedFactValue = `₹${navVal.toLocaleString('en-IN')}`;
  }

  // 5. Source Provider
  const sourceProvider = product?.source?.provider || product?.provider || 'Verified Official Source';

  return {
    whyThisFitsYou,
    riskTier,
    accessToMoney,
    verifiedFactLabel,
    verifiedFactValue,
    sourceProvider,
  };
}

/**
 * Enriches product DTOs with beginner suitability and defensible post-tax outcomes.
 */
export function enrichProductsWithPostTaxAndSuitability(products, { profile = {}, parentCatalog = null, taxCalculationContext = null }) {
  if (!Array.isArray(products)) return [];

  return products.map((product) => {
    const beginnerSuitability = generateBeginnerSuitability({ product, profile, parentCatalog });
    const postTaxAnalysis = calculateProductPostTaxOutcome({ product, profile, taxCalculationContext });

    return {
      ...product,
      beginnerSuitability,
      postTaxAnalysis,
      // If postTaxAnalysis calculated a valid post-tax rate, store it in postTaxReturn
      postTaxReturn: postTaxAnalysis.postTaxRatePct !== null ? postTaxAnalysis.postTaxRatePct : product.postTaxReturn,
    };
  });
}
