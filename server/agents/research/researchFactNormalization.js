const NUMBER = String.raw`(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?`;
const CURRENCY_PREFIX = String.raw`(?:₹\s*|\bINR\s*|\bRs\.?\s*)`;
const UNIT_SUFFIX = String.raw`(?:%|％|bps?\b|basis\s+points?\b|lakhs?\b|crores?\b|x\b)?`;
const NUMERIC_LITERAL = String.raw`(?:[+\-−]?\s*${CURRENCY_PREFIX}?\s*\(\s*${NUMBER}\s*${UNIT_SUFFIX}\s*\)|[+\-−]?\s*${CURRENCY_PREFIX}?\s*${NUMBER}\s*${UNIT_SUFFIX})`;

const MONTHS = new Map([
  ['jan', '01'], ['january', '01'], ['feb', '02'], ['february', '02'],
  ['mar', '03'], ['march', '03'], ['apr', '04'], ['april', '04'],
  ['may', '05'], ['jun', '06'], ['june', '06'], ['jul', '07'], ['july', '07'],
  ['aug', '08'], ['august', '08'], ['sep', '09'], ['sept', '09'], ['september', '09'],
  ['oct', '10'], ['october', '10'], ['nov', '11'], ['november', '11'],
  ['dec', '12'], ['december', '12'],
]);

const NEGATION_MARKER = /\b(?:not|never|no|without|cannot|can't|doesn't|don't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)\b/i;

function canonicalNumber(raw) {
  const [rawInteger, rawFraction = ''] = String(raw).replace(/,/g, '').split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
}

function validDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function mark(mask, start, end) {
  for (let index = start; index < end; index += 1) mask[index] = ' ';
}

function contextAt(text, start, end) {
  const sentenceStart = Math.max(
    text.lastIndexOf('.', start - 1),
    text.lastIndexOf(';', start - 1),
    text.lastIndexOf('!', start - 1),
    text.lastIndexOf('?', start - 1),
    text.lastIndexOf('\n', start - 1),
  ) + 1;
  const sentenceEnds = ['.', ';', '!', '?', '\n']
    .map(character => text.indexOf(character, end))
    .filter(index => index >= 0);
  const sentenceEnd = sentenceEnds.length ? Math.min(...sentenceEnds) : text.length;
  return {
    before: text.slice(Math.max(sentenceStart, start - 120), start),
    after: text.slice(end, Math.min(sentenceEnd, end + 120)),
  };
}

function qualifiersFor(text, start, end) {
  const { before, after } = contextAt(text, start, end);
  const beforeSegment = before.slice(before.lastIndexOf(',') + 1).slice(-64);
  const afterSegment = after.split(/[,;.!?\n]/, 1)[0].slice(0, 48);
  let qualifier = 'EXACT';
  if (/\bnot\s+more\s+than\s*$/i.test(beforeSegment)) qualifier = 'NOT_MORE_THAN';
  else if (/\b(?:up\s+to|at\s+most|no\s+more\s+than)\s*$/i.test(beforeSegment)) qualifier = 'AT_MOST';
  else if (/\bnot\s+less\s+than\s*$/i.test(beforeSegment)) qualifier = 'NOT_LESS_THAN';
  else if (/\b(?:at\s+least|no\s+less\s+than)\s*$/i.test(beforeSegment)) qualifier = 'AT_LEAST';
  else if (/\b(?:below|under|less\s+than)\s*$/i.test(beforeSegment)) qualifier = 'BELOW';
  else if (/\b(?:above|over|more\s+than|greater\s+than)\s*$/i.test(beforeSegment)) qualifier = 'ABOVE';

  const temporalMarkers = [...beforeSegment.matchAll(/\b(previously|formerly|historically|historical|prior|earlier|was|were|currently|current|now|today)\b/gi)];
  const lastTemporalMarker = temporalMarkers.at(-1)?.[1]?.toLowerCase();
  const temporal = ['currently', 'current', 'now', 'today'].includes(lastTemporalMarker)
    ? 'CURRENT'
    : ['previously', 'formerly', 'historically', 'historical', 'prior', 'earlier', 'was', 'were'].includes(lastTemporalMarker)
      ? 'PAST'
      : 'UNSPECIFIED';

  const beforeYears = [...before.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => ({ year: match[0], distance: before.length - match.index - match[0].length }));
  const afterYears = [...after.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => ({ year: match[0], distance: match.index }));
  const period = [...beforeYears, ...afterYears].sort((left, right) => left.distance - right.distance)[0]?.year || null;
  const nearby = `${beforeSegment} ${afterSegment}`;
  const hasNegation = NEGATION_MARKER.test(nearby);
  const negated = hasNegation && !['NOT_MORE_THAN', 'NOT_LESS_THAN'].includes(qualifier);

  return { qualifier, temporal, period, negated };
}

function parseNumericLiteral(raw, text, start, end) {
  const literal = String(raw).trim().replace(/[−]/g, '-').replace(/[％]/g, '%');
  const isParenthesized = /^\(/.test(literal) || /\)$/.test(literal);
  const sign = isParenthesized || /^-/.test(literal) ? -1 : 1;
  const numeric = literal.match(/\d[\d,]*(?:\.\d+)?/);
  if (!numeric) return null;

  const hasCurrency = /₹|\bINR\b|\bRs\.?/i.test(literal);
  let kind = 'NUMBER';
  let unit = 'NUMBER';
  let currency = null;
  if (/%/.test(literal)) {
    kind = 'PERCENT';
    unit = 'PERCENT';
  } else if (/\bbps?\b|\bbasis\s+points?\b/i.test(literal)) {
    kind = 'BASIS_POINTS';
    unit = 'BASIS_POINTS';
  } else if (/\blakhs?\b/i.test(literal)) {
    kind = 'MAGNITUDE';
    unit = 'LAKH';
  } else if (/\bcrores?\b/i.test(literal)) {
    kind = 'MAGNITUDE';
    unit = 'CRORE';
  } else if (/x\s*$/i.test(literal)) {
    kind = 'MULTIPLIER';
    unit = 'MULTIPLIER';
  } else if (hasCurrency) {
    kind = 'CURRENCY';
    unit = 'CURRENCY';
    currency = 'INR';
  }

  return {
    kind,
    value: canonicalNumber(numeric[0]),
    sign,
    unit,
    currency,
    ...qualifiersFor(text, start, end),
  };
}

function addMatches({ text, mask, facts, regex, mapper }) {
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const fact = mapper(match);
    if (!fact) continue;
    facts.push({ start: match.index, end: match.index + match[0].length, fact });
    mark(mask, match.index, match.index + match[0].length);
  }
}

