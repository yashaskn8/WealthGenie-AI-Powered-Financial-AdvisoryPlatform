/**
 * Source-qualified product tax authority for the WTI comparison path.
 *
 * Product names and provider display IDs are presentation text. Only the
 * exact provider-qualified parent instrument mapping below, or an explicit
 * sourceQualified taxMetadata object supplied by a qualified adapter, may
 * establish a product tax class.
 */

export const PRODUCT_TAX_CLASSES = Object.freeze({
  PPF_EEE: 'PPF_EEE',
  SSY_EEE: 'SSY_EEE',
  BANK_DEPOSIT_INTEREST: 'BANK_DEPOSIT_INTEREST',
  RBI_FRSB_INTEREST: 'RBI_FRSB_INTEREST',
  EQUITY_MF_112A: 'EQUITY_MF_SECTION_112A',
  EQUITY_MF_ELSS: 'EQUITY_MF_ELSS_SECTION_112A',
  DEBT_MF_50AA: 'DEBT_MF_SECTION_50AA',
});

export const PRODUCT_TAX_STATUSES = Object.freeze({
  CALCULATED: 'CALCULATED',
  REQUIRES_TAX_INPUTS: 'REQUIRES_TAX_INPUTS',
  TAX_CLASSIFICATION_UNAVAILABLE: 'TAX_CLASSIFICATION_UNAVAILABLE',
  FISCAL_YEAR_UNSUPPORTED: 'FISCAL_YEAR_UNSUPPORTED',
  PRODUCT_FACTS_UNAVAILABLE: 'PRODUCT_FACTS_UNAVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const POST_TAX_CALCULATION_CLASSES = Object.freeze({
  CURRENT_RATE_POST_TAX_ILLUSTRATION: 'CURRENT_RATE_POST_TAX_ILLUSTRATION',
  HISTORICAL_RETURN_POST_TAX_ILLUSTRATION: 'HISTORICAL_RETURN_POST_TAX_ILLUSTRATION',
  MODELLED_POST_TAX_PROJECTION: 'MODELLED_POST_TAX_PROJECTION',
  TRANSACTION_TAX_ESTIMATE: 'TRANSACTION_TAX_ESTIMATE',
});

const PPF_SOURCE = Object.freeze({
  authority: 'India Post / Government of India',
  title: 'POSB CBS Manual — PPF tax treatment',
  url: 'https://www.indiapost.gov.in/VAS/DOP_PDFFiles/POSB_CBS_Manual_2021.pdf',
});
const SSY_SOURCE = Object.freeze({
  authority: 'India Post / Government of India',
  title: 'Small Savings Scheme tax treatment',
  url: 'https://www.indiapost.gov.in/VAS/DOP_PDFFiles/SB_Order_2021.pdf',
});
const FRSB_SOURCE = Object.freeze({
  authority: 'Reserve Bank of India',
  title: 'Floating Rate Savings Bonds 2020 (Taxable) guidelines',
  url: 'https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11924',
});
const FD_SOURCE = Object.freeze({
  authority: 'State Bank of India',
  title: 'Retail domestic term-deposit rate source',
  url: 'https://sbi.co.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits',
});

const EXACT_PARENT_TAX_METADATA = Object.freeze({
  ppf: Object.freeze({
    taxClass: PRODUCT_TAX_CLASSES.PPF_EEE,
    displayName: 'Public Provident Fund',
    sourceReferences: Object.freeze([PPF_SOURCE]),
    rulesApplied: Object.freeze(['SECTION_10_11_EEE_TREATMENT']),
  }),
  sukanya: Object.freeze({
    taxClass: PRODUCT_TAX_CLASSES.SSY_EEE,
    displayName: 'Sukanya Samriddhi Account',
    sourceReferences: Object.freeze([SSY_SOURCE]),
    rulesApplied: Object.freeze(['SECTION_10_11A_EEE_TREATMENT']),
  }),
  fd: Object.freeze({
    taxClass: PRODUCT_TAX_CLASSES.BANK_DEPOSIT_INTEREST,
    displayName: 'Bank fixed deposit interest',
    sourceReferences: Object.freeze([FD_SOURCE]),
    rulesApplied: Object.freeze(['BANK_DEPOSIT_INTEREST_TAXED_AT_INCOME_TAX_RATES']),
  }),
  sbi_fd: Object.freeze({
    taxClass: PRODUCT_TAX_CLASSES.BANK_DEPOSIT_INTEREST,
    displayName: 'SBI retail domestic term-deposit interest',
    sourceReferences: Object.freeze([FD_SOURCE]),
    rulesApplied: Object.freeze(['BANK_DEPOSIT_INTEREST_TAXED_AT_INCOME_TAX_RATES']),
  }),
  rbi_bonds: Object.freeze({
    taxClass: PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST,
    displayName: 'RBI Floating Rate Savings Bond 2020 (Taxable)',
    sourceReferences: Object.freeze([FRSB_SOURCE]),
    rulesApplied: Object.freeze([
      'FRSB_INTEREST_TAXABLE',
      'FRSB_COUPON_RESETS_SEMIANNUALLY',
    ]),
  }),
});

