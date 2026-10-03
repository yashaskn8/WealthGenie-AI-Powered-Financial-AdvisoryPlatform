import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesBuildSha } from '../../shared/buildIdentity.js';
import {
  NIFTYBEES_PRODUCT_TAX_EVIDENCE,
  PRODUCT_TAX_CLASSES,
} from '../services/productTaxAuthority.js';
import { getCurrentFiscalYear, getTaxPolicyMetadata } from '../services/taxEngine.js';
import {
  BACKEND_HTTP_HARD_TIMEOUT_MS,
  DASHBOARD_BROWSER_TIMEOUT_MS,
  LOGIN_BROWSER_TIMEOUT_MS,
  MARKET_DEPENDENCY_PROBE_TIMEOUT_MS,
  PROFILE_USER_FLOW_TIMEOUT_MS,
  REDIS_PROBE_TIMEOUT_MS,
  WTI_USER_FLOW_TIMEOUT_MS,
} from '../../shared/demoPreflightContracts.js';
import {
  NSE_ALL_INDICES_URL,
  NSE_ENDPOINT_QUALIFICATION,
  NSE_QUOTE_CACHE_TTL_SECONDS,
} from '../services/marketData/NseMarketDataProvider.js';
import { NSE_HISTORICAL_INDEX_URL } from '../services/marketData/NseHistoricalDataProvider.js';
import {
  NSE_MARKET_SESSION,
  NSE_TRADING_HOLIDAY_CACHE_TTL_SECONDS,
  NSE_TRADING_HOLIDAY_URL,
} from '../services/marketData/nseTradingCalendar.js';
import { indiaClockParts, isoDateInIndia } from '../services/marketData/indiaMarketTime.js';

export {
  BACKEND_HTTP_HARD_TIMEOUT_MS,
  DASHBOARD_BROWSER_TIMEOUT_MS,
  LOGIN_BROWSER_TIMEOUT_MS,
  MARKET_DEPENDENCY_PROBE_TIMEOUT_MS,
  PROFILE_USER_FLOW_TIMEOUT_MS,
  REDIS_PROBE_TIMEOUT_MS,
  WTI_USER_FLOW_TIMEOUT_MS,
};
export { matchesBuildSha };

const TRUSTED_TAX_SOURCE_HOSTS = Object.freeze([
  'incometax.gov.in',
  'incometaxindia.gov.in',
  'indiabudget.gov.in',
  'mf.nipponindiaim.com',
  'rbi.org.in',
  'sbi.co.in',
]);
const CALCULATED_TAX_FIELDS = Object.freeze([
  'principal', 'grossGain', 'taxableGain', 'exemptionApplied', 'incrementalTax',
  'cess', 'surcharge', 'netGain', 'postTaxRatePct',
]);

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const REACTAPP_DIR = path.join(REPO_ROOT, 'reactapp');
const NIFTY_ID = 'market:index:nifty-50';
const EXACT_NIFTY_ETF_EVIDENCE = Object.freeze({
  identity: 'https://nsearchives.nseindia.com/trading_security/mf/pdf/Nippon_20032026171200_NipponMutualFund.pdf',
  listing: 'https://nsearchives.nseindia.com/content/circulars/CMPT74390.pdf',
  benchmark: 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf',
  amfiNav: 'https://portal.amfiindia.com/spages/NAVAll.txt',
});
const FINANCIAL_PROVIDER_HOSTS = Object.freeze([
  'nseindia.com',
  'amfiindia.com',
  'sbi.bank',
  'sbi.co.in',
  'indiapost.gov.in',
  'dea.gov.in',
  'rbi.org.in',
  'incometax.gov.in',
  'incometaxindia.gov.in',
  'upstox.com',
]);

export function hasCurrentFinancialBinding(value) {
  return Boolean(value)
    && /^[a-f\d]{24}$/i.test(String(value.profileId || ''))
    && Number.isSafeInteger(value.profile_version) && value.profile_version > 0
    && /^[a-f\d]{24}$/i.test(String(value.recommendationId || value.recommendation_id || ''))
    && Number.isSafeInteger(value.allocation_revision) && value.allocation_revision > 0
    && /^[a-f\d]{24}$/i.test(String(value.allocation_revision_id || ''))
    && /^[a-f\d]{64}$/i.test(String(value.portfolio_fingerprint || ''))
    && /^[a-f\d]{64}$/i.test(String(value.recommendation_fingerprint || ''))
    && value.response_state === 'CURRENT'
    && value.calculation_freshness?.fresh === true;
}

export function matchesRecommendationBinding(binding, recommendation) {
  return Boolean(binding && recommendation)
    && binding.profileId === recommendation.profileId
    && binding.profileVersion === recommendation.profile_version
    && binding.recommendationId === (recommendation.recommendationId || recommendation.recommendation_id)
    && binding.allocationRevision === recommendation.allocation_revision
    && binding.allocationRevisionId === recommendation.allocation_revision_id
    && binding.portfolioFingerprint === recommendation.portfolio_fingerprint
    && binding.recommendationFingerprint === recommendation.recommendation_fingerprint;
}

export function hasAuthenticatedDashboard({ pathname, sidebarVisible } = {}) {
  const normalizedPath = typeof pathname === 'string' ? pathname.replace(/\/+$/, '') || '/' : '';
  return normalizedPath === '/profile' && sidebarVisible === true;
}

export function qualifiesExactNiftyEtf(product) {
  const fact = product?.primaryFact;
  let benchmarkUrl = null;
  try {
    benchmarkUrl = new URL(product?.benchmark?.source?.url || '');
  } catch {
    benchmarkUrl = null;
  }
  const stableIds = new Map((Array.isArray(product?.externalIds) ? product.externalIds : [])
    .map(item => [item?.source, String(item?.value ?? '')]));
  const identityEvidenceUrls = new Set((Array.isArray(product?.identityEvidence) ? product.identityEvidence : [])
    .map(evidence => evidence?.url));
  const hasExactIdentityEvidence = identityEvidenceUrls.has(EXACT_NIFTY_ETF_EVIDENCE.identity)
    && identityEvidenceUrls.has(EXACT_NIFTY_ETF_EVIDENCE.listing);
  return Boolean(product)
    && product.parentInstrumentId === 'nifty_etf'
    && product.productType === 'ETF'
    && product.canonicalProductId === 'etf:isin:INF204KB14I2'
    && product.isin === 'INF204KB14I2'
    && product.exchange === 'NSE'
    && product.ticker === 'NIFTYBEES'
    && stableIds.get('ISIN') === 'INF204KB14I2'
    && stableIds.get('AMFI_SCHEME_CODE') === '140084'
    && stableIds.get('NSE_TRADING_SYMBOL') === 'NIFTYBEES'
    && product.benchmark?.canonicalProductId === NIFTY_ID
    && product.benchmark?.id === 'NIFTY_50'
    && product.benchmark?.returnVariant === 'NIFTY 50 TRI'
    && benchmarkUrl?.protocol === 'https:'
    && benchmarkUrl.hostname === 'mf.nipponindiaim.com'
    && product.benchmark.source.url === EXACT_NIFTY_ETF_EVIDENCE.benchmark
    && hasExactIdentityEvidence
    && product.source?.provider === 'AMFI'
    && product.source?.url === EXACT_NIFTY_ETF_EVIDENCE.amfiNav
    && fact?.kind === 'MUTUAL_FUND_NAV'
    && fact?.canonicalProductId === 'mf:amfi:140084'
    && fact?.unit === 'NAV_PER_UNIT'
    && fact?.availabilityStatus === 'AVAILABLE'
    && typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value > 0
    && fact?.source?.provider === product.source.provider
    && fact?.source?.instrumentId === '140084'
    && fact?.source?.url === EXACT_NIFTY_ETF_EVIDENCE.amfiNav
    && fact?.freshness?.status === 'FRESH'
    && product.nav?.value === fact.value
    && product.nav?.observedAt === fact.observedAt
    && typeof fact?.observedAt === 'string' && Number.isFinite(Date.parse(fact.observedAt));
}

export function qualifiesWtiResponse(body, recommendation, parentInstrumentId) {
  const products = body?.products;
  const universe = body?.comparisonUniverse;
  const ranking = body?.ranking;
  return body?.success === true
    && parentInstrumentId === 'nifty_etf'
    && matchesRecommendationBinding(body?.financialStateBinding, recommendation)
    && Array.isArray(products)
    && products.length === 1
    && body.total === products.length
    && qualifiesExactNiftyEtf(products[0])
    && universe?.parentInstrumentId === parentInstrumentId
    && universe?.sourceProvider === 'AMFI'
    && universe?.verifiedIdentityCount === products.length
    && universe?.freshNavProductCount === products.length
    && universe?.returnedProductCount === products.length
    && ranking?.status === 'VERIFIED_COMPARABLE_OPTIONS'
    && ranking?.authority === 'OFFICIAL_SCHEME_IDENTITY_AND_AMFI_CURRENT_NAV'
    && ranking?.method === null
    && ranking?.hasUniqueLeader === false;
}

