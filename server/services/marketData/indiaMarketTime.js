import { normalizeTimestamp } from './contracts.js';

const IST_OFFSET_MS = 330 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function isoDateInIndia(value) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) return null;
  const shifted = new Date(Date.parse(normalized) + IST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function indiaClockParts(value) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) return null;
  const shifted = new Date(Date.parse(normalized) + IST_OFFSET_MS);
  return {
    isoDate: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}
