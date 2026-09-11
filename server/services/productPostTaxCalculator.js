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

import {
  classifyHoldingPeriodByDates,
  computeEquityCapitalGainsTax,
  computeTax,
  getCurrentFiscalYear,
  getCapitalGainsHoldingPeriodMonths,
  getTaxPolicyMetadata,
} from './taxEngine.js';
import {
  classifySourceQualifiedProductTaxType,
  getProductTaxMetadata,
  getRequiredTaxInputs,
  POST_TAX_CALCULATION_CLASSES,
  PRODUCT_TAX_CLASSES,
  PRODUCT_TAX_STATUSES,
} from './productTaxAuthority.js';

export const POST_TAX_SERVICE_VERSION = 'product-post-tax-calculator-2.0.0';

/**
 * Classify product tax category from product DTO and parent category
 */
export function classifyProductTaxType(product, parentInstrumentId) {
  return classifySourceQualifiedProductTaxType(
    product,
    parentInstrumentId || product?.parentInstrumentId,
  );
}

function createAnalysis({
  status,
  taxMetadata,
  policy = null,
  fiscalYear = null,
  policyVersion = null,
  principal,
  grossGain = null,
  taxableGain = null,
  exemptionApplied = null,
  incrementalTax = null,
  cess = null,
  surcharge = null,
  netGain = null,
  postTaxRatePct = null,
  calculationClass = POST_TAX_CALCULATION_CLASSES.CURRENT_RATE_POST_TAX_ILLUSTRATION,
  inputBasis = 'PROVIDER_FACT',
  holdingPeriodBasis = null,
  dataClass = 'PROVIDER_FACT',
  assumptions = [],
  unavailableReasons = [],
  requiredTaxInputs = [],
  metricLabel = 'After-tax result',
  disclosure = null,
  message = null,
  isHistoricalEstimate = false,
  historicalObservationWindowMonths = null,
  rulesApplied = [],
}) {
  const sourceReferences = [];
  const seenReferences = new Set();
  const addReferences = (references, fallbackRole) => {
    for (const source of Array.isArray(references) ? references : []) {
      if (!source || typeof source !== 'object') continue;
      const normalized = {
        ...source,
        role: source.role || fallbackRole,
      };
      const key = [normalized.authority, normalized.title, normalized.url, normalized.role]
        .map(value => String(value ?? '')).join('|');
      if (seenReferences.has(key)) continue;
      seenReferences.add(key);
      sourceReferences.push(normalized);
    }
  };
  addReferences(taxMetadata?.sourceReferences, 'PRODUCT_RULE');
  addReferences(policy?.sourceReferences, 'TAX_POLICY');

  return {
    status,
    calculationClass,
    taxClass: taxMetadata?.taxClass || null,
    taxClassification: taxMetadata?.taxClass || null,
    fiscalYear,
    policyVersion,
    inputBasis,
    principal,
    illustrativePrincipal: principal,
    grossGain,
    taxableGain,
    exemptionApplied,
    incrementalTax,
    cess,
    surcharge,
    netGain,
    postTaxRatePct,
    holdingPeriodBasis,
    dataClass,
    assumptions,
    unavailableReasons,
    sourceReferences,
    rulesApplied: [
      ...(taxMetadata?.rulesApplied || []),
      ...rulesApplied,
    ],
    requiredTaxInputs,
    metricLabel,
    disclosure,
    message,
    isHistoricalEstimate,
    historicalObservationWindowMonths,
  };
}

function getPrincipal(taxCalculationContext) {
  const supplied = Number(taxCalculationContext?.illustrativePrincipal);
  return Number.isFinite(supplied) && supplied > 0 ? supplied : 10000;
}

function getTaxPolicyOrUnavailable(fiscalYear) {
  try {
    return { policy: getTaxPolicyMetadata(fiscalYear), unavailable: null };
  } catch (error) {
    if (error?.code === 'FISCAL_YEAR_UNSUPPORTED' || error instanceof RangeError) {
      return { policy: null, unavailable: 'FISCAL_YEAR_UNSUPPORTED' };
    }
    throw error;
  }
}

