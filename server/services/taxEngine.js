import { CESS_RATE } from './instrumentConstants.js';
/**
 * Dynamically computes India's current fiscal year (April 1st to March 31st).
 * @returns {string} e.g. "FY2026-27"
 */
export function getCurrentFiscalYear() {
    const now = new Date();
    const year = now.getFullYear();
    // India's fiscal year starts in April (month index 3)
    const isAprilOrLater = now.getMonth() >= 3;
    const startYear = isAprilOrLater ? year : year - 1;
    const endYear = startYear + 1;
    return `FY${startYear}-${endYear.toString().slice(-2)}`;
}
export const CURRENT_FY = getCurrentFiscalYear();
const defineSlabs = (slabs) => Object.freeze(slabs.map(slab => Object.freeze({ ...slab })));
const FY2025_26_NEW_SLABS = defineSlabs([
    { min: 0, max: 400000, rate: 0 },
    { min: 400000, max: 800000, rate: 0.05 },
    { min: 800000, max: 1200000, rate: 0.10 },
    { min: 1200000, max: 1600000, rate: 0.15 },
    { min: 1600000, max: 2000000, rate: 0.20 },
    { min: 2000000, max: 2400000, rate: 0.25 },
    { min: 2400000, max: Infinity, rate: 0.30 },
]);
const FY2026_27_NEW_SLABS = defineSlabs([
    { min: 0, max: 400000, rate: 0 },
    { min: 400000, max: 800000, rate: 0.05 },
    { min: 800000, max: 1200000, rate: 0.10 },
    { min: 1200000, max: 1600000, rate: 0.15 },
    { min: 1600000, max: 2000000, rate: 0.20 },
    { min: 2000000, max: 2400000, rate: 0.25 },
    { min: 2400000, max: Infinity, rate: 0.30 },
]);
const FY2025_26_OLD_SLABS = defineSlabs([
    { min: 0, max: 250000, rate: 0 },
    { min: 250000, max: 500000, rate: 0.05 },
    { min: 500000, max: 1000000, rate: 0.20 },
    { min: 1000000, max: Infinity, rate: 0.30 },
]);
const FY2026_27_OLD_SLABS = defineSlabs([
    { min: 0, max: 250000, rate: 0 },
    { min: 250000, max: 500000, rate: 0.05 },
    { min: 500000, max: 1000000, rate: 0.20 },
    { min: 1000000, max: Infinity, rate: 0.30 },
]);

const TAX_SOURCES = Object.freeze({
    'FY2025-26': Object.freeze([
        Object.freeze({
            authority: 'Government of India — Union Budget',
            title: 'Finance Bill 2025 Memorandum',
            url: 'https://www.indiabudget.gov.in/budget2025-26/doc/memo.pdf',
        }),
        Object.freeze({
            authority: 'Income Tax Department',
            title: 'AY 2025-26 individual tax guidance',
            url: 'https://www.incometax.gov.in/iec/foportal/help/individual-business-profession',
        }),
    ]),
    'FY2026-27': Object.freeze([
        Object.freeze({
            authority: 'Government of India — Union Budget',
            title: 'Finance Bill 2026 Memorandum',
            url: 'https://www.indiabudget.gov.in/doc/memo.pdf',
        }),
        Object.freeze({
            authority: 'Income Tax Department',
            title: 'Individual return applicability and tax regime guidance',
            url: 'https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1?fromCampaign=true',
        }),
    ]),
});

const TAX_POLICY_RULES = Object.freeze({
    'FY2025-26': Object.freeze({
        newRegime87ALimit: 700000,
        newRegime87ARebate: 25000,
        oldRegime87ALimit: 500000,
        oldRegime87ARebate: 12500,
        capitalGains112AExemption: 125000,
        capitalGains111ARate: 0.20,
        capitalGains112ARate: 0.125,
        specialRateSurchargeCap: 0.15,
    }),
    'FY2026-27': Object.freeze({
        newRegime87ALimit: 1200000,
        newRegime87ARebate: 60000,
        oldRegime87ALimit: 500000,
        oldRegime87ARebate: 12500,
        capitalGains112AExemption: 125000,
        capitalGains111ARate: 0.20,
        capitalGains112ARate: 0.125,
        specialRateSurchargeCap: 0.15,
    }),
});

