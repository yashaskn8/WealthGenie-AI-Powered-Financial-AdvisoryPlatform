import { RESEARCH_NEED_MODES } from './researchConstants.js';

const DEEP_RESEARCH_SIGNALS = new Set([
  'EVIDENCE_UNAVAILABLE',
  'CONTRADICTORY_SOURCES',
  'MISSING_OFFICIAL_SOURCE',
  'REGULATORY_VERSION_MISMATCH',
  'CURRENT_FACT_REQUESTED',
  'UNKNOWN_FACT_REQUIRED',
]);

const QUICK_RESEARCH_SIGNALS = new Set([
  'EVIDENCE_STALE',
  'GROUNDING_COVERAGE_INSUFFICIENT',
  'SOURCE_DATE_MISSING',
]);

export function evaluateResearchNeed({
  enabled = false,
  evidenceStatus = 'UNAVAILABLE',
  reasonCodes = [],
  evidenceEntries = [],
  userRequestedCurrent = false,
  requiredFactUnknown = false,
} = {}) {
  const signals = new Set(reasonCodes.filter(Boolean));
  if (evidenceStatus !== 'AVAILABLE') signals.add('EVIDENCE_UNAVAILABLE');
  if (userRequestedCurrent) signals.add('CURRENT_FACT_REQUESTED');
  if (requiredFactUnknown) signals.add('UNKNOWN_FACT_REQUIRED');
  if (evidenceEntries.length === 0 && evidenceStatus === 'AVAILABLE') signals.add('GROUNDING_COVERAGE_INSUFFICIENT');

  if (!enabled) {
    return { mode: 'NO_RESEARCH', reasonCodes: ['RESEARCH_DISABLED'], signals: [...signals] };
  }
  const normalized = [...signals];
  if (normalized.some(code => DEEP_RESEARCH_SIGNALS.has(code))) {
    return { mode: 'DEEP_RESEARCH', reasonCodes: normalized, signals: normalized };
  }
  if (normalized.some(code => QUICK_RESEARCH_SIGNALS.has(code))) {
    return { mode: 'QUICK_RESEARCH', reasonCodes: normalized, signals: normalized };
  }
  return { mode: 'NO_RESEARCH', reasonCodes: normalized.length ? normalized : ['EVIDENCE_SUFFICIENT'], signals: normalized };
}

export function assertResearchNeedMode(mode) {
  if (!RESEARCH_NEED_MODES.includes(mode)) throw new Error(`Unsupported research need mode: ${mode}`);
  return mode;
}
