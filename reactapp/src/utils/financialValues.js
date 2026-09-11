export function isPresentFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

export function toOptionalNumber(value) {
  return value === null || value === undefined || String(value).trim() === ''
    ? undefined
    : Number(value);
}
