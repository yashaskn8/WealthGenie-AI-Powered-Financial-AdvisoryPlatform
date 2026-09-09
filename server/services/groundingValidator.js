const CITATION_PATTERN = /\[(E_[A-Z0-9_:-]+)\]/g;
const URL_PATTERN = /https?:\/\/[^\s)\]}]+/gi;
const NUMBER_PATTERN = /(?<![A-Za-z_])[-+]?\d[\d,]*(?:\.\d+)?(?![A-Za-z_])/g;
const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z?)?\b/g;
const CONTROLLED_FINANCIAL_TERMS = Object.freeze([
  'bitcoin', 'crypto', 'cryptocurrency', 'equity', 'stock', 'mutual fund', 'etf',
  'ppf', 'scss', 'sukanya', 'nsc', 'kvp', 'pomis', 'fixed deposit', 'fd',
  'nifty', 'india vix', 'nse', 'amfi', 'sbi', 'india post',
]);
const CONTROLLED_AUTHORITY_LABELS = Object.freeze([
  'conservative', 'moderate', 'moderate-aggressive', 'aggressive',
  'normal', 'cautious', 'high volatility', 'risk off',
  'state_0', 'state_1', 'bull', 'bear', 'crash', 'recession',
]);

function normalizedNumber(value) {
  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  return Number(number.toPrecision(15)).toString();
}

function maskMatches(value, pattern) {
  return String(value || '').replace(pattern, match => ' '.repeat(match.length));
}

function numericKindFromText(text, start, rawValue) {
  const before = text.slice(Math.max(0, start - 40), start).toLowerCase();
  const after = text.slice(start + rawValue.length, start + rawValue.length + 24).toLowerCase();
  const nearby = `${before.slice(-24)} ${after.slice(0, 16)}`;
  if (/^\s*%/.test(after)
      || /(?:rate|return|allocation|volatility|drawdown|percentage|price\s+vs)\D{0,12}$/.test(before)) return 'PERCENT';
  if (/(?:₹|\binr\s*|\brs\.?\s*)$/.test(before)
      || /(?:amount|income|saving|sip|tax|principal|corpus|value)\D{0,12}$/.test(before)) return 'CURRENCY';
  if (/\bnav\b/.test(nearby)) return 'NAV';
  if (/^\s*(?:years?|months?|days?|sessions?)\b/.test(after)
      || /(?:age|horizon|tenure|duration|dependents?)\D{0,12}$/.test(before)) return 'DURATION';
  return 'GENERAL';
}

function numericKindFromPath(path) {
  const normalized = path.join('.').toLowerCase();
  if (/(?:^|\.)(?:id|.*id|.*hash|.*version|.*url|.*date|.*at)$/.test(normalized)) return null;
  if (/(?:pct|percent|rate|return|allocation|volatility|drawdown|pricev|savingsrate)/.test(normalized)) return 'PERCENT';
  if (/nav/.test(normalized)) return 'NAV';
  if (/(?:amount|income|saving|takehome|lumpsum|sip|tax|principal|corpus)/.test(normalized)) return 'CURRENCY';
  if (/(?:age|horizon|tenure|duration|year|month|day|dependent|session)/.test(normalized)) return 'DURATION';
  return 'GENERAL';
}

function addAllowedNumber(numberKinds, value, kind) {
  const normalized = normalizedNumber(value);
  if (normalized === null || !kind) return;
  if (!numberKinds.has(normalized)) numberKinds.set(normalized, new Set());
  numberKinds.get(normalized).add(kind);
}

function collectAllowedFacts(packet) {
  const numberKinds = new Map();
  const dates = new Set();
  const urls = new Set();
  const visit = (value, path = []) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      addAllowedNumber(numberKinds, value, numericKindFromPath(path));
      return;
    }
    if (typeof value === 'string') {
      for (const match of value.matchAll(DATE_PATTERN)) dates.add(match[0]);
      for (const match of value.matchAll(URL_PATTERN)) urls.add(match[0]);
      if (numericKindFromPath(path) === null) return;
      const numericText = maskMatches(maskMatches(value, DATE_PATTERN), URL_PATTERN);
      for (const match of numericText.matchAll(NUMBER_PATTERN)) {
        addAllowedNumber(numberKinds, match[0], numericKindFromText(numericText, match.index, match[0]));
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, [...path, String(index)]));
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]));
    }
  };
  for (const evidence of packet?.entries || []) visit(evidence);
  return { numberKinds, dates, urls };
}

function unsupportedNumbersInText(text, numberKinds) {
  const numericText = maskMatches(maskMatches(String(text || ''), DATE_PATTERN), URL_PATTERN);
  return [...numericText.matchAll(NUMBER_PATTERN)]
    .filter(match => {
      const normalized = normalizedNumber(match[0]);
      const kind = numericKindFromText(numericText, match.index, match[0]);
      return normalized === null || !numberKinds.get(normalized)?.has(kind);
    })
    .map(match => match[0]);
}

function citationsIn(text) {
  return [...String(text || '').matchAll(CITATION_PATTERN)].map(match => match[1]);
}