export function normalizeResearchFacts(value) {
  const text = String(value || '').replace(/[−]/g, '-').replace(/[％]/g, '%');
  const mask = [...text];
  const facts = [];

  addMatches({
    text,
    mask,
    facts,
    regex: /\bFY\s*(20\d{2})\s*[-–/]\s*(\d{2}|20\d{2})\b/giu,
    mapper: match => {
      const startYear = Number(match[1]);
      let endYear = Number(match[2]);
      if (match[2].length === 2) endYear = Math.floor(startYear / 100) * 100 + endYear;
      if (endYear < startYear || endYear > startYear + 1) return null;
      return { kind: 'FINANCIAL_YEAR', value: `FY${startYear}-${String(endYear).slice(-2)}`, sign: 1, unit: 'FINANCIAL_YEAR', currency: null, qualifier: 'EXACT', temporal: 'UNSPECIFIED', period: null, negated: false };
    },
  });
  addMatches({
    text,
    mask,
    facts,
    regex: /\b(?:section|sec\.?)\s*(\d+[A-Z]?)\b/giu,
    mapper: match => ({ kind: 'STATUTORY_IDENTIFIER', value: match[1].toUpperCase(), sign: 1, unit: 'SECTION', currency: null, qualifier: 'EXACT', temporal: 'UNSPECIFIED', period: null, negated: false }),
  });
  addMatches({
    text,
    mask,
    facts,
    regex: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/gu,
    mapper: match => {
      const date = validDate(match[1], match[2], match[3]);
      return date && { kind: 'DATE', value: date, sign: 1, unit: 'DATE', currency: null, qualifier: 'EXACT', temporal: 'UNSPECIFIED', period: null, negated: false };
    },
  });
  addMatches({
    text,
    mask,
    facts,
    regex: /\b(\d{1,2})-(\d{1,2})-(20\d{2})\b/gu,
    mapper: match => {
      const date = validDate(match[3], match[2], match[1]);
      return date && { kind: 'DATE', value: date, sign: 1, unit: 'DATE', currency: null, qualifier: 'EXACT', temporal: 'UNSPECIFIED', period: null, negated: false };
    },
  });
  addMatches({
    text,
    mask,
    facts,
    regex: /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/giu,
    mapper: match => {
      const date = validDate(match[3], MONTHS.get(match[2].toLowerCase()), match[1]);
      return date && { kind: 'DATE', value: date, sign: 1, unit: 'DATE', currency: null, qualifier: 'EXACT', temporal: 'UNSPECIFIED', period: null, negated: false };
    },
  });

  const rangePattern = new RegExp(
    `\\b(?:between|from)\\s+(${NUMERIC_LITERAL})\\s+(?:and|to)\\s+(${NUMERIC_LITERAL})`,
    'giu',
  );
  const rangeSource = mask.join('');
  addMatches({
    text: rangeSource,
    mask,
    facts,
    regex: rangePattern,
    mapper: match => {
      const leftStart = match.index + match[0].indexOf(match[1]);
      const rightStart = match.index + match[0].lastIndexOf(match[2]);
      const left = parseNumericLiteral(match[1], text, leftStart, leftStart + match[1].length);
      const right = parseNumericLiteral(match[2], text, rightStart, rightStart + match[2].length);
      if (!left || !right) return null;
      return {
        kind: 'RANGE',
        value: `${left.sign < 0 ? '-' : ''}${left.value}..${right.sign < 0 ? '-' : ''}${right.value}`,
        sign: 1,
        unit: left.unit === right.unit ? left.unit : 'MIXED',
        currency: left.currency === right.currency ? left.currency : 'MIXED',
        qualifier: 'RANGE',
        temporal: left.temporal === right.temporal ? left.temporal : 'UNSPECIFIED',
        period: left.period === right.period ? left.period : null,
        negated: left.negated || right.negated,
      };
    },
  });

  const dashRangePattern = new RegExp(
    `(${CURRENCY_PREFIX}?\\s*${NUMBER}\\s*${UNIT_SUFFIX})\\s*[-–—]\\s*(${CURRENCY_PREFIX}?\\s*${NUMBER}\\s*${UNIT_SUFFIX})`,
    'giu',
  );
  addMatches({
    text: mask.join(''),
    mask,
    facts,
    regex: dashRangePattern,
    mapper: match => {
      const leftStart = match.index + match[0].indexOf(match[1]);
      const rightStart = match.index + match[0].lastIndexOf(match[2]);
      const left = parseNumericLiteral(match[1], text, leftStart, leftStart + match[1].length);
      const right = parseNumericLiteral(match[2], text, rightStart, rightStart + match[2].length);
      if (!left || !right) return null;
      return {
        kind: 'RANGE',
        value: `${left.value}..${right.value}`,
        sign: 1,
        unit: left.unit === right.unit ? left.unit : 'MIXED',
        currency: left.currency === right.currency ? left.currency : 'MIXED',
        qualifier: 'RANGE',
        temporal: left.temporal === right.temporal ? left.temporal : 'UNSPECIFIED',
        period: left.period === right.period ? left.period : null,
        negated: left.negated || right.negated,
      };
    },
  });

  addMatches({
    text: mask.join(''),
    mask,
    facts,
    regex: /\b(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\b/gu,
    mapper: match => ({ kind: 'RATIO', value: `${canonicalNumber(match[1])}:${canonicalNumber(match[2])}`, sign: 1, unit: 'RATIO', currency: null, ...qualifiersFor(text, match.index, match.index + match[0].length) }),
  });

  const remaining = mask.join('');
  const numberPattern = new RegExp(NUMERIC_LITERAL, 'giu');
  addMatches({
    text: remaining,
    mask,
    facts,
    regex: numberPattern,
    mapper: match => parseNumericLiteral(match[0], text, match.index, match.index + match[0].length),
  });

  return facts
    .sort((left, right) => left.start - right.start)
    .map(entry => entry.fact);
}

export function researchFactsMatch(left, right) {
  return left.kind === right.kind
    && left.value === right.value
    && left.sign === right.sign
    && left.unit === right.unit
    && left.currency === right.currency
    && left.qualifier === right.qualifier
    && left.temporal === right.temporal
    && left.period === right.period
    && left.negated === right.negated;
}

export function textHasNegation(value) {
  return NEGATION_MARKER.test(String(value || ''));
}

export function researchNegatedPhraseOverlapsClaim(claimText, evidenceText) {
  const claimTokens = new Set(lexicalTokens(claimText));
  if (!claimTokens.size) return false;
  const pattern = /\b(?:not|never|no|without|cannot|can't|doesn't|don't|didn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)\b\s+([^.!?;]{1,140})/gi;
  for (const match of String(evidenceText || '').matchAll(pattern)) {
    if (/^(?:not\s+more\s+than|not\s+less\s+than)\b/i.test(match[0])) continue;
    const negatedTokens = lexicalTokens(match[1]);
    if (negatedTokens.some(token => claimTokens.has(token))) return true;
  }
  return false;
}

export function lexicalTokens(value) {
  return [...new Set(orderedLexicalTokens(value))];
}

export function orderedLexicalTokens(value) {
  const stopWords = new Set(['the', 'and', 'for', 'from', 'with', 'this', 'that', 'was', 'were', 'are', 'is', 'has', 'have', 'had', 'does', 'did', 'not', 'now', 'then', 'into', 'onto', 'its', 'their', 'there', 'here']);
  return String(value || '').normalize('NFKC').toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2 && !stopWords.has(token) && !/^\d+$/.test(token))
    .map(token => token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.endsWith('s') ? token.slice(0, -1) : token.endsWith('ed') ? token.slice(0, -2) : token);
}