function hasQualifiedTaxReference(reference) {
  if (!reference || typeof reference !== 'object'
      || typeof reference.authority !== 'string' || !reference.authority.trim()
      || typeof reference.title !== 'string' || !reference.title.trim()
      || !['PRODUCT_RULE', 'TAX_POLICY', 'STATUTE_EFFECTIVE_DATE'].includes(reference.role)) return false;
  try {
    const url = new URL(reference.url);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && TRUSTED_TAX_SOURCE_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function qualifiesCalculatedNiftyEtfTax(product, taxContext, { financialBindingValid = true } = {}) {
  const metadata = product?.taxMetadata;
  const analysis = product?.postTaxAnalysis;
  const taxClass = metadata?.taxClass;
  const expectedEvidence = NIFTYBEES_PRODUCT_TAX_EVIDENCE;
  const matchesProductEvidence = value => {
    const binding = value?.binding;
    return value?.classification === expectedEvidence.classification
      && value?.classificationBasis === expectedEvidence.classificationBasis
      && value?.provider === expectedEvidence.provider
      && value?.authority === expectedEvidence.authority
      && value?.documentType === expectedEvidence.documentType
      && value?.documentTitle === expectedEvidence.documentTitle
      && value?.documentDate === expectedEvidence.documentDate
      && value?.officialSourceUrl === expectedEvidence.officialSourceUrl
      && binding?.canonicalProductId === expectedEvidence.binding.canonicalProductId
      && binding?.isin === expectedEvidence.binding.isin
      && binding?.amfiSchemeCode === expectedEvidence.binding.amfiSchemeCode
      && binding?.exchange === expectedEvidence.binding.exchange
      && binding?.ticker === expectedEvidence.binding.ticker
      && Object.keys(binding || {}).length === Object.keys(expectedEvidence.binding).length;
  };
  if (!financialBindingValid || !qualifiesExactNiftyEtf(product)
      || analysis?.status !== 'CALCULATED'
      || !taxContext?.fiscalYear || analysis.fiscalYear !== taxContext.fiscalYear
      || taxContext.sttConditionAssumedSatisfied !== true
      || metadata?.sourceQualified !== true
      || taxClass !== PRODUCT_TAX_CLASSES.EQUITY_MF_112A
      || !matchesProductEvidence(metadata?.productEvidence)
      || !matchesProductEvidence(analysis?.taxClassificationMetadata?.productEvidence)
      || analysis.taxClass !== taxClass || analysis.taxClassification !== taxClass
      || !Array.isArray(metadata.sourceReferences) || metadata.sourceReferences.length === 0
      || !metadata.sourceReferences.every(hasQualifiedTaxReference)
      || !Array.isArray(analysis.sourceReferences) || analysis.sourceReferences.length === 0
      || !analysis.sourceReferences.every(hasQualifiedTaxReference)
      || !metadata.sourceReferences.every(reference => analysis.sourceReferences.some(candidate =>
        candidate.authority === reference.authority
        && candidate.title === reference.title
        && candidate.url === reference.url
        && candidate.role === reference.role))) return false;

  const officialActUrl = 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf';
  const productSourceMatches = analysis.sourceReferences.some(reference =>
    reference.authority === expectedEvidence.authority
    && reference.url === expectedEvidence.officialSourceUrl
    && reference.role === 'PRODUCT_RULE');
  const statutorySourceMatches = analysis.sourceReferences.some(reference =>
    reference.authority === 'Income Tax Department — Government of India'
    && reference.url === officialActUrl
    && reference.role === 'TAX_POLICY');
  const taxRuleMetadata = analysis.taxRuleMetadata;
  const ruleReferences = Array.isArray(taxRuleMetadata?.currentRuleReferences)
    ? taxRuleMetadata.currentRuleReferences
    : [];
  const currentRuleIds = Array.isArray(taxRuleMetadata?.currentRuleIds) ? taxRuleMetadata.currentRuleIds : [];
  const appliedRules = Array.isArray(analysis.rulesApplied) ? analysis.rulesApplied : [];
  const shortTermRuleId = 'INCOME_TAX_ACT_2025_EQUITY_STCG_SPECIAL_RATE_POLICY';
  const longTermRuleId = 'INCOME_TAX_ACT_2025_EQUITY_LTCG_SPECIAL_RATE_POLICY';
  const usesShortTermRule = appliedRules.includes(shortTermRuleId);
  const usesLongTermRule = appliedRules.includes(longTermRuleId);
  const applicableRuleId = usesShortTermRule === usesLongTermRule
    ? null
    : usesShortTermRule ? shortTermRuleId : longTermRuleId;
  const applicableSection = usesShortTermRule ? 'Section 196' : 'Section 198';
  const statutoryRuleMatches = applicableRuleId
    && currentRuleIds.includes(applicableRuleId)
    && ruleReferences.some(reference => reference?.ruleId === applicableRuleId
      && reference?.reference === applicableSection
      && reference?.statute === 'INCOME_TAX_ACT_2025'
      && Array.isArray(reference?.sourceReferences)
      && reference.sourceReferences.some(source => source?.url === officialActUrl));
  if (!productSourceMatches || !statutorySourceMatches || !statutoryRuleMatches
      || taxRuleMetadata?.statute !== 'INCOME_TAX_ACT_2025'
      || taxRuleMetadata?.fiscalYear !== taxContext.fiscalYear
      || taxRuleMetadata?.taxYear !== 'TY2026-27'
      || !analysis.assumptions?.includes('STT_CONDITION_ASSUMED_SATISFIED_FOR_HYPOTHETICAL_TRANSFER')) return false;

  let activePolicyVersion;
  try {
    activePolicyVersion = getTaxPolicyMetadata(taxContext.fiscalYear)?.policyVersion;
  } catch {
    return false;
  }
  if (!activePolicyVersion || analysis.policyVersion !== activePolicyVersion
      || analysis.calculationClass !== 'HISTORICAL_RETURN_POST_TAX_ILLUSTRATION'
      || analysis.inputBasis !== 'HISTORICAL_PROVIDER_FACT_PLUS_EXPLICIT_TAX_INPUTS'
      || analysis.dataClass !== 'HISTORICAL_PROVIDER_FACT'
      || analysis.isHistoricalEstimate !== true
      || analysis.historicalObservationWindowMonths !== 12
      || typeof analysis.disclosure !== 'string'
      || !/HISTORICAL\s*[—-]\s*NOT A FORECAST/i.test(analysis.disclosure)
      || product.historicalReturn?.basis !== 'HISTORICAL_POINT_TO_POINT_NAV_RETURN_1Y'
      || product.historicalReturn?.annualized !== true
      || product.historicalReturn?.isExpectedReturn !== false
      || !Number.isFinite(product.historicalReturn?.valuePct)) return false;

  return CALCULATED_TAX_FIELDS.every(field => Number.isFinite(analysis[field]))
    && analysis.principal > 0
    && analysis.incrementalTax >= 0
    && analysis.cess >= 0
    && analysis.surcharge >= 0
    && analysis.exemptionApplied >= 0;
}

function isTimestampWithin(timestamp, nowMs, maximumAgeSeconds) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value)
    && value <= nowMs
    && nowMs - value <= maximumAgeSeconds * 1000;
}

function isQualifiedNseCalendar(calendar, nowMs) {
  return calendar?.status === 'AVAILABLE'
    && calendar.source?.provider === 'NSE'
    && calendar.source?.url === NSE_TRADING_HOLIDAY_URL
    && isTimestampWithin(calendar.fetchedAt, nowMs, NSE_TRADING_HOLIDAY_CACHE_TTL_SECONDS);
}

function sourceFor(snapshot, { url, instrumentId }) {
  const matches = (Array.isArray(snapshot?.provenance?.sources) ? snapshot.provenance.sources : []).filter(source => (
    source?.provider === 'NSE' && source.url === url && source.instrumentId === instrumentId
  ));
  return matches.length === 1 ? matches[0] : null;
}