function unsupportedFactsInText(text, entries) {
  const allowed = collectAllowedFacts({ entries });
  const withoutCitations = String(text || '').replace(CITATION_PATTERN, '');
  const unsupportedNumbers = unsupportedNumbersInText(withoutCitations, allowed.numberKinds);
  const unsupportedDates = [...withoutCitations.matchAll(DATE_PATTERN)]
    .map(match => match[0])
    .filter(value => !allowed.dates.has(value));
  const unsupportedUrls = [...String(text || '').matchAll(URL_PATTERN)]
    .map(match => match[0])
    .filter(value => !allowed.urls.has(value));
  return { unsupportedNumbers, unsupportedDates, unsupportedUrls };
}

function unsupportedControlledTerms(text, entries) {
  const content = String(text || '').toLowerCase();
  const evidence = JSON.stringify(entries || []).toLowerCase();
  const hasTerm = term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+')}\\b`, 'i').test(content);
  const supported = term => evidence.includes(term.toLowerCase());
  return {
    financialEntities: CONTROLLED_FINANCIAL_TERMS.filter(term => hasTerm(term) && !supported(term)),
    authorityLabels: CONTROLLED_AUTHORITY_LABELS.filter(term => hasTerm(term) && !supported(term)),
  };
}

export function parseGroundedModelJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('EMPTY_COMPLETION');
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error('MALFORMED_GROUNDED_JSON');
  }
  return parsed;
}

export function validateGroundedExplanation(candidate, packet) {
  const errors = [];
  const evidenceIds = new Set((packet?.entries || []).map(item => item.id));
  const evidenceById = new Map((packet?.entries || []).map(item => [item.id, item]));
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['GROUNDING_OUTPUT_NOT_OBJECT'] };
  }
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) errors.push('GROUNDING_TEXT_REQUIRED');
  if (!Array.isArray(candidate.evidenceIdsUsed) || candidate.evidenceIdsUsed.length === 0) errors.push('EVIDENCE_IDS_REQUIRED');
  if (!Array.isArray(candidate.claims) || candidate.claims.length === 0) errors.push('CLAIMS_REQUIRED');
  if (!Array.isArray(candidate.unavailableFacts)) errors.push('UNAVAILABLE_FACTS_REQUIRED');

  const used = Array.isArray(candidate.evidenceIdsUsed) ? candidate.evidenceIdsUsed : [];
  if (used.some(id => !evidenceIds.has(id))) errors.push('UNKNOWN_EVIDENCE_ID');
  const textCitations = citationsIn(candidate.text);
  if (textCitations.some(id => !evidenceIds.has(id))) errors.push('FABRICATED_TEXT_EVIDENCE_ID');
  if (used.some(id => !textCitations.includes(id))) errors.push('USED_EVIDENCE_NOT_CITED_IN_TEXT');
  if (textCitations.some(id => !used.includes(id))) errors.push('UNDECLARED_TEXT_EVIDENCE_ID');
  const declaredUnavailable = new Set(packet?.unavailableFacts || []);
  if ((candidate.unavailableFacts || []).some(item => !declaredUnavailable.has(item))) {
    errors.push('UNSUPPORTED_UNAVAILABLE_FACT');
  }

  for (const claim of Array.isArray(candidate.claims) ? candidate.claims : []) {
    if (!claim || typeof claim.text !== 'string' || !Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0) {
      errors.push('CLAIM_CITATION_REQUIRED');
      continue;
    }
    if (claim.evidenceIds.some(id => !evidenceIds.has(id))) errors.push('CLAIM_UNKNOWN_EVIDENCE_ID');
    if (claim.evidenceIds.some(id => !used.includes(id))) errors.push('CLAIM_EVIDENCE_NOT_DECLARED');
    const claimCitations = citationsIn(claim.text);
    if (claim.evidenceIds.some(id => !claimCitations.includes(id))) errors.push('CLAIM_INLINE_CITATION_REQUIRED');
    const scopedEntries = claim.evidenceIds.map(id => evidenceById.get(id)).filter(Boolean);
    const scoped = unsupportedFactsInText(claim.text, scopedEntries);
    if (scoped.unsupportedNumbers.length) errors.push('UNSUPPORTED_FINANCIAL_NUMBER');
    if (scoped.unsupportedDates.length) errors.push('UNSUPPORTED_DATE');
    if (scoped.unsupportedUrls.length) errors.push('UNSUPPORTED_SOURCE_URL');
    const controlled = unsupportedControlledTerms(claim.text, scopedEntries);
    if (controlled.financialEntities.length) errors.push('UNSUPPORTED_FINANCIAL_ENTITY');
    if (controlled.authorityLabels.length) errors.push('UNSUPPORTED_AUTHORITY_LABEL');
  }

  const { numberKinds, dates, urls } = collectAllowedFacts(packet);
  const content = [candidate.text, ...(candidate.claims || []).map(claim => claim?.text || '')].join('\n');
  const withoutCitations = content.replace(CITATION_PATTERN, '');
  const unsupportedNumbers = unsupportedNumbersInText(withoutCitations, numberKinds);
  if (unsupportedNumbers.length) errors.push('UNSUPPORTED_FINANCIAL_NUMBER');
  const unsupportedDates = [...withoutCitations.matchAll(DATE_PATTERN)].map(match => match[0]).filter(date => !dates.has(date));
  if (unsupportedDates.length) errors.push('UNSUPPORTED_DATE');
  const unsupportedUrls = [...content.matchAll(URL_PATTERN)].map(match => match[0]).filter(url => !urls.has(url));
  if (unsupportedUrls.length) errors.push('UNSUPPORTED_SOURCE_URL');

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    evidenceIdsUsed: [...new Set(used)],
  };
}