export const TAX_DEDUCTION_LIMITS = Object.freeze({
    section80C: 150000,
    section80CCD1B: 50000,
    section80DSelf: 25000,
    section80DSelfSenior: 50000,
    section80DParents: 25000,
    section80DParentsSenior: 50000,
});

export const TAX_SLABS_BY_FY = Object.freeze({
    'FY2025-26': Object.freeze({
        verified: true,
        policyVersion: 'tax-policy-FY2025-26-v1',
        sourceReferences: TAX_SOURCES['FY2025-26'],
        new: FY2025_26_NEW_SLABS,
        old: FY2025_26_OLD_SLABS,
    }),
    'FY2026-27': Object.freeze({
        verified: true,
        policyVersion: 'tax-policy-FY2026-27-v1',
        sourceReferences: TAX_SOURCES['FY2026-27'],
        new: FY2026_27_NEW_SLABS,
        old: FY2026_27_OLD_SLABS,
    }),
});
export const REGULATORY_RULE_VERSION = TAX_SLABS_BY_FY[CURRENT_FY]?.policyVersion ?? null;

export function getTaxPolicyMetadata(fiscalYear) {
    const policy = getTaxSlabsForFY(fiscalYear);
    const rules = TAX_POLICY_RULES[fiscalYear];
    return {
        policyVersion: policy.policyVersion,
        fiscalYear,
        verified: true,
        sourceReferences: policy.sourceReferences.map(source => ({ ...source })),
        rules: {
            ...rules,
            healthAndEducationCessRate: CESS_RATE,
        },
    };
}
export function getSupportedFiscalYears() {
    return Object.keys(TAX_SLABS_BY_FY).filter(fiscalYear => TAX_SLABS_BY_FY[fiscalYear].verified === true);
}
export function getTaxPolicyCatalog() {
    return {
        currentFiscalYear: CURRENT_FY,
        currentFiscalYearVerified: isFYVerified(CURRENT_FY),
        verifiedFiscalYears: getSupportedFiscalYears(),
        policies: getSupportedFiscalYears().map(fiscalYear => getTaxPolicyMetadata(fiscalYear)),
    };
}
export function getTaxSlabsForFY(fiscalYear) {
    const slabs = TAX_SLABS_BY_FY[fiscalYear];
    if (!slabs || slabs.verified !== true) {
        const error = new RangeError(`Verified tax slabs are unavailable for ${fiscalYear}`);
        error.code = 'FISCAL_YEAR_UNSUPPORTED';
        throw error;
    }
    return slabs;
}
/**
 * Check whether the tax slabs for a given fiscal year have been verified
 * against an official gazette/Union Budget source.
 */
export function isFYVerified(fiscalYear) {
    const entry = TAX_SLABS_BY_FY[fiscalYear];
    return entry ? entry.verified === true : false;
}
function getRegimeSlabs(regime, fiscalYear) {
    const slabs = getTaxSlabsForFY(fiscalYear);
    return regime === 'old' ? slabs.old : slabs.new;
}
/**
 * Calculate tax from slab structure.
 */
function calculateFromSlabs(taxableIncome, slabs) {
    let tax = 0;
    for (const slab of slabs) {
        if (taxableIncome <= slab.min)
            break;
        const taxableInSlab = Math.min(taxableIncome, slab.max) - slab.min;
        tax += taxableInSlab * slab.rate;
    }
    return tax;
}
/**
 * Compute surcharge on base tax for high-income individuals.
 */