function assessSessionEvidence({ snapshot, nifty, vix, now }) {
  const nowParts = indiaClockParts(now);
  const nowMs = now.getTime();
  const today = nowParts?.isoDate;
  const session = snapshot?.marketSession;
  const checkedAt = indiaClockParts(session?.checkedAt);
  if (!today || !checkedAt || session?.tradingDate !== today || checkedAt.isoDate !== today
      || snapshot?.recoveredFromLastKnownGood === true
      || !isTimestampWithin(session.checkedAt, nowMs, NSE_QUOTE_CACHE_TTL_SECONDS)
      || snapshot?.providerSelection?.selectedProvider !== 'NSE'
      || snapshot?.providerStatus?.quotes?.provider !== 'NSE'
      || snapshot?.providerStatus?.history?.provider !== 'NSE'
      || snapshot?.providerStatus?.quotes?.status !== 'AVAILABLE'
      || snapshot?.providerStatus?.history?.status !== 'AVAILABLE'
      || snapshot?.providerStatus?.quotes?.qualification !== NSE_ENDPOINT_QUALIFICATION
      || snapshot?.providerStatus?.history?.qualification !== NSE_ENDPOINT_QUALIFICATION
      || snapshot?.provenance?.qualification !== NSE_ENDPOINT_QUALIFICATION
      || !isQualifiedNseCalendar(snapshot?.providerStatus?.quotes?.calendar, nowMs)
      || !isQualifiedNseCalendar(snapshot?.providerStatus?.history?.calendar, nowMs)) {
    return { valid: false, detail: 'current NSE session/calendar provenance is missing, stale, or inconsistent with today in IST' };
  }

  const niftySource = sourceFor(snapshot, { url: NSE_ALL_INDICES_URL, instrumentId: 'NIFTY 50' });
  const vixSource = sourceFor(snapshot, { url: NSE_ALL_INDICES_URL, instrumentId: 'INDIA VIX' });
  const historySource = sourceFor(snapshot, { url: NSE_HISTORICAL_INDEX_URL, instrumentId: 'NIFTY 50' });
  if (!niftySource || !vixSource || !historySource
      || nifty?.source?.url !== NSE_ALL_INDICES_URL || nifty.source.instrumentId !== 'NIFTY 50'
      || vix?.source?.url !== NSE_ALL_INDICES_URL || vix.source.instrumentId !== 'INDIA VIX'
      || niftySource.observedAt !== nifty?.observedAt
      || vixSource.observedAt !== vix?.observedAt
      || niftySource.providerTimestamp !== nifty?.observedAt
      || vixSource.providerTimestamp !== vix?.observedAt
      || historySource.providerTimestamp !== historySource.observedAt
      || niftySource.freshness?.status !== 'FRESH'
      || vixSource.freshness?.status !== 'FRESH'
      || historySource.freshness?.status !== 'FRESH'
      || !/^\d{4}-\d{2}-\d{2}$/.test(niftySource.effectiveTradingDate || '')
      || niftySource.effectiveTradingDate !== vixSource.effectiveTradingDate
      || niftySource.effectiveTradingDate !== isoDateInIndia(nifty?.observedAt)
      || vixSource.effectiveTradingDate !== isoDateInIndia(vix?.observedAt)
      || historySource.effectiveTradingDate !== isoDateInIndia(historySource.observedAt)
      || !snapshot?.derivedFacts?.some(fact => fact.availabilityStatus === 'AVAILABLE'
        && Number.isFinite(fact.value) && fact.freshness?.status === 'FRESH')) {
    return { valid: false, detail: 'NSE quote/history provenance does not prove a coherent fresh session' };
  }

  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const weekday = todayDate.getUTCDay();
  const quoteDate = niftySource.effectiveTradingDate;
  const historyDate = historySource.effectiveTradingDate;
  const freshnessMatchesSession = [nifty, vix].every(fact => (
    fact.freshness?.marketSession === session.status
    && fact.freshness?.tradingDate === today
  ));
  const withinTradingHours = parts => {
    const minute = parts.hour * 60 + parts.minute;
    return minute >= (9 * 60 + 15) && minute <= (15 * 60 + 30);
  };

  if (session.status === NSE_MARKET_SESSION.OPEN) {
    const currentMinute = nowParts.hour * 60 + nowParts.minute;
    const checkedMinute = checkedAt.hour * 60 + checkedAt.minute;
    const quoteIsIntraday = [nifty, vix].every(fact => fact.dataClass === 'LIVE'
      && isoDateInIndia(fact.observedAt) === today);
    return {
      valid: snapshot.status === 'CURRENT'
        && withinTradingHours(nowParts)
        && withinTradingHours(checkedAt)
        && checkedMinute <= currentMinute
        && freshnessMatchesSession
        && quoteDate === today
        && isoDateInIndia(vix?.observedAt) === today
        && quoteIsIntraday
        && historyDate < today
        && historyDate <= quoteDate,
      detail: 'MARKET_OPEN requires today’s fresh source-qualified intraday quotes and completed daily history',
    };
  }

  if (session.status === NSE_MARKET_SESSION.HOLIDAY) {
    const coherentCompletedSession = quoteDate < today
      && historyDate === quoteDate
      && isoDateInIndia(nifty?.observedAt) === quoteDate
      && isoDateInIndia(vix?.observedAt) === quoteDate;
    return {
      valid: snapshot.status === 'MARKET_CLOSED'
        && freshnessMatchesSession
        && coherentCompletedSession,
      detail: 'MARKET_HOLIDAY requires today’s verified NSE holiday session and matching latest-completed-session NIFTY/VIX/history; it does not assert an intraday quote',
    };
  }

  if (session.status === NSE_MARKET_SESSION.CLOSED) {
    if (weekday === 0 || weekday === 6) {
      // Freshness is computed by the NSE adapter against its qualified
      // trading-calendar snapshot. On weekends it therefore identifies the
      // latest completed session without reclassifying the weekend as an
      // exchange holiday or claiming an intraday quote.
      const coherentCompletedSession = quoteDate < today
        && historyDate === quoteDate
        && isoDateInIndia(nifty?.observedAt) === quoteDate
        && isoDateInIndia(vix?.observedAt) === quoteDate;
      return {
        valid: snapshot.status === 'MARKET_CLOSED'
          && freshnessMatchesSession
          && coherentCompletedSession,
        detail: 'MARKET_WEEKEND: weekend non-trading session verified against matching latest-completed-session NIFTY/VIX/history; no intraday quote is asserted',
      };
    }

    const afterRegularClose = nowParts.hour * 60 + nowParts.minute > (15 * 60 + 30)
      && checkedAt.hour * 60 + checkedAt.minute > (15 * 60 + 30)
      && checkedAt.hour * 60 + checkedAt.minute <= nowParts.hour * 60 + nowParts.minute;
    const quoteIsTodayClose = [nifty, vix].every(fact => fact.dataClass === 'LIVE'
      && isoDateInIndia(fact.observedAt) === today);
    return {
      valid: snapshot.status === 'MARKET_CLOSED'
        && weekday >= 1 && weekday <= 5
        && afterRegularClose
        && freshnessMatchesSession
        && quoteDate === today
        && quoteIsTodayClose
        && historyDate < today
        && historyDate <= quoteDate,
      detail: 'MARKET_CLOSED is accepted only after the regular weekday session with today’s completed close and prior completed daily history',
    };
  }

  return { valid: false, detail: `unsupported or unknown NSE session status: ${String(session.status || 'missing')}` };
}

export function assessCurrentMarketContext(result, { now = new Date() } = {}) {
  const clock = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(clock.getTime())) throw new TypeError('now must be a valid date.');
  const body = result?.body;
  const snapshot = body?.marketSnapshot;
  const facts = Array.isArray(snapshot?.observedFacts) ? snapshot.observedFacts : [];
  const selection = snapshot?.providerSelection || body?.liveProviderSelection || null;
  const selectedProvider = selection?.selectedProvider || null;
  const quote = key => facts.find(fact => fact.key === key) || null;
  const nifty = quote('nifty50Current');
  const vix = quote('indiaVixCurrent');
  const providerStatus = snapshot?.providerStatus || {};
  const coherentProviderPair = Boolean(selectedProvider)
    && providerStatus.quotes?.provider === selectedProvider
    && providerStatus.history?.provider === selectedProvider
    && nifty?.source?.provider === selectedProvider
    && vix?.source?.provider === selectedProvider;
  const isFreshQuote = fact => Boolean(fact)
    && fact.availabilityStatus === 'AVAILABLE'
    && typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value > 0
    && typeof fact.observedAt === 'string' && Number.isFinite(Date.parse(fact.observedAt))
    && fact.freshness?.status === 'FRESH'
    && fact.source?.provider === selectedProvider;
  const hasHistory = providerStatus.history?.provider === selectedProvider
    && Array.isArray(snapshot?.derivedFacts)
    && snapshot.derivedFacts.some(fact => fact.availabilityStatus === 'AVAILABLE'
      && typeof fact.value === 'number' && Number.isFinite(fact.value)
      && fact.freshness?.status === 'FRESH');
  const sessionAssessment = assessSessionEvidence({ snapshot, nifty, vix, now: clock });
  const marketContextAvailable = result?.response?.ok === true
    && body?.status === 'MARKET_CONTEXT_AVAILABLE'
    && snapshot?.availability === 'AVAILABLE'
    && snapshot?.policyAvailability === 'AVAILABLE'
    && snapshot?.policyOutput?.status === 'MARKET_CONTEXT_AVAILABLE'
    && body?.recommendationUsability?.status === 'USABLE'
    && snapshot?.recommendationUsability?.status === 'USABLE'
    && coherentProviderPair
    && isFreshQuote(nifty) && isFreshQuote(vix)
    && hasHistory
    && typeof snapshot?.observedAt === 'string'
    && Number.isFinite(Date.parse(snapshot.observedAt))
    && facts.every(fact => fact.availabilityStatus !== 'AVAILABLE'
      || (fact.source?.provider === selectedProvider
        && fact.observedAt && fact.freshness?.status === 'FRESH'))
    && sessionAssessment.valid;
  return {
    selectedProvider,
    niftyAvailable: result?.response?.ok === true && isFreshQuote(nifty),
    vixAvailable: result?.response?.ok === true && isFreshQuote(vix),
    hasHistory,
    marketContextAvailable,
    sessionStatus: snapshot?.marketSession?.status || 'UNKNOWN',
    sessionDetail: sessionAssessment.detail,
  };
}