function missingRequiredTaxInputs(taxCalculationContext, requiredTaxInputs) {
  const context = taxCalculationContext || {};
  const hasBothExactDates = Boolean(context.acquisitionDate && context.redemptionDate);
  const hasPartialExactDates = Boolean(context.acquisitionDate || context.redemptionDate) && !hasBothExactDates;
  return requiredTaxInputs.filter(key => {
    if (key === 'annualGrossIncome') return !Number.isFinite(Number(context.annualGrossIncome));
    if (key === 'userAge') return !Number.isInteger(Number(context.userAge)) || Number(context.userAge) < 18 || Number(context.userAge) > 120;
    if (key === 'holdingPeriodMonths') return hasBothExactDates
      ? false
      : !Number.isFinite(Number(context.holdingPeriodMonths));
    if (key === 'section112AExemptionUsed') return !Number.isFinite(Number(context.section112AExemptionUsed));
    return context[key] === undefined || context[key] === null || context[key] === '';
  }).concat(hasPartialExactDates ? ['acquisitionDate', 'redemptionDate'] : []);
}

function taxContextValues(taxCalculationContext) {
  const userAge = Number(taxCalculationContext?.userAge);
  const deductions = { ...(taxCalculationContext?.deductions || {}) };
  if (Number.isInteger(userAge) && userAge >= 18 && userAge <= 120) deductions.age = userAge;
  return {
    annualIncome: Number(taxCalculationContext?.annualGrossIncome),
    regime: taxCalculationContext?.regime,
    fiscalYear: taxCalculationContext?.fiscalYear,
    incomeSource: taxCalculationContext?.incomeSource,
    userAge: Number.isInteger(userAge) ? userAge : null,
    deductions,
  };
}

/**
 * Calculate defensible after-tax outcome for a single product.
 * Returns postTaxAnalysis object.
 */