function computeSurcharge(taxBeforeSurcharge, taxableIncome, regime) {
    if (taxableIncome <= 5000000)
        return 0; // Below ₹50L: no surcharge
    let surchargeRate = 0;
    if (regime === 'new') {
        if (taxableIncome <= 10000000)
            surchargeRate = 0.10;
        else if (taxableIncome <= 20000000)
            surchargeRate = 0.15;
        else
            surchargeRate = 0.25;
    }
    else {
        // Old regime
        if (taxableIncome <= 10000000)
            surchargeRate = 0.10;
        else if (taxableIncome <= 20000000)
            surchargeRate = 0.15;
        else if (taxableIncome <= 50000000)
            surchargeRate = 0.25;
        else
            surchargeRate = 0.37;
    }
    return taxBeforeSurcharge * surchargeRate;
}
/**
 * Compute surcharge WITH marginal relief.
 */
function computeMarginalRelief(baseTax, surcharge, taxableIncome, regime, fiscalYear) {
    if (taxableIncome <= 5000000)
        return 0;
    const SURCHARGE_THRESHOLDS = regime === 'new'
        ? [5000000, 10000000, 20000000]
        : [5000000, 10000000, 20000000, 50000000];
    // Find the highest active threshold strictly below the taxable income
    let threshold = 5000000;
    for (const t of SURCHARGE_THRESHOLDS) {
        if (taxableIncome > t) {
            threshold = t;
        }
    }
    const slabs = getRegimeSlabs(regime, fiscalYear);
    const baseTaxAtThreshold = calculateFromSlabs(threshold, slabs);
    // Surcharge rate AT exactly the threshold limit
    let thresholdSurchargeRate = 0;
    if (threshold === 10000000) {
        thresholdSurchargeRate = 0.10;
    }
    else if (threshold === 20000000) {
        thresholdSurchargeRate = 0.15;
    }
    else if (threshold === 50000000 && regime === 'old') {
        thresholdSurchargeRate = 0.25;
    }
    const taxAtThreshold = baseTaxAtThreshold * (1 + thresholdSurchargeRate);
    // Total tax at actual income
    const totalActual = baseTax + surcharge;
    // Income gain above threshold
    const incomeGain = taxableIncome - threshold;
    // Relief: tax should not exceed tax-at-threshold + income-gain
    const maxAllowedTax = taxAtThreshold + incomeGain;
    const marginalRelief = totalActual > maxAllowedTax ? totalActual - maxAllowedTax : 0;
    return Math.round(marginalRelief);
}
/**
 * Helper to compute allowed standard and section-wise deductions and taxable income.
 */
function validateTaxContext(annualIncome, regime, incomeSource) {
    if (!Number.isFinite(annualIncome) || annualIncome < 0) {
        throw new TypeError('annualIncome must be an explicit non-negative finite number');
    }
    if (regime !== 'new' && regime !== 'old') {
        throw new TypeError('regime must be explicitly provided as new or old');
    }
    if (!['salary', 'pension', 'family_pension', 'business', 'other'].includes(incomeSource)) {
        throw new TypeError('incomeSource must be explicitly provided');
    }
}

