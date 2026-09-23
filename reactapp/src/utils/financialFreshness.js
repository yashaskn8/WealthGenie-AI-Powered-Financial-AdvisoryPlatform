/**
 * Personalized financial calculations are usable only when the backend
 * explicitly proves that their source state is current.
 * Missing freshness is unavailable, never implicitly fresh.
 */
export function isFinancialCalculationFresh(value) {
  return value?.fresh === true;
}

export function isAdvisoryFresh(value) {
  return value?.fresh === true;
}