export function calculateProductPostTaxOutcome({ product, profile: _profile = {}, taxCalculationContext = null }) {
  const principal = getPrincipal(taxCalculationContext);
  const parentInstrumentId = product?.parentInstrumentId;
  const taxMetadata = getProductTaxMetadata(product, parentInstrumentId);
  const taxType = taxMetadata.taxClass;
  const requiredTaxInputs = getRequiredTaxInputs(taxType);
  const assumptions = taxCalculationContext?.illustrativePrincipal
    ? []
    : ['ILLUSTRATIVE_PRINCIPAL_DEFAULT_10000'];
  if (taxCalculationContext && taxCalculationContext.deductions === undefined && taxType) {
    assumptions.push('DEDUCTIONS_NOT_SUPPLIED; NO_DEDUCTION_ASSUMPTION_USED');
  }

  if (!taxMetadata.sourceQualified || !taxType) {
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.TAX_CLASSIFICATION_UNAVAILABLE,
      taxMetadata,
      principal,
      calculationClass: POST_TAX_CALCULATION_CLASSES.CURRENT_RATE_POST_TAX_ILLUSTRATION,
      dataClass: 'UNAVAILABLE',
      assumptions,
      unavailableReasons: [taxMetadata.unavailableReason || 'TAX_CLASSIFICATION_UNAVAILABLE'],
      disclosure: 'The qualified provider did not supply a tax classification for this product. No post-tax result is shown.',
    });
  }

  const fiscalYear = taxCalculationContext?.fiscalYear || getCurrentFiscalYear();
  const { policy, unavailable } = getTaxPolicyOrUnavailable(fiscalYear);
  if (unavailable) {
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.FISCAL_YEAR_UNSUPPORTED,
      taxMetadata,
      fiscalYear,
      principal,
      requiredTaxInputs,
      assumptions,
      unavailableReasons: [unavailable],
      disclosure: 'The requested fiscal-year tax policy is not verified by the backend.',
    });
  }

  const annualRate = Number(product?.officialRate?.value);
  const isEee = [PRODUCT_TAX_CLASSES.PPF_EEE, PRODUCT_TAX_CLASSES.SSY_EEE].includes(taxType);
  if (isEee) {
    if (!Number.isFinite(annualRate) || annualRate <= 0) {
      return createAnalysis({
        status: PRODUCT_TAX_STATUSES.PRODUCT_FACTS_UNAVAILABLE,
        taxMetadata,
        policy,
        fiscalYear,
        policyVersion: policy.policyVersion,
        principal,
        dataClass: 'UNAVAILABLE',
        assumptions,
        unavailableReasons: ['CURRENT_OFFICIAL_RATE_UNAVAILABLE'],
        metricLabel: 'Current after-tax rate',
        disclosure: 'The current official rate is unavailable.',
      });
    }
    const grossGain = Math.round(principal * (annualRate / 100));
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.CALCULATED,
      taxMetadata,
      policy,
      fiscalYear,
      policyVersion: policy.policyVersion,
      principal,
      grossGain,
      taxableGain: 0,
      exemptionApplied: grossGain,
      incrementalTax: 0,
      cess: 0,
      surcharge: 0,
      netGain: grossGain,
      postTaxRatePct: Number(annualRate.toFixed(2)),
      assumptions,
      metricLabel: 'Current after-tax rate',
      disclosure: 'Current provider rate illustration. The qualified scheme treatment is tax-exempt under the cited official source; this is not a full-tenure maturity IRR.',
      rulesApplied: ['CURRENT_RATE_ONLY_NOT_FULL_TENURE_IRR'],
    });
  }

  const missingInputs = missingRequiredTaxInputs(taxCalculationContext, requiredTaxInputs);
  if (missingInputs.length > 0) {
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.REQUIRES_TAX_INPUTS,
      taxMetadata,
      policy,
      fiscalYear: taxCalculationContext?.fiscalYear || null,
      principal,
      requiredTaxInputs: missingInputs,
      assumptions,
      unavailableReasons: [],
      metricLabel: taxType === PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST
        ? 'Current coupon after tax'
        : 'After-tax result',
      disclosure: 'Add the backend-declared tax inputs to calculate this result.',
      message: 'Additional tax inputs are required for this product.',
      isHistoricalEstimate: taxType.includes('MF'),
    });
  }

  const { annualIncome, regime, incomeSource, userAge, deductions } = taxContextValues(taxCalculationContext);
  if ([PRODUCT_TAX_CLASSES.BANK_DEPOSIT_INTEREST, PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST].includes(taxType)) {
    if (!Number.isFinite(annualRate) || annualRate <= 0) {
      return createAnalysis({
        status: PRODUCT_TAX_STATUSES.PRODUCT_FACTS_UNAVAILABLE,
        taxMetadata,
        policy,
        fiscalYear,
        policyVersion: policy.policyVersion,
        principal,
        requiredTaxInputs,
        dataClass: 'UNAVAILABLE',
        assumptions,
        unavailableReasons: ['CURRENT_OFFICIAL_RATE_UNAVAILABLE'],
        metricLabel: taxType === PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST
          ? 'Current coupon after tax'
          : 'Current after-tax rate',
      });
    }
    const grossGain = Math.round(principal * (annualRate / 100));
    const baseline = computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear, userAge);
    const withGain = computeTax(annualIncome + grossGain, regime, deductions, incomeSource, fiscalYear, userAge);
    const incrementalTax = Math.max(0, withGain.taxAmount - baseline.taxAmount);
    const netGain = grossGain - incrementalTax;
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.CALCULATED,
      taxMetadata,
      policy,
      fiscalYear,
      policyVersion: policy.policyVersion,
      principal,
      grossGain,
      taxableGain: grossGain,
      exemptionApplied: 0,
      incrementalTax,
      cess: Math.max(0, withGain.cess - baseline.cess),
      surcharge: Math.max(0, withGain.surchargeAmount - baseline.surchargeAmount),
      netGain,
      postTaxRatePct: Number(((netGain / principal) * 100).toFixed(2)),
      assumptions: [...assumptions, 'INCREMENTAL_TAX_BASELINE_AND_WITH_PRODUCT_INCOME'],
      metricLabel: taxType === PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST
        ? 'Current coupon after tax'
        : 'Current after-tax rate',
      disclosure: taxType === PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST
        ? 'Current coupon after-tax illustration. Coupon resets every six months (1 Jan and 1 Jul); it is not a fixed 7-year return or maturity IRR. TDS is withholding, not an additional final tax.'
        : 'Current annual rate after incremental tax using the backend tax policy. TDS, where applicable, is withholding at source and is not added as a second tax charge.',
      rulesApplied: ['CURRENT_RATE_ONLY_NOT_FULL_TENURE_IRR'],
    });
  }

  const historicalRate = Number(product?.historicalReturn?.valuePct);
  if (!Number.isFinite(historicalRate)) {
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.PRODUCT_FACTS_UNAVAILABLE,
      taxMetadata,
      policy,
      fiscalYear,
      policyVersion: policy.policyVersion,
      principal,
      requiredTaxInputs,
      dataClass: 'UNAVAILABLE',
      assumptions,
      unavailableReasons: ['QUALIFIED_HISTORICAL_RETURN_UNAVAILABLE'],
      metricLabel: 'Historical 1Y after-tax return',
      isHistoricalEstimate: true,
    });
  }
  const grossGain = Math.round(principal * (historicalRate / 100));
  const holdingPeriodMonths = Number(taxCalculationContext.holdingPeriodMonths);
  let holdingPeriodBasis = 'MODELLED_HOLDING_PERIOD';
  let holdingPeriodClassification = null;
  if ([PRODUCT_TAX_CLASSES.EQUITY_MF_112A, PRODUCT_TAX_CLASSES.EQUITY_MF_ELSS].includes(taxType)
      && (taxCalculationContext.acquisitionDate || taxCalculationContext.redemptionDate)) {
    if (!taxCalculationContext.acquisitionDate || !taxCalculationContext.redemptionDate) {
      return createAnalysis({
        status: PRODUCT_TAX_STATUSES.REQUIRES_TAX_INPUTS,
        taxMetadata,
        policy,
        fiscalYear,
        policyVersion: policy.policyVersion,
        principal,
        requiredTaxInputs: ['acquisitionDate', 'redemptionDate'],
        assumptions,
        disclosure: 'Both exact transaction dates are required to classify the holding period.',
        message: 'Acquisition and redemption dates are required together.',
        isHistoricalEstimate: true,
      });
    }
    const dateClassification = classifyHoldingPeriodByDates({
      acquisitionDate: taxCalculationContext.acquisitionDate,
      redemptionDate: taxCalculationContext.redemptionDate,
      thresholdMonths: getCapitalGainsHoldingPeriodMonths(fiscalYear, 'listed'),
    });
    holdingPeriodClassification = dateClassification;
    holdingPeriodBasis = dateClassification.holdingPeriodBasis;
  }

  if (taxType === PRODUCT_TAX_CLASSES.DEBT_MF_50AA) {
    const baseline = computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear, userAge);
    const withGain = computeTax(annualIncome + grossGain, regime, deductions, incomeSource, fiscalYear, userAge);
    const incrementalTax = Math.max(0, withGain.taxAmount - baseline.taxAmount);
    const netGain = grossGain - incrementalTax;
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.CALCULATED,
      taxMetadata,
      policy,
      fiscalYear,
      policyVersion: policy.policyVersion,
      principal,
      grossGain,
      taxableGain: grossGain,
      exemptionApplied: 0,
      incrementalTax,
      cess: Math.max(0, withGain.cess - baseline.cess),
      surcharge: Math.max(0, withGain.surchargeAmount - baseline.surchargeAmount),
      netGain,
      postTaxRatePct: Number(((netGain / principal) * 100).toFixed(2)),
      calculationClass: POST_TAX_CALCULATION_CLASSES.HISTORICAL_RETURN_POST_TAX_ILLUSTRATION,
      inputBasis: 'HISTORICAL_PROVIDER_FACT_PLUS_EXPLICIT_TAX_INPUTS',
      holdingPeriodBasis,
      dataClass: 'HISTORICAL_PROVIDER_FACT',
      assumptions: [...assumptions, 'HISTORICAL_RETURN_IS_NOT_A_FORECAST'],
      metricLabel: 'Historical 1Y after-tax return',
      historicalObservationWindowMonths: 12,
      disclosure: 'HISTORICAL — NOT A FORECAST. Qualified Section 50AA metadata establishes slab treatment; the comparison uses the explicit holding period and current tax inputs. No future return is claimed.',
      isHistoricalEstimate: true,
    });
  }

  if (![PRODUCT_TAX_CLASSES.EQUITY_MF_112A, PRODUCT_TAX_CLASSES.EQUITY_MF_ELSS].includes(taxType)) {
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.TAX_CLASSIFICATION_UNAVAILABLE,
      taxMetadata,
      policy,
      fiscalYear,
      policyVersion: policy.policyVersion,
      principal,
      requiredTaxInputs,
      dataClass: 'UNAVAILABLE',
      assumptions,
      unavailableReasons: ['TAX_CLASSIFICATION_UNAVAILABLE'],
      isHistoricalEstimate: true,
    });
  }

  const capitalGains = computeEquityCapitalGainsTax({
    grossGain,
    holdingPeriodMonths,
    annualIncome,
    regime,
    deductions,
    incomeSource,
    fiscalYear,
    userAge,
    section112AExemptionUsed: Number(taxCalculationContext.section112AExemptionUsed),
    holdingPeriodClassification,
  });
  if (capitalGains.status !== 'CALCULATED') {
    return createAnalysis({
      status: PRODUCT_TAX_STATUSES.UNAVAILABLE,
      taxMetadata,
      policy,
      fiscalYear,
      policyVersion: policy.policyVersion,
      principal,
      grossGain,
      taxableGain: capitalGains.taxableGain,
      exemptionApplied: capitalGains.exemptionApplied,
      requiredTaxInputs,
      dataClass: 'UNAVAILABLE',
      assumptions: [...assumptions, 'SPECIAL_RATE_BUCKET_REQUIRES_COMPLETE_HIGH_INCOME_CONTEXT'],
      unavailableReasons: capitalGains.unavailableReasons,
      metricLabel: 'Historical after-tax return',
      isHistoricalEstimate: true,
    });
  }
  const netGain = grossGain - capitalGains.taxAmount;
  return createAnalysis({
    status: PRODUCT_TAX_STATUSES.CALCULATED,
    taxMetadata,
    policy,
    fiscalYear,
    policyVersion: policy.policyVersion,
    principal,
    grossGain,
    taxableGain: capitalGains.taxableGain,
    exemptionApplied: capitalGains.exemptionApplied,
    incrementalTax: capitalGains.taxAmount,
    cess: capitalGains.cess,
    surcharge: capitalGains.surcharge,
    netGain,
    postTaxRatePct: Number(((netGain / principal) * 100).toFixed(2)),
    calculationClass: POST_TAX_CALCULATION_CLASSES.HISTORICAL_RETURN_POST_TAX_ILLUSTRATION,
    inputBasis: 'HISTORICAL_PROVIDER_FACT_PLUS_EXPLICIT_TAX_INPUTS',
    holdingPeriodBasis: holdingPeriodBasis === 'EXACT_TRANSACTION_DATES'
      ? holdingPeriodBasis
      : capitalGains.holdingPeriodBasis,
    dataClass: 'HISTORICAL_PROVIDER_FACT',
    assumptions: [...assumptions, 'HISTORICAL_RETURN_IS_NOT_A_FORECAST'],
    metricLabel: 'Historical 1Y after-tax return',
    disclosure: `HISTORICAL — NOT A FORECAST. The provider return window is a verified 1-year observation; it is not the user's realized gain or a future return. ${capitalGains.taxClass === 'EQUITY_LTCG_SECTION_112A' ? 'Section 112A LTCG treatment uses the explicit holding period and the remaining taxpayer-level annual exemption.' : 'Section 111A STCG treatment uses the explicit holding period.'} Special-rate tax is separate from ordinary slabs and Section 87A is not applied to it.`,
    isHistoricalEstimate: true,
    historicalObservationWindowMonths: 12,
    rulesApplied: capitalGains.rulesApplied,
  });
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
    const taxMetadata = getProductTaxMetadata(product, product?.parentInstrumentId);

    return {
      ...product,
      beginnerSuitability,
      taxMetadata,
      postTaxAnalysis,
      // WTI's generic postTaxReturn field is intentionally not overloaded with
      // product tax authority. Consumers must use postTaxAnalysis explicitly.
      postTaxReturn: null,
    };
  });
}