export function calculateTaxableIncome(annualIncome, regime, deductions = {}, incomeSource) {
    validateTaxContext(annualIncome, regime, incomeSource);
    let standardDeduction = 0;
    if (incomeSource === 'salary' || incomeSource === 'pension') {
        standardDeduction = regime === 'new' ? 75000 : 50000;
    }
    else if (incomeSource === 'family_pension') {
        standardDeduction = Math.min(annualIncome / 3, 15000);
    }
    // Section 80CCD(2) - Employer NPS Contribution (available under both regimes)
    const requestedNps80CCD2 = Number(deductions.nps80CCD2 || 0);
    let nps80CCD2 = 0;
    if (requestedNps80CCD2 > 0) {
        if (!Number.isFinite(deductions.basicSalary) || deductions.basicSalary < 0
            || typeof deductions.isGovtEmployee !== 'boolean') {
            throw new TypeError('basicSalary and isGovtEmployee are required for an nps80CCD2 claim');
        }
        const nps80CCD2LimitPercent = deductions.isGovtEmployee ? 0.14 : 0.10;
        nps80CCD2 = Math.min(requestedNps80CCD2, deductions.basicSalary * nps80CCD2LimitPercent);
    }
    const section80C = Math.min(deductions.section80C || 0, 150000);
    const nps80CCD1B = Math.min(deductions.nps80CCD1B || deductions.section80CCD || 0, 50000);
    // Section 80D Granular Self vs. Parents
    const healthOrInterestFactsPresent = Number(deductions.section80D || 0) > 0
        || Number(deductions.section80D_self || 0) > 0
        || Number(deductions.section80D_parents || 0) > 0
        || Number(deductions.savingsInterest || 0) > 0
        || Number(deductions.section80TTA || 0) > 0
        || Number(deductions.section80TTB || 0) > 0;
    if (healthOrInterestFactsPresent && (!Number.isInteger(deductions.age) || deductions.age < 0)) {
        throw new TypeError('age is required for age-dependent deductions');
    }
    const age = deductions.age ?? 0;
    const selfSenior = age >= 60 || deductions.self_senior === true;
    const parentsSenior = deductions.parents_senior === true;
    const max80D_self = selfSenior ? 50000 : 25000;
    const max80D_parents = parentsSenior ? 50000 : 25000;
    let allowed80D = 0;
    if (deductions.section80D_self !== undefined || deductions.section80D_parents !== undefined) {
        const allowed80D_self = Math.min(deductions.section80D_self || 0, max80D_self);
        const allowed80D_parents = Math.min(deductions.section80D_parents || 0, max80D_parents);
        allowed80D = allowed80D_self + allowed80D_parents;
    }
    else {
        allowed80D = Math.min(deductions.section80D || 0, 100000);
    }
    const hra = deductions.hra || 0;
    const homeLoanInterest = Math.min(deductions.homeLoanInterest || 0, 200000);
    const section80EEA = Math.min(deductions.section80EEA || 0, 150000);
    const otherDeductions = deductions.other || 0;
    const savingsInterest = deductions.savingsInterest || 0;
    let section80TTA = deductions.section80TTA || 0;
    let section80TTB = deductions.section80TTB || 0;
    if (savingsInterest > 0) {
        if (age >= 60) {
            section80TTB = Math.max(section80TTB, savingsInterest);
        }
        else {
            section80TTA = Math.max(section80TTA, savingsInterest);
        }
    }
    const allowed80TTA = age < 60 ? Math.min(section80TTA, 10000) : 0;
    const allowed80TTB = age >= 60 ? Math.min(section80TTB, 50000) : 0;
    const oldRegimeDeductions = regime === 'old'
        ? (section80C + nps80CCD1B + allowed80D + hra + homeLoanInterest + section80EEA + allowed80TTA + allowed80TTB + otherDeductions)
        : 0;
    const taxableIncome = Math.max(0, annualIncome - standardDeduction - nps80CCD2 - oldRegimeDeductions);
    return { standardDeduction, oldRegimeDeductions, taxableIncome, nps80CCD2, allowed80D };
}
/**
 * Compute full tax breakdown for a given annual income.
 */