export const EXPECTED_PREFLIGHT_CHECKS = Object.freeze([
  'Explicit live-demo mode',
  'Backend URL configuration',
  'Profile completion payload',
  'Tax input payload',
  'Backend',
  'Backend readiness',
  'Mongo/transaction support',
  'Redis if required',
  'Market provider configuration',
  'NIFTY quote',
  'VIX quote',
  'Market history',
  'Market context',
  'Provider token presence',
  'Tax-policy metadata',
  'Profile completion/auth',
  'Recommendation current-state binding',
  'ETF product source',
  'Nifty ETF exact-product result',
  'Product tax workflow',
  'Critical browser path',
  'Production frontend build',
]);

export function makeReporter(write = line => process.stdout.write(`${line}\n`)) {
  const checks = EXPECTED_PREFLIGHT_CHECKS.map(name => ({
    name,
    passed: false,
    state: 'NOT_EVALUATED',
    detail: 'NOT_EVALUATED because this check has not run',
  }));
  const evaluated = new Set();
  let finalized = false;
  return {
    get checks() { return checks.map(check => ({ ...check })); },
    add(name, passed, detail) {
      if (finalized) throw new Error('Cannot add preflight checks after finalization.');
      const check = checks.find(candidate => candidate.name === name);
      if (!check) throw new Error(`Unexpected preflight check: ${name}`);
      if (evaluated.has(name)) throw new Error(`Preflight check already evaluated: ${name}`);
      if (typeof passed !== 'boolean') throw new TypeError(`Preflight check outcome must be boolean: ${name}`);
      check.passed = passed;
      check.state = passed ? 'PASS' : 'FAIL';
      check.detail = String(detail || (passed ? 'verified' : 'failed'));
      evaluated.add(name);
    },
    finish() {
      if (!finalized) {
        finalized = true;
        for (const check of checks) {
          if (!evaluated.has(check.name)) {
            check.passed = false;
            check.state = 'NOT_EVALUATED';
            check.detail = 'NOT_EVALUATED because a prerequisite failed or the check was not reached';
          }
        }
        let writeFailure = null;
        for (const check of checks) {
          try { write(`${check.passed ? 'PASS' : 'FAIL'} ${check.name} — ${check.detail}`); } catch (error) { writeFailure ||= error; }
        }
        if (writeFailure) throw writeFailure;
      }
      const passed = checks.filter(check => check.passed).length;
      return {
        checks: checks.map(check => ({ ...check })),
        passed,
        failed: checks.length - passed,
        total: checks.length,
      };
    },
    get failed() { return checks.some(check => !check.passed); },
  };
}

function safeStableCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null;
}

function safeFailureKind(error) {
  const code = safeStableCode(error?.code) || safeStableCode(error?.cause?.code);
  const name = ['AbortError', 'AssertionError', 'Error', 'RangeError', 'SyntaxError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name.toUpperCase()
    : null;
  const timeout = error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR'].includes(code);
  return { kind: timeout ? 'timeout' : 'network/stage error', code, name };
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function emitSafeTiming(onTiming, event) {
  if (typeof onTiming !== 'function') return;
  try { onTiming(event); } catch { /* diagnostic hooks must not change request behavior */ }
}

function responseStatus(response) {
  return Number(typeof response?.status === 'function' ? response.status() : response?.status) || 0;
}

function responseOk(response) {
  return typeof response?.ok === 'function' ? response.ok() : response?.ok === true;
}

function isFinancialProviderRequestUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return FINANCIAL_PROVIDER_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return null;
  }
}

async function readSafeResponseBody(response) {
  try {
    const body = await response.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function reportWtiNotEvaluated(reporter, reason) {
  reporter.add('Nifty ETF exact-product result', false, `NOT_EVALUATED because ${reason}`);
  reporter.add('Product tax workflow', false, `NOT_EVALUATED because ${reason}`);
}

export async function reportWtiProductChecks(reporter, {
  requestWti,
  recommendation,
  parentInstrumentId,
  taxContext,
  onTiming,
  timeoutMs = WTI_USER_FLOW_TIMEOUT_MS,
  timerOptions,
} = {}) {
  if (parentInstrumentId !== 'nifty_etf') {
    reporter.add('ETF product source', false, 'NOT_EVALUATED because the exact qualified Nifty ETF parent is not configured');
    reportWtiNotEvaluated(reporter, 'the exact qualified Nifty ETF parent is not configured');
    return;
  }

  const startedAt = performance.now();
  let timingStatus = 'NOT_STARTED';
  let timingCode = null;
  try {
    const response = await withVerifierDeadline(
      Promise.resolve().then(requestWti),
      Math.min(timeoutMs, WTI_USER_FLOW_TIMEOUT_MS),
      timerOptions,
    );
    const status = responseStatus(response);
    timingStatus = `HTTP_${status || 'UNKNOWN'}`;
    const body = await readSafeResponseBody(response);
    if (!responseOk(response)) {
      timingCode = safeStableCode(body?.code);
      const detail = `WTI HTTP ${status || 'unknown'}${timingCode ? ` (${timingCode})` : ''}; ${elapsedMilliseconds(startedAt)}ms`;
      reporter.add('ETF product source', false, detail);
      reportWtiNotEvaluated(reporter, `WTI returned HTTP ${status || 'unknown'}`);
      return;
    }
    if (!body) {
      timingStatus = 'MALFORMED_JSON';
      timingCode = 'MALFORMED_JSON';
      reporter.add('ETF product source', false, `WTI response contained malformed JSON; ${elapsedMilliseconds(startedAt)}ms`);
      reportWtiNotEvaluated(reporter, 'WTI response could not be parsed');
      return;
    }

    const products = Array.isArray(body.products) ? body.products : [];
    const bindingValid = matchesRecommendationBinding(body.financialStateBinding, recommendation);
    const responseQualified = qualifiesWtiResponse(body, recommendation, parentInstrumentId);
    const exactProducts = bindingValid ? products.filter(qualifiesExactNiftyEtf) : [];
    const uniqueQualifiedProduct = responseQualified ? products[0] : null;
    const wtiElapsedMs = elapsedMilliseconds(startedAt);
    reporter.add('ETF product source', Boolean(uniqueQualifiedProduct), uniqueQualifiedProduct
      ? `exact identity, NIFTY 50 benchmark, official HTTPS source, fresh primary fact, and provenance verified; ${wtiElapsedMs}ms`
      : exactProducts.length > 1
        ? `ambiguous duplicate exact-product results (${exactProducts.length}); ${wtiElapsedMs}ms`
        : `WTI HTTP ${status || 200}, incoherent route metadata, mismatched financial binding, or no exact product passed identity/source/freshness checks; ${wtiElapsedMs}ms`);
    reporter.add('Nifty ETF exact-product result', Boolean(uniqueQualifiedProduct), uniqueQualifiedProduct
      ? 'one exact qualified product in a coherent single-option response'
      : exactProducts.length > 1 ? 'ambiguous duplicate exact-product results' : bindingValid
        ? 'no exact source-qualified Nifty 50 ETF result'
        : 'WTI response financial-state binding did not match the current recommendation');

    const taxStartedAt = performance.now();
    const validTaxResult = Boolean(taxContext && uniqueQualifiedProduct)
      && qualifiesCalculatedNiftyEtfTax(uniqueQualifiedProduct, taxContext, {
        financialBindingValid: responseQualified,
      });
    const taxStatus = uniqueQualifiedProduct?.postTaxAnalysis?.status;
    reporter.add('Product tax workflow', validTaxResult, validTaxResult
      ? `exact-product tax calculation is bound to the supplied fiscal year; ${elapsedMilliseconds(taxStartedAt)}ms`
      : !taxContext
        ? 'TAX_INPUTS_UNAVAILABLE; provide actual required tax facts; no tax values are inferred'
        : !uniqueQualifiedProduct
          ? 'NOT_EVALUATED because no exact current product passed identity and financial-state checks'
          : safeStableCode(taxStatus)
            ? `${safeStableCode(taxStatus)}; no tax values are inferred`
            : 'exact-product tax result is not calculated; no tax values are inferred');
    timingStatus = 'COMPLETED';
  } catch (error) {
    const failure = safeFailureKind(error);
    timingStatus = failure.kind === 'timeout' ? 'TIMEOUT' : 'NETWORK_ERROR';
    timingCode = failure.code;
    const errorDetail = `WTI ${failure.kind}${failure.code ? ` (${failure.code})` : ''}; ${elapsedMilliseconds(startedAt)}ms`;
    reporter.add('ETF product source', false, errorDetail);
    reportWtiNotEvaluated(reporter, 'WTI request failed');
  } finally {
    emitSafeTiming(onTiming, {
      stage: 'rank_wti_request',
      elapsedMs: elapsedMilliseconds(startedAt),
      status: timingStatus,
      ...(timingCode ? { code: timingCode } : {}),
    });
  }
}

export function isRedisRequired(environment = process.env) {
  const explicit = value => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  return environment.NODE_ENV === 'production'
    || explicit(environment.REQUIRE_REDIS)
    || explicit(environment.DEMO_REQUIRE_REDIS);
}

export function withVerifierDeadline(promise, timeoutMs, timerOptions = {}) {
  const setTimer = timerOptions.setTimeout || setTimeout;
  const clearTimer = timerOptions.clearTimeout || clearTimeout;
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimer(() => reject(Object.assign(new Error('Verifier request timed out.'), {
        name: 'TimeoutError',
        code: 'ETIMEDOUT',
      })), timeoutMs);
    }),
  ]).finally(() => clearTimer(timer));
}

