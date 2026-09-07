/**
 * Presentation-only accessor for a suitability score already supplied by the
 * authoritative recommendation response. This module deliberately performs no
 * profile comparison, risk calculation, ranking, or fallback scoring.
 */
export function computeSuitabilityMatch(instrument) {
  const supplied = instrument?.score ?? instrument?.suitabilityScore ?? instrument?.matchScore;
  if (supplied === null || supplied === undefined || supplied === '') return null;
  const value = Number(supplied);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