export function computeTax(annualIncome, regime, deductions = {}, incomeSource, fiscalYear) {
    validateTaxContext(annualIncome, regime, incomeSource);
    const slabs = getRegimeSlabs(regime, fiscalYear);
    const { standardDeduction, oldRegimeDeductions, taxableIncome, nps80CCD2, allowed80D } = calculateTaxableIncome(annualIncome, regime, deductions, incomeSource);
    let taxBeforeCess = calculateFromSlabs(taxableIncome, slabs);
    let rebateApplied = false;
    let marginalReliefApplied = false;
    let marginalReliefAmount87A = 0;
    const policyRules = TAX_POLICY_RULES[fiscalYear];
    const rebateLimit = regime === 'new'
        ? policyRules.newRegime87ALimit
        : policyRules.oldRegime87ALimit;
    const rebateMaximum = regime === 'new'
        ? policyRules.newRegime87ARebate
        : policyRules.oldRegime87ARebate;
    if (taxableIncome <= rebateLimit) {
        const rebate = Math.min(taxBeforeCess, rebateMaximum);
        taxBeforeCess = Math.max(0, taxBeforeCess - rebate);
        rebateApplied = rebate > 0;
    }
    else if (regime === 'new') {
        // Section 87A Proviso (Marginal relief under Section 115BAC):
        // Tax payable shall not exceed the amount by which total income exceeds rebate limit
        const excessOverLimit = taxableIncome - rebateLimit;
        if (taxBeforeCess > excessOverLimit) {
            marginalReliefAmount87A = taxBeforeCess - excessOverLimit;
            taxBeforeCess = excessOverLimit;
            marginalReliefApplied = true;
        }
    }
    const surcharge = computeSurcharge(taxBeforeCess, taxableIncome, regime);
    const relief = computeMarginalRelief(taxBeforeCess, surcharge, taxableIncome, regime, fiscalYear);
    const taxAfterSurcharge = taxBeforeCess + surcharge - relief;
    // 4% Health & Education Cess (applied on tax + surcharge)
    const cess = taxAfterSurcharge * CESS_RATE;
    const taxAmount = taxAfterSurcharge + cess;
    const effectiveRate = annualIncome > 0
        ? parseFloat(((taxAmount / annualIncome) * 100).toFixed(2))
        : 0;
    const policy = getTaxPolicyMetadata(fiscalYear);
    return {
        taxAmount: Math.round(taxAmount),
        effectiveRate,
        regime,
        rebateApplied,
        marginalReliefApplied: marginalReliefApplied || relief > 0,
        marginalReliefAmount: Math.round(relief + marginalReliefAmount87A),
        surchargeApplied: surcharge > 0,
        surchargeAmount: Math.round(surcharge),
        cess: Math.round(cess),
        taxBeforeCess: Math.round(taxBeforeCess),
        taxableIncome,
        annualIncome,
        standardDeduction,
        oldRegimeDeductions,
        nps80CCD2,
        allowed80D,
        fiscalYear,
        policyVersion: policy.policyVersion,
        sourceReferences: policy.sourceReferences,
        inputsUsed: {
            annualIncome,
            regime,
            incomeSource,
            fiscalYear,
            deductions: { ...deductions },
        },
        rulesApplied: [
            `${regime.toUpperCase()}_REGIME_SLABS`,
            rebateApplied ? 'SECTION_87A_REBATE' : null,
            (marginalReliefApplied || relief > 0) ? 'MARGINAL_RELIEF' : null,
            surcharge > 0 ? 'SURCHARGE' : null,
            'HEALTH_AND_EDUCATION_CESS',
        ].filter(Boolean),
        assumptions: [],
        unavailableReasons: [],
    };
}

function getSpecialRateSurchargeRate(totalTaxableIncome) {
    if (totalTaxableIncome <= 5000000) return 0;
    if (totalTaxableIncome <= 10000000) return 0.10;
    return 0.15;
}

/**
 * Compute a qualified equity capital-gains bucket without applying ordinary
 * slab tax or Section 87A to the special-rate gain. This is intentionally
 * separate from computeTax: product capital gains must never be folded into
 * ordinary salary/business income by accident.
 *
 * For combined taxable income above ₹50 lakh, the current product contract
 * fails closed because surcharge marginal-relief interaction requires the
 * taxpayer's complete special-rate return context and cannot be inferred from
 * a product comparison card.
 */