export async function readJson(url, {
  timeoutMs = BACKEND_HTTP_HARD_TIMEOUT_MS,
  fetchImpl = fetch,
  createAbortSignal = milliseconds => AbortSignal.timeout(milliseconds),
  timerOptions,
  ...options
} = {}) {
  const response = await withVerifierDeadline(
    fetchImpl(url, { ...options, signal: createAbortSignal(timeoutMs) }),
    timeoutMs,
    timerOptions,
  );
  let body = null;
  try { body = await response.json(); } catch { /* the caller records a safe status */ }
  return { response, body };
}

function safeHttpDetail(result) {
  if (!result) return 'request unavailable';
  if (!result.response.ok) {
    const code = safeStableCode(result.body?.code);
    return `HTTP ${result.response.status}${code ? ` (${code})` : ''}`;
  }
  return 'verified';
}

function marketQuoteDetail(result, assessment, quoteAvailable) {
  if (!quoteAvailable) return safeHttpDetail(result);
  if (assessment.sessionStatus === NSE_MARKET_SESSION.HOLIDAY) {
    return 'fresh source-qualified latest completed-session observation; not an intraday quote';
  }
  if (assessment.sessionStatus === NSE_MARKET_SESSION.CLOSED) {
    if (assessment.sessionDetail.startsWith('MARKET_WEEKEND:')) {
      return 'MARKET_WEEKEND: fresh source-qualified latest-completed-session observation; not an intraday quote';
    }
    return assessment.marketContextAvailable
      ? 'fresh source-qualified same-day completed-session close; not an intraday quote'
      : 'fresh source-qualified completed-session observation; not an intraday quote';
  }
  if (assessment.sessionStatus === NSE_MARKET_SESSION.OPEN) {
    return 'fresh source-qualified observation from the current NSE session';
  }
  return 'provider reports a fresh observation, but current NSE session status is not independently verified';
}

async function readConfiguredJson(filePath, label, reporter) {
  if (!filePath) {
    reporter.add(label, false, 'configure the required JSON file path');
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new TypeError('Expected a JSON object.');
    reporter.add(label, true, 'valid JSON object loaded; contents are never printed');
    return parsed;
  } catch {
    reporter.add(label, false, 'file must contain one valid JSON object; contents are never printed');
    return null;
  }
}

async function checkMongoTransaction(reporter, { verification } = {}) {
  const mongo = verification?.mongo;
  const passed = mongo?.connected === true && mongo?.transactionCapable === true;
  reporter.add('Mongo/transaction support', passed, passed
    ? 'the running backend verified a read-only transaction on its connected MongoDB'
    : 'the running backend did not verify transaction capability on its connected MongoDB');
}

async function checkRedis(reporter, { environment = process.env, verification } = {}) {
  const runtimeRedis = verification?.redis;
  const required = runtimeRedis?.required === true || isRedisRequired(environment);
  if (!required) {
    reporter.add('Redis if required', true, runtimeRedis
      ? 'Redis is optional in the running backend; no separate connection was opened'
      : 'Redis is not declared as a live-demo critical dependency');
    return;
  }
  const policyMatches = runtimeRedis?.required === true || !isRedisRequired(environment);
  const passed = policyMatches && runtimeRedis?.connected === true;
  reporter.add('Redis if required', passed, passed
    ? 'the running backend verified Redis PING on its connected client'
    : 'required Redis was not verified on the running backend connection');
}