const UNSUPPORTED_EXACT_PARENTS = new Set([
  'scss', 'nsc', 'kvp', 'pomis', 'po_rd', 'po_td_1yr',
]);

const VALID_EXPLICIT_CLASSES = new Set(Object.values(PRODUCT_TAX_CLASSES));

function copyMetadata(metadata) {
  return {
    ...metadata,
    sourceReferences: (metadata.sourceReferences || []).map(source => ({ ...source })),
    rulesApplied: [...(metadata.rulesApplied || [])],
  };
}

/**
 * Return tax metadata only when its provenance is explicit and qualified.
 */
export function getProductTaxMetadata(product = {}, parentInstrumentId = product.parentInstrumentId) {
  const explicit = product?.taxMetadata;
  if (explicit?.sourceQualified === true && VALID_EXPLICIT_CLASSES.has(explicit.taxClass)) {
    return {
      sourceQualified: true,
      taxClass: explicit.taxClass,
      displayName: explicit.displayName || explicit.taxClass,
      sourceReferences: Array.isArray(explicit.sourceReferences)
        ? explicit.sourceReferences.map(source => ({ ...source }))
        : [],
      rulesApplied: Array.isArray(explicit.rulesApplied) ? [...explicit.rulesApplied] : [],
      effectiveDate: explicit.effectiveDate || null,
      facts: explicit.facts ? { ...explicit.facts } : {},
    };
  }

  const exactParent = typeof parentInstrumentId === 'string'
    ? EXACT_PARENT_TAX_METADATA[parentInstrumentId]
    : null;
  if (exactParent) {
    return { sourceQualified: true, ...copyMetadata(exactParent) };
  }

  return {
    sourceQualified: false,
    taxClass: null,
    displayName: null,
    sourceReferences: [],
    rulesApplied: [],
    effectiveDate: null,
    facts: {},
    unavailableReason: UNSUPPORTED_EXACT_PARENTS.has(parentInstrumentId)
      ? 'This product category has no qualified tax adapter in the current WTI contract.'
      : 'The qualified provider did not supply a tax classification for this product.',
  };
}

export function getRequiredTaxInputs(taxClass) {
  if ([PRODUCT_TAX_CLASSES.PPF_EEE, PRODUCT_TAX_CLASSES.SSY_EEE].includes(taxClass)) {
    return [];
  }
  if ([
    PRODUCT_TAX_CLASSES.BANK_DEPOSIT_INTEREST,
    PRODUCT_TAX_CLASSES.RBI_FRSB_INTEREST,
  ].includes(taxClass)) {
    return ['annualGrossIncome', 'incomeSource', 'regime', 'fiscalYear'];
  }
  if (taxClass === PRODUCT_TAX_CLASSES.DEBT_MF_50AA) {
    return ['annualGrossIncome', 'incomeSource', 'regime', 'fiscalYear', 'holdingPeriodMonths'];
  }
  if ([PRODUCT_TAX_CLASSES.EQUITY_MF_112A, PRODUCT_TAX_CLASSES.EQUITY_MF_ELSS].includes(taxClass)) {
    return [
      'annualGrossIncome', 'incomeSource', 'regime', 'fiscalYear',
      'holdingPeriodMonths', 'section112AExemptionUsed',
    ];
  }
  return [];
}

export function classifySourceQualifiedProductTaxType(product, parentInstrumentId) {
  return getProductTaxMetadata(product, parentInstrumentId).taxClass
    || 'TAX_CLASSIFICATION_UNAVAILABLE';
}

export { EXACT_PARENT_TAX_METADATA, UNSUPPORTED_EXACT_PARENTS };