export function computeEquityCapitalGainsTax({
    grossGain,
    holdingPeriodMonths,
    annualIncome,
    regime,
    deductions = {},
    incomeSource,
    fiscalYear,
    section112AExemptionUsed = 0,
}) {
    if (!Number.isFinite(grossGain) || grossGain < 0) {
        throw new TypeError('grossGain must be an explicit non-negative finite number');
    }
    if (!Number.isFinite(holdingPeriodMonths) || holdingPeriodMonths < 0) {
        throw new TypeError('holdingPeriodMonths must be an explicit non-negative finite number');
    }
    if (!Number.isFinite(section112AExemptionUsed) || section112AExemptionUsed < 0) {
        throw new TypeError('section112AExemptionUsed must be an explicit non-negative finite number');
    }
    validateTaxContext(annualIncome, regime, incomeSource);
    const policy = getTaxPolicyMetadata(fiscalYear);
    const policyRules = TAX_POLICY_RULES[fiscalYear];
    const ordinary = calculateTaxableIncome(annualIncome, regime, deductions, incomeSource);
    const combinedTaxableIncome = ordinary.taxableIncome + grossGain;

    if (combinedTaxableIncome > 5000000) {
        return {
            status: 'UNAVAILABLE',
            taxClass: holdingPeriodMonths < 12 ? 'EQUITY_STCG_SECTION_111A' : 'EQUITY_LTCG_SECTION_112A',
            grossGain,
            taxableGain: null,
            exemptionApplied: null,
            taxAmount: null,
            cess: null,
            surcharge: null,
            marginalRelief: null,
            policyVersion: policy.policyVersion,
            fiscalYear,
            sourceReferences: policy.sourceReferences,
            unavailableReasons: ['SPECIAL_RATE_HIGH_INCOME_REQUIRES_FULL_TAX_CONTEXT'],
        };
    }

    const isLongTerm = holdingPeriodMonths >= 12;
    const taxClass = isLongTerm ? 'EQUITY_LTCG_SECTION_112A' : 'EQUITY_STCG_SECTION_111A';
    const availableExemption = isLongTerm
        ? Math.max(0, policyRules.capitalGains112AExemption - section112AExemptionUsed)
        : 0;
    const exemptionApplied = Math.min(grossGain, availableExemption);
    const taxableGain = Math.max(0, grossGain - exemptionApplied);
    const rate = isLongTerm ? policyRules.capitalGains112ARate : policyRules.capitalGains111ARate;
    const taxBeforeSurcharge = taxableGain * rate;
    const surchargeRate = getSpecialRateSurchargeRate(combinedTaxableIncome);
    const surcharge = taxBeforeSurcharge * Math.min(surchargeRate, policyRules.specialRateSurchargeCap);
    const taxAfterSurcharge = taxBeforeSurcharge + surcharge;
    const cess = taxAfterSurcharge * CESS_RATE;
    const taxAmount = Math.round(taxAfterSurcharge + cess);

    return {
        status: 'CALCULATED',
        taxClass,
        grossGain,
        taxableGain,
        exemptionApplied,
        taxAmount,
        cess: Math.round(cess),
        surcharge: Math.round(surcharge),
        surchargeRate,
        marginalRelief: 0,
        rebateApplied: false,
        rate,
        holdingPeriodBasis: 'EXPLICIT_HOLDING_PERIOD_MONTHS',
        fiscalYear,
        policyVersion: policy.policyVersion,
        sourceReferences: policy.sourceReferences,
        rulesApplied: [
            isLongTerm ? 'SECTION_112A_LTCG_SPECIAL_RATE' : 'SECTION_111A_STCG_SPECIAL_RATE',
            isLongTerm && exemptionApplied > 0 ? 'SECTION_112A_ANNUAL_EXEMPTION' : null,
            surcharge > 0 ? 'SPECIAL_RATE_SURCHARGE_CAPPED_AT_15_PERCENT' : null,
            'SPECIAL_RATE_INCOME_EXCLUDED_FROM_87A_REBATE',
            'HEALTH_AND_EDUCATION_CESS',
        ].filter(Boolean),
        unavailableReasons: [],
    };
}
/**
 * Compute tax with deductions (convenience wrapper/alias).
 */
export function computeTaxWithDeductions(annualIncome, regime, deductions = {}, incomeSource, fiscalYear) {
    return computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear);
}
/**
 * Get the marginal (highest applicable) tax slab percentage.
 */