export async function checkBrowserAndFinancialFlow(reporter, {
  apiBase,
  frontendUrl,
  completionPayload,
  taxContext,
  email = process.env.DEMO_EMAIL,
  password = process.env.DEMO_PASSWORD,
  idempotencyKey = process.env.DEMO_COMPLETION_IDEMPOTENCY_KEY,
  parentInstrumentId = process.env.DEMO_NIFTY_ETF_PARENT_ID,
  expectedBuildSha = process.env.DEMO_EXPECTED_BUILD_SHA,
}, { launchBrowser, onTiming } = {}) {
  if (!frontendUrl || !email || !password) {
    reporter.add('Critical browser path', false, 'browser launch/navigation NOT_EVALUATED because demo browser configuration is missing');
    reporter.add('Profile completion/auth', false, 'NOT_EVALUATED because demo identity configuration is missing');
    reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because authentication was not run');
    reporter.add('ETF product source', false, 'NOT_EVALUATED because authentication was not run');
    reportWtiNotEvaluated(reporter, 'authentication was not run');
    return;
  }

  let browser;
  let context;
  let page;
  let browserLaunched = false;
  let loginPageRendered = false;
  let frontendBuildVerified = false;
  let authenticated = false;
  let verifiedRecommendation = null;
  let providerRequestObserved = false;
  let providerRequestInspectionFailed = false;
  let criticalPathRecorded = false;
  let browserJourneyStage = 'profile navigation';
  const recordCriticalPath = (passed, detail) => {
    reporter.add('Critical browser path', passed, detail);
    criticalPathRecorded = true;
  };
  try {
    try {
      const frontend = new URL(frontendUrl);
      const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (!['http:', 'https:'].includes(frontend.protocol)
          || (frontend.protocol !== 'https:' && !localHosts.has(frontend.hostname))
          || frontend.username || frontend.password || frontend.search || frontend.hash) {
        throw new Error('Unsafe frontend URL configuration.');
      }
      if (launchBrowser) {
        browser = await launchBrowser();
      } else {
        const requireFromReactapp = createRequire(path.join(REACTAPP_DIR, 'package.json'));
        const { chromium } = requireFromReactapp('@playwright/test');
        browser = await chromium.launch({ headless: true });
      }
      if (!browser || typeof browser.newContext !== 'function') {
        throw Object.assign(new Error('Browser launch returned an invalid browser handle.'), { code: 'BROWSER_HANDLE_INVALID' });
      }
      browserLaunched = true;
      context = await browser.newContext();
      page = await context.newPage();
      page.on('request', request => {
        try {
          const providerRequest = isFinancialProviderRequestUrl(request.url());
          if (providerRequest === null) providerRequestInspectionFailed = true;
          else if (providerRequest) providerRequestObserved = true;
        } catch {
          providerRequestInspectionFailed = true;
        }
      });

      const frontendResponse = await page.goto(new URL('/login', frontendUrl).toString(), { waitUntil: 'domcontentloaded' });
      if (!frontendResponse) throw Object.assign(new Error('No HTTP response.'), { code: 'NO_HTTP_RESPONSE' });
      if (!responseOk(frontendResponse)) {
        throw Object.assign(new Error('Navigation returned non-success HTTP status.'), {
          code: 'HTTP_STATUS',
          status: responseStatus(frontendResponse),
        });
      }
      const loginReadyTimeoutMs = LOGIN_BROWSER_TIMEOUT_MS;
      await Promise.all([
        page.locator('#login-form'),
        page.locator('#login-email'),
        page.locator('#login-password'),
      ].map(locator => locator.waitFor({ state: 'visible', timeout: loginReadyTimeoutMs })));
      const reportedFrontendBuildSha = await page.evaluate(() => globalThis.document.documentElement.dataset.buildSha || null);
      frontendBuildVerified = matchesBuildSha(expectedBuildSha, reportedFrontendBuildSha);
      loginPageRendered = true;
    } catch (error) {
      const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
      const failure = safeFailureKind(error);
      recordCriticalPath(false, `browser launch/navigation failed${status} (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
      reporter.add('Profile completion/auth', false, 'NOT_EVALUATED because browser launch/navigation failed');
      reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because browser launch/navigation failed');
      reporter.add('ETF product source', false, 'NOT_EVALUATED because browser launch/navigation failed');
      reportWtiNotEvaluated(reporter, 'browser launch/navigation failed');
      return;
    }

    try {
      await page.locator('#login-email').fill(email);
      await page.locator('#login-password').fill(password);
      const configuredApiOrigin = new URL(apiBase).origin;
      const loginResponsePromise = page.waitForResponse(response => {
        const responseUrl = new URL(response.url());
        return response.request().method() === 'POST'
          && responseUrl.origin === configuredApiOrigin
          && responseUrl.pathname.endsWith('/api/auth/login');
      }, { timeout: LOGIN_BROWSER_TIMEOUT_MS });
      await page.locator('#login-form button[type="submit"]').click();
      const loginResponse = await loginResponsePromise;
      if (!responseOk(loginResponse)) {
        throw Object.assign(new Error('Login returned non-success HTTP status.'), {
          code: 'HTTP_STATUS', status: responseStatus(loginResponse),
        });
      }
      authenticated = true;
    } catch (error) {
      const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
      const failure = safeFailureKind(error);
      reporter.add('Profile completion/auth', false, `authentication failed${status} (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
      reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because authentication failed');
      reporter.add('ETF product source', false, 'NOT_EVALUATED because authentication failed');
      reportWtiNotEvaluated(reporter, 'authentication failed');
    }

    if (authenticated) {
      let profileId = null;
      if (!completionPayload || !idempotencyKey || idempotencyKey.length > 200) {
        reporter.add('Profile completion/auth', false, 'profile completion NOT_EVALUATED because payload or stable idempotency key is missing');
      } else {
        try {
          const csrf = (await context.cookies(apiBase)).find(cookie => cookie.name === 'wg_csrf')?.value;
          if (!csrf) throw Object.assign(new Error('CSRF cookie unavailable.'), { code: 'CSRF_COOKIE_MISSING' });
          const completion = await page.request.post(`${apiBase}/profile/complete`, {
            data: completionPayload,
            headers: {
              'X-CSRF-Token': csrf,
              'Idempotency-Key': idempotencyKey,
              Origin: new URL(frontendUrl).origin,
            },
            timeout: PROFILE_USER_FLOW_TIMEOUT_MS,
          });
          const completionBody = await readSafeResponseBody(completion);
          const completedProfileId = completionBody?.profile?.profileId;
          const completed = responseOk(completion) && Boolean(completedProfileId);
          const code = safeStableCode(completionBody?.code);
          reporter.add('Profile completion/auth', completed, completed
            ? 'profile completion committed or safely replayed'
            : `profile completion HTTP ${responseStatus(completion)}${code ? ` (${code})` : ''}`);
          if (completed) profileId = completedProfileId;
        } catch (error) {
          const failure = safeFailureKind(error);
          reporter.add('Profile completion/auth', false, `profile completion failed (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
        }
      }

      if (!profileId) {
        try {
          const profileResult = await page.request.get(`${apiBase}/profile/current`);
          const profile = responseOk(profileResult) ? await readSafeResponseBody(profileResult) : null;
          profileId = profile?.profileId || null;
        } catch { /* record the safe unavailable state below */ }
      }

      if (!profileId) {
        reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because an authenticated current profile could not be resolved');
        reporter.add('ETF product source', false, 'NOT_EVALUATED because an authenticated current profile could not be resolved');
        reportWtiNotEvaluated(reporter, 'an authenticated current profile could not be resolved');
      } else {
        let recommendation = null;
        let bindingValid = false;
        try {
          const recommendationResult = await page.request.get(`${apiBase}/recommend/current?profileId=${encodeURIComponent(profileId)}`);
          recommendation = responseOk(recommendationResult) ? await readSafeResponseBody(recommendationResult) : null;
          bindingValid = responseOk(recommendationResult)
            && hasCurrentFinancialBinding(recommendation)
            && recommendation.profileId === profileId;
          reporter.add('Recommendation current-state binding', bindingValid, bindingValid
            ? 'CURRENT response contains profile/recommendation/allocation fingerprints and fresh provenance'
            : `HTTP ${responseStatus(recommendationResult)} or incomplete/stale current-state binding`);
        } catch (error) {
          const failure = safeFailureKind(error);
          reporter.add('Recommendation current-state binding', false, `current recommendation lookup failed (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
        }

        if (!bindingValid) {
          reporter.add('ETF product source', false, 'NOT_EVALUATED because current recommendation state is missing or stale');
          reportWtiNotEvaluated(reporter, 'current recommendation state is missing or stale');
        } else {
          verifiedRecommendation = recommendation;
          let csrf = '';
          try { csrf = (await context.cookies(apiBase)).find(cookie => cookie.name === 'wg_csrf')?.value || ''; } catch { /* request fails closed */ }
          await reportWtiProductChecks(reporter, {
            recommendation,
            parentInstrumentId,
            taxContext,
            onTiming,
            requestWti: () => page.request.post(`${apiBase}/instruments/rank-wti`, {
              data: {
                profileId,
                profileVersion: recommendation.profile_version,
                recommendationId: recommendation.recommendationId,
                expectedAllocationRevision: recommendation.allocation_revision,
                expectedAllocationRevisionId: recommendation.allocation_revision_id,
                expectedPortfolioFingerprint: recommendation.portfolio_fingerprint,
                expectedRecommendationFingerprint: recommendation.recommendation_fingerprint,
                parentInstrumentId,
                ...(taxContext ? { taxCalculationContext: taxContext } : {}),
              },
              headers: {
                'X-CSRF-Token': csrf,
                'Idempotency-Key': randomUUID(),
                Origin: new URL(frontendUrl).origin,
              },
              timeout: WTI_USER_FLOW_TIMEOUT_MS,
            }),
          });
        }
      }

      try {
        browserJourneyStage = 'profile navigation';
        const profileResponse = await page.goto(new URL('/profile', frontendUrl).toString(), { waitUntil: 'domcontentloaded' });
        if (!profileResponse) throw Object.assign(new Error('Profile navigation returned no HTTP response.'), { code: 'NO_HTTP_RESPONSE' });
        if (!responseOk(profileResponse)) {
          throw Object.assign(new Error('Profile navigation returned a non-success HTTP status.'), {
            code: 'HTTP_STATUS',
            status: responseStatus(profileResponse),
          });
        }
        const dashboard = page.locator('aside.sidebar');
        await dashboard.waitFor({ state: 'visible', timeout: DASHBOARD_BROWSER_TIMEOUT_MS });
        const sidebarVisible = await dashboard.isVisible();
        const profilePath = new URL(page.url()).pathname;
        const dashboardVisible = hasAuthenticatedDashboard({
          pathname: profilePath,
          sidebarVisible,
        });

        if (!dashboardVisible) {
          throw Object.assign(new Error('Authenticated dashboard was not available for the investment flow.'), {
            code: 'DASHBOARD_NOT_READY',
          });
        }
        if (parentInstrumentId !== 'nifty_etf') {
          throw Object.assign(new Error('The exact Nifty ETF category is not configured.'), {
            code: 'WTI_PARENT_NOT_CONFIGURED',
          });
        }
        if (!verifiedRecommendation) {
          throw Object.assign(new Error('Current recommendation binding is unavailable for the investment flow.'), {
            code: 'WTI_RECOMMENDATION_BINDING_MISSING',
          });
        }

        const configuredApiOrigin = new URL(apiBase).origin;
        const targetCategory = page.locator('[data-testid="wti-category-nifty_etf"]');
        const wtiResponsePromise = page.waitForResponse(response => {
          try {
            const responseUrl = new URL(response.url());
            const request = response.request();
            const requestBody = request.postDataJSON();
            return request.method() === 'POST'
              && responseUrl.origin === configuredApiOrigin
              && responseUrl.pathname.endsWith('/api/instruments/rank-wti')
              && requestBody?.parentInstrumentId === parentInstrumentId;
          } catch {
            return false;
          }
        }, { timeout: WTI_USER_FLOW_TIMEOUT_MS });
        const handledWtiResponsePromise = wtiResponsePromise.then(
          response => ({ response }),
          error => ({ error }),
        );
        const wtiJourney = async () => {
          browserJourneyStage = 'open investments';
          const investmentsNavigation = page.locator('[data-testid="nav-investments"]');
          await investmentsNavigation.waitFor({ state: 'visible', timeout: DASHBOARD_BROWSER_TIMEOUT_MS });
          await investmentsNavigation.click();
          browserJourneyStage = 'select Nifty ETF category';
          await targetCategory.waitFor({ state: 'visible', timeout: DASHBOARD_BROWSER_TIMEOUT_MS });

          if (typeof targetCategory.getAttribute !== 'function'
              || await targetCategory.getAttribute('aria-selected') !== 'true') {
            await targetCategory.click();
          }

          browserJourneyStage = 'await frontend WTI response';
          const outcome = await handledWtiResponsePromise;
          browserJourneyStage = 'frontend WTI response received';
          if (outcome.error) {
            throw Object.assign(new Error('The frontend WTI response could not be observed.'), {
              code: 'WTI_FRONTEND_RESPONSE_WAIT_FAILED',
            });
          }
          const wtiResponse = outcome.response;
          if (!responseOk(wtiResponse)) {
            throw Object.assign(new Error('The frontend WTI request returned a non-success response.'), {
              code: 'WTI_FRONTEND_HTTP_ERROR',
              status: responseStatus(wtiResponse),
            });
          }

          browserJourneyStage = 'inspect frontend WTI request';
          let requestBody;
          try {
            const request = wtiResponse.request();
            if (!request || typeof request.postDataJSON !== 'function') throw new TypeError('request body unavailable');
            requestBody = request.postDataJSON();
          } catch {
            throw Object.assign(new Error('The frontend WTI request body could not be verified.'), {
              code: 'WTI_FRONTEND_REQUEST_UNVERIFIABLE',
            });
          }
          browserJourneyStage = 'compare frontend WTI state binding';
          let requestMatchesCurrentState;
          try {
            requestMatchesCurrentState = requestBody?.profileId === verifiedRecommendation.profileId
              && requestBody?.profileVersion === verifiedRecommendation.profile_version
              && requestBody?.recommendationId === (verifiedRecommendation.recommendationId || verifiedRecommendation.recommendation_id)
              && requestBody?.expectedAllocationRevision === verifiedRecommendation.allocation_revision
              && requestBody?.expectedAllocationRevisionId === verifiedRecommendation.allocation_revision_id
              && requestBody?.expectedPortfolioFingerprint === verifiedRecommendation.portfolio_fingerprint
              && requestBody?.expectedRecommendationFingerprint === verifiedRecommendation.recommendation_fingerprint
              && requestBody?.parentInstrumentId === parentInstrumentId;
          } catch {
            throw Object.assign(new Error('The frontend WTI request binding could not be compared.'), {
              code: 'WTI_FRONTEND_BINDING_UNVERIFIABLE',
            });
          }
          browserJourneyStage = 'frontend WTI request binding compared';
          browserJourneyStage = 'validate frontend WTI response';
          const body = await readSafeResponseBody(wtiResponse);
          if (!requestMatchesCurrentState || !qualifiesWtiResponse(body, verifiedRecommendation, parentInstrumentId)) {
            throw Object.assign(new Error('The frontend WTI request or response did not match the current financial state.'), {
              code: 'WTI_FRONTEND_BINDING_INVALID',
            });
          }

          browserJourneyStage = 'render exact ETF and tax status';
          const product = body.products[0];
          if (product.postTaxAnalysis?.status !== 'CALCULATED'
              || !qualifiesCalculatedNiftyEtfTax(product, taxContext, { financialBindingValid: requestMatchesCurrentState })) {
            throw Object.assign(new Error('The exact ETF tax result is not fully source-qualified for the supplied tax scenario.'), {
              code: 'WTI_FRONTEND_TAX_STATE_INVALID',
            });
          }
          const productCard = page.locator('[data-testid="wti-product-etf:isin:INF204KB14I2"]');
          await productCard.waitFor({ state: 'visible', timeout: DASHBOARD_BROWSER_TIMEOUT_MS });
          if (!await productCard.isVisible()) {
            throw Object.assign(new Error('The exact qualified ETF product card is not visible.'), {
              code: 'WTI_FRONTEND_PRODUCT_NOT_VISIBLE',
            });
          }
          const calculatedTax = productCard.locator('.wti-post-tax-box');
          await calculatedTax.waitFor({ state: 'visible', timeout: DASHBOARD_BROWSER_TIMEOUT_MS });
          const unavailableTax = productCard.locator('.wti-post-tax-cta-box');
          const taxText = await calculatedTax.innerText();
          if (!/Exact-product tax illustration/i.test(taxText)
              || !/HISTORICAL\s*[—-]\s*NOT A FORECAST/i.test(taxText)
              || await unavailableTax.isVisible()) {
            throw Object.assign(new Error('The UI did not render the verified historical tax illustration exclusively.'), {
              code: 'WTI_FRONTEND_TAX_RENDER_INVALID',
            });
          }
          return true;
        };
        await withVerifierDeadline(wtiJourney(), WTI_USER_FLOW_TIMEOUT_MS);

        const noDirectProviderRequest = !providerRequestObserved && !providerRequestInspectionFailed;
        const criticalPathPassed = browserLaunched
          && loginPageRendered
          && frontendBuildVerified
          && authenticated
          && responseOk(profileResponse)
          && dashboardVisible
          && noDirectProviderRequest
        const detail = providerRequestObserved
          ? 'browser attempted a direct provider request; frontend must use backend APIs only'
          : providerRequestInspectionFailed
            ? 'browser request inspection failed; provider isolation could not be verified'
            : !frontendBuildVerified
              ? 'frontend runtime build identity is missing, malformed, or differs from the expected build'
              : 'frontend Where to Invest journey rendered the exact source-qualified ETF and unavailable-tax state with current binding';
        recordCriticalPath(criticalPathPassed, detail);
      } catch (error) {
        const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
        const failure = safeFailureKind(error);
        recordCriticalPath(false, `authenticated frontend Where-to-Invest journey failed during ${browserJourneyStage}${status} (${failure.kind}${failure.code ? ` ${failure.code}` : ''}${failure.name ? ` ${failure.name}` : ''})`);
      }
    } else {
      recordCriticalPath(false, 'NOT_EVALUATED because authentication failed before dashboard verification');
    }
  } catch (error) {
    if (!criticalPathRecorded) {
      const failure = safeFailureKind(error);
      recordCriticalPath(false, `browser preflight stage failed (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}

export function qualifiesTaxPolicyMetadata(policies, { now = new Date() } = {}) {
  let expectedFiscalYear;
  try {
    expectedFiscalYear = getCurrentFiscalYear(now);
  } catch {
    return false;
  }
  return Boolean(policies?.response?.ok === true
    && policies?.body?.currentFiscalYearVerified === true
    && policies?.body?.currentFiscalYear === expectedFiscalYear);
}

export async function runDemoPreflight({
  environment = process.env,
  write = line => process.stdout.write(`${line}\n`),
  dependencies = {},
} = {}) {
  const {
    readHttp = readJson,
    loadJson = readConfiguredJson,
    verifyMongo = checkMongoTransaction,
    verifyRedis = checkRedis,
    verifyBrowser = checkBrowserAndFinancialFlow,
    verifyBuild = null,
  } = dependencies;
  const reporter = makeReporter(write);
  const finish = () => finishPreflight(reporter, write);
  if (environment.DEMO_LIVE_PREFLIGHT !== '1') {
    reporter.add('Explicit live-demo mode', false, 'set DEMO_LIVE_PREFLIGHT=1 to run external live checks intentionally');
    return finish();
  }
  reporter.add('Explicit live-demo mode', true, 'live checks were explicitly enabled');

  const configuredApiBase = (environment.DEMO_API_BASE_URL || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
  let apiBase = configuredApiBase;
  let backendOrigin;
  try {
    const apiUrl = new URL(apiBase);
    if (!['http:', 'https:'].includes(apiUrl.protocol)) throw new TypeError('Unsupported API URL protocol.');
    if (!apiUrl.pathname.replace(/\/+$/, '').endsWith('/api') || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      throw new TypeError('API URL must end in /api and contain no credentials, query, or fragment.');
    }
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (apiUrl.protocol !== 'https:' && !localHosts.has(apiUrl.hostname)) {
      throw new TypeError('Remote API URLs must use HTTPS.');
    }
    apiBase = `${apiUrl.origin}${apiUrl.pathname.replace(/\/+$/, '')}`;
    backendOrigin = apiUrl.origin;
  } catch {
    reporter.add('Backend URL configuration', false, 'DEMO_API_BASE_URL must be a valid safe HTTP(S) URL ending in /api');
    return finish();
  }
  reporter.add('Backend URL configuration', true, 'safe local HTTP or remote HTTPS API URL verified');
  const frontendUrl = environment.DEMO_FRONTEND_URL;
  const completionPayload = await loadJson(environment.DEMO_PROFILE_COMPLETION_FILE, 'Profile completion payload', reporter);
  const taxContext = await loadJson(environment.DEMO_TAX_CONTEXT_FILE, 'Tax input payload', reporter);

  const health = await readHttp(`${backendOrigin}/health/live`, { timeoutMs: BACKEND_HTTP_HARD_TIMEOUT_MS }).catch(() => null);
  const readiness = await readHttp(`${backendOrigin}/health/ready`, { timeoutMs: BACKEND_HTTP_HARD_TIMEOUT_MS }).catch(() => null);
  const runtimeVerification = await readHttp(`${backendOrigin}/health/verification`, { timeoutMs: BACKEND_HTTP_HARD_TIMEOUT_MS }).catch(() => null);
  const runtimeBody = runtimeVerification?.body;
  const backendBuildMatches = matchesBuildSha(environment.DEMO_EXPECTED_BUILD_SHA, health?.body?.buildSha)
    && matchesBuildSha(environment.DEMO_EXPECTED_BUILD_SHA, runtimeBody?.buildSha);
  reporter.add('Backend', Boolean(health?.response.ok && health.body?.status === 'ALIVE' && backendBuildMatches),
    health?.response.ok && health.body?.status === 'ALIVE'
      ? backendBuildMatches ? 'backend liveness and explicit build identity verified' : 'backend build identity is missing, malformed, or differs from the expected build'
      : safeHttpDetail(health));
  reporter.add('Backend readiness', Boolean(readiness?.response.ok && readiness.body?.status === 'READY'), safeHttpDetail(readiness));

  await verifyMongo(reporter, { environment, verification: runtimeBody });
  await verifyRedis(reporter, { environment, verification: runtimeBody });

  const deep = await readHttp(`${backendOrigin}/health/deep`, { timeoutMs: BACKEND_HTTP_HARD_TIMEOUT_MS }).catch(() => null);
  const services = deep?.body?.services || {};
  const redisRequired = isRedisRequired(environment);
  reporter.add('Market provider configuration', Boolean(services.database === 'UP')
    && runtimeBody?.mongo?.connected === true
    && (!redisRequired || (services.redis === 'UP' && runtimeBody?.redis?.connected === true)),
  'backend dependency health and connected runtime capabilities are evaluated without exposing configuration values');

  const contextResult = await readHttp(`${apiBase}/regime/current`, {
    timeoutMs: MARKET_DEPENDENCY_PROBE_TIMEOUT_MS,
  }).catch(() => null);
  const marketAssessment = assessCurrentMarketContext(contextResult, {
    now: dependencies.marketNow instanceof Date ? dependencies.marketNow : new Date(),
  });
  const selectedProvider = marketAssessment.selectedProvider;
  reporter.add(
    'NIFTY quote',
    marketAssessment.niftyAvailable,
    marketQuoteDetail(contextResult, marketAssessment, marketAssessment.niftyAvailable),
  );
  reporter.add(
    'VIX quote',
    marketAssessment.vixAvailable,
    marketQuoteDetail(contextResult, marketAssessment, marketAssessment.vixAvailable),
  );
  reporter.add('Market history', marketAssessment.hasHistory, marketAssessment.hasHistory ? 'source-qualified history produced at least one derived fact' : 'verified history is missing');
  reporter.add('Market context', marketAssessment.marketContextAvailable, marketAssessment.marketContextAvailable
    ? `${marketAssessment.sessionStatus}: ${marketAssessment.sessionDetail}`
    : `${marketAssessment.sessionStatus}: ${marketAssessment.sessionDetail}; complete current-session evidence is unavailable or stale, and last-known-good data is not counted as live`);

  const marketProvider = selectedProvider;
  const upstoxTokenPresent = Boolean(environment.UPSTOX_ANALYTICS_TOKEN || environment.UPSTOX_ACCESS_TOKEN);
  const tokenCheck = marketProvider === 'UPSTOX' ? upstoxTokenPresent : marketProvider === 'NSE';
  reporter.add('Provider token presence', tokenCheck, marketProvider === 'UPSTOX'
    ? (upstoxTokenPresent ? 'required Upstox token is present (value hidden)' : 'Upstox selected but token is absent')
    : marketProvider === 'NSE' ? 'NSE source does not require a provider token' : 'no qualified market provider selected');

  const policies = await readHttp(`${apiBase}/tax/policies`, { timeoutMs: BACKEND_HTTP_HARD_TIMEOUT_MS }).catch(() => null);
  const taxVerified = qualifiesTaxPolicyMetadata(policies);
  reporter.add('Tax-policy metadata', taxVerified, taxVerified
    ? `current policy ${policies.body.currentFiscalYear} is server-verified`
    : 'current fiscal-year policy metadata is missing, stale, malformed, or unverified');

  const browserConfigPresent = Boolean(frontendUrl && environment.DEMO_EMAIL && environment.DEMO_PASSWORD);
  if (!browserConfigPresent) {
    reporter.add('Critical browser path', false, 'set DEMO_FRONTEND_URL, DEMO_EMAIL, and DEMO_PASSWORD');
    reporter.add('Profile completion/auth', false, 'set a dedicated demo identity and credentials');
    reporter.add('Recommendation current-state binding', false, 'authenticated profile completion was not run');
    reporter.add('ETF product source', false, 'authenticated rank-wti flow was not run');
    reporter.add('Nifty ETF exact-product result', false, 'authenticated rank-wti flow was not run');
    reporter.add('Product tax workflow', false, 'authenticated rank-wti flow was not run');
  } else {
    await verifyBrowser(reporter, {
      apiBase,
      frontendUrl,
      completionPayload,
      taxContext,
      email: environment.DEMO_EMAIL,
      password: environment.DEMO_PASSWORD,
      idempotencyKey: environment.DEMO_COMPLETION_IDEMPOTENCY_KEY,
      parentInstrumentId: environment.DEMO_NIFTY_ETF_PARENT_ID,
      expectedBuildSha: environment.DEMO_EXPECTED_BUILD_SHA,
    }, dependencies.browserOptions);
  }

  if (verifyBuild) {
    const build = await verifyBuild({ environment });
    reporter.add('Production frontend build', build?.passed === true, build?.detail || 'production frontend build was not verified');
  } else {
    const build = spawnSync(process.execPath, [path.join(REACTAPP_DIR, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      cwd: REACTAPP_DIR,
      encoding: 'utf8',
      timeout: BACKEND_HTTP_HARD_TIMEOUT_MS * 6,
      windowsHide: true,
      env: { ...environment, VITE_BUILD_SHA: environment.DEMO_EXPECTED_BUILD_SHA || '' },
    });
    const expectedShaValid = matchesBuildSha(environment.DEMO_EXPECTED_BUILD_SHA, environment.DEMO_EXPECTED_BUILD_SHA);
    reporter.add('Production frontend build', build.status === 0 && expectedShaValid, build.status !== 0
      ? 'production build failed or frontend dependencies are unavailable'
      : expectedShaValid ? 'Vite production build succeeded with the explicit expected build identity'
        : 'expected build SHA is missing or malformed; build identity was not substituted from local Git');
  }

  return finish();
}

function finishPreflight(reporter, write = line => process.stdout.write(`${line}\n`)) {
  const summary = reporter.finish();
  write(`\nLive-demo preflight: ${summary.passed} PASS, ${summary.failed} FAIL.`);
  if (summary.failed) {
    write('FINAL LIVE DEMO ENVIRONMENT NOT READY. Resolve the failed checks above; this is separate from deterministic product-integrity certification.');
  }
  return {
    exitCode: summary.failed ? 1 : 0,
    checks: summary.checks,
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runDemoPreflight();
  process.exitCode = result.exitCode;
}