export function getTaxSlab(annualIncome, regime, deductions = {}, incomeSource, fiscalYear) {
    validateTaxContext(annualIncome, regime, incomeSource);
    const { taxableIncome } = calculateTaxableIncome(annualIncome, regime, deductions, incomeSource);
    const slabs = getRegimeSlabs(regime, fiscalYear);
    let marginalRate = 0;
    for (const slab of slabs) {
        if (taxableIncome > slab.min) {
            marginalRate = slab.rate;
        }
    }
    return marginalRate;
}
/**
 * Compare both regimes and return the better one.
 */
export function compareTaxRegimes(annualIncome, deductions = {}, incomeSource, fiscalYear) {
    if (!Number.isFinite(annualIncome) || annualIncome < 0) {
        throw new TypeError('annualIncome must be an explicit non-negative finite number');
    }
    if (!['salary', 'pension', 'family_pension', 'business', 'other'].includes(incomeSource)) {
        throw new TypeError('incomeSource must be explicitly provided');
    }
    const newRegime = computeTax(annualIncome, 'new', deductions, incomeSource, fiscalYear);
    const oldRegime = computeTax(annualIncome, 'old', deductions, incomeSource, fiscalYear);
    const recommended = newRegime.taxAmount <= oldRegime.taxAmount ? 'new' : 'old';
    return { newRegime, oldRegime, recommended };
}

function formatSlabLabel(slab) {
    const formatLakhs = value => {
        const lakhs = value / 100000;
        return Number.isInteger(lakhs) ? `${lakhs}L` : `${lakhs.toFixed(1)}L`;
    };
    if (!Number.isFinite(slab.max)) return `Above ₹${formatLakhs(slab.min)}`;
    return `₹${formatLakhs(slab.min)} - ₹${formatLakhs(slab.max)}`;
}

/**
 * Presentation-ready slab rows derived from the same verified policy table and
 * computed liability used by computeTax. This prevents the browser from
 * maintaining a second, potentially stale tax engine.
 */
export function buildTaxSlabBreakdown(computation, fiscalYear) {
    if (!computation || !Number.isFinite(computation.taxableIncome)) {
        throw new TypeError('A completed tax computation is required');
    }
    const slabs = getRegimeSlabs(computation.regime, fiscalYear);
    const rows = [];
    let baseTax = 0;

    for (const slab of slabs) {
        if (computation.taxableIncome <= slab.min) break;
        const taxableInSlab = Math.max(0, Math.min(computation.taxableIncome, slab.max) - slab.min);
        if (taxableInSlab <= 0) continue;
        const taxInSlab = Math.round(taxableInSlab * slab.rate);
        baseTax += taxInSlab;
        rows.push({
            label: formatSlabLabel(slab),
            rate: slab.rate * 100,
            taxableInSlab: Math.round(taxableInSlab),
            taxInSlab,
        });
    }

    if (computation.rebateApplied && baseTax > 0) {
        rows.push({
            label: 'Government Tax Rebate (Section 87A)',
            rate: '',
            taxableInSlab: 0,
            taxInSlab: -baseTax,
            isRebateRow: true,
        });
    }

    rows.push({
        label: 'Your Total Tax',
        rate: '',
        taxableInSlab: Math.round(computation.taxableIncome),
        taxInSlab: computation.taxAmount,
        isTotalRow: true,
    });
    return rows;
}

/**
 * Computes the old-regime outcome after filling only the remaining 80C and
 * 80CCD(1B) room. No product or suitability recommendation is made here.
 */
export function analyzeTaxOptimization(annualIncome, deductions = {}, incomeSource, fiscalYear) {
    validateTaxContext(annualIncome, 'old', incomeSource);
    const section80C = Math.min(Number(deductions.section80C) || 0, TAX_DEDUCTION_LIMITS.section80C);
    const nps80CCD1B = Math.min(Number(deductions.nps80CCD1B ?? deductions.section80CCD) || 0, TAX_DEDUCTION_LIMITS.section80CCD1B);
    const age = Number.isInteger(deductions.age) ? deductions.age : null;
    const parentsSeniorKnown = typeof deductions.parents_senior === 'boolean';
    const parentsSenior = deductions.parents_senior === true;
    const deductionLimits = {
        section80C: TAX_DEDUCTION_LIMITS.section80C,
        section80CCD1B: TAX_DEDUCTION_LIMITS.section80CCD1B,
        section80DSelf: age !== null && age >= 60
            ? TAX_DEDUCTION_LIMITS.section80DSelfSenior
            : TAX_DEDUCTION_LIMITS.section80DSelf,
        section80DParents: parentsSeniorKnown
            ? (parentsSenior
                ? TAX_DEDUCTION_LIMITS.section80DParentsSenior
                : TAX_DEDUCTION_LIMITS.section80DParents)
            : null,
    };
    const remaining = {
        section80C: Math.max(0, deductionLimits.section80C - section80C),
        section80CCD1B: Math.max(0, deductionLimits.section80CCD1B - nps80CCD1B),
    };
    const currentOld = computeTax(annualIncome, 'old', deductions, incomeSource, fiscalYear);
    const optimizedDeductions = {
        ...deductions,
        section80C: deductionLimits.section80C,
        nps80CCD1B: deductionLimits.section80CCD1B,
    };
    const optimizedOld = computeTax(annualIncome, 'old', optimizedDeductions, incomeSource, fiscalYear);
    const newRegime = computeTax(annualIncome, 'new', deductions, incomeSource, fiscalYear);

    let crossoverBreakpoint = null;
    const currentRelevantDeductions = section80C + nps80CCD1B;
    const availableAdditional = remaining.section80C + remaining.section80CCD1B;
    if (currentOld.taxAmount <= newRegime.taxAmount) {
        crossoverBreakpoint = currentRelevantDeductions;
    } else if (optimizedOld.taxAmount <= newRegime.taxAmount && availableAdditional > 0) {
        let low = 0;
        let high = availableAdditional;
        while (low < high) {
            const additional = Math.floor((low + high) / 2);
            const add80C = Math.min(remaining.section80C, additional);
            const addNps = Math.min(remaining.section80CCD1B, Math.max(0, additional - add80C));
            const candidate = computeTax(annualIncome, 'old', {
                ...deductions,
                section80C: section80C + add80C,
                nps80CCD1B: nps80CCD1B + addNps,
            }, incomeSource, fiscalYear);
            if (candidate.taxAmount <= newRegime.taxAmount) high = additional;
            else low = additional + 1;
        }
        crossoverBreakpoint = currentRelevantDeductions + low;
    }

    return {
        deductionLimits,
        remaining,
        optimizedOld,
        potentialSaving: Math.max(0, currentOld.taxAmount - optimizedOld.taxAmount),
        crossoverBreakpoint,
    };
}
/**
 * Get the effective marginal tax rate (slab + surcharge + cess) for a given income level.
 * Useful for post-tax drag adjustments on future returns.
 */
export function getEffectiveMarginalRate(annualIncome, regime, deductions = {}, incomeSource, fiscalYear) {
    validateTaxContext(annualIncome, regime, incomeSource);
    // WG-040: If actual liability at this income is already ₹0 (inside a Section 87A
    // rebate zone), report 0 directly. A finite-difference window straddling the rebate
    // cliff otherwise produces a spurious, ceiling-clamped rate (up to 0.45) for someone
    // who owes no tax at all.
    const actualTax = computeTax(annualIncome, regime, deductions, incomeSource, fiscalYear).taxAmount;
    if (actualTax === 0) return 0;

    const delta = 10000;
    const highIncome = annualIncome + delta;
    const lowIncome = Math.max(0, annualIncome - delta);
    const highRes = computeTax(highIncome, regime, deductions, incomeSource, fiscalYear);
    const lowRes = computeTax(lowIncome, regime, deductions, incomeSource, fiscalYear);
    const deltaIncome = highIncome - lowIncome;
    if (deltaIncome <= 0)
        return 0;
    const deltaTax = highRes.taxAmount - lowRes.taxAmount;
    const effectiveMarginal = deltaTax / deltaIncome;
    return parseFloat(Math.max(0, Math.min(effectiveMarginal, 0.45)).toFixed(4));
}
