import net from 'node:net';

const SAFE_DATABASE_NAME = /^[A-Za-z0-9_-]{1,63}$/;
const RESERVED_DATABASE_NAMES = new Set(['admin', 'config', 'local', 'test']);
const DEMO_DATABASE_SUFFIX = /(?:-demo|_demo)$/i;
const SAFE_DNS_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;
const DEMO_ENVIRONMENT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DEMO_SENTINEL_ID = 'wealthgenie-phase15-demo';
const DEMO_SENTINEL_PURPOSE = 'WEALTHGENIE_PHASE15_DEMO';

export function isSafeDemoDatabaseName(value) {
  return typeof value === 'string'
    && SAFE_DATABASE_NAME.test(value)
    && !RESERVED_DATABASE_NAMES.has(value.toLowerCase())
    && DEMO_DATABASE_SUFFIX.test(value);
}

export function normalizeDemoDatabaseHost(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null;
  const host = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (net.isIP(host) || SAFE_DNS_HOST.test(host)) return host.toLowerCase();
  return null;
}

export function isSafeDemoDatabaseHost(value) {
  return normalizeDemoDatabaseHost(value) !== null;
}

export function normalizeDemoDatabasePort(value) {
  if (typeof value === 'string' && !/^[1-9]\d{0,4}$/.test(value)) return null;
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function isSafeDemoDatabasePort(value) {
  return normalizeDemoDatabasePort(value) !== null;
}

export function normalizeDemoEnvironmentId(value) {
  return typeof value === 'string' && DEMO_ENVIRONMENT_ID.test(value) ? value.toLowerCase() : null;
}

export function isSafeDemoEnvironmentId(value) {
  return normalizeDemoEnvironmentId(value) !== null;
}

/**
 * Read-only proof that the operator-designated demo database carries its
 * separately provisioned environment marker. The application never creates
 * or repairs this record.
 */
export async function verifyDemoEnvironmentSentinel({ database, expectedEnvironmentId }) {
  const normalizedEnvironmentId = normalizeDemoEnvironmentId(expectedEnvironmentId);
  if (!normalizedEnvironmentId || typeof database?.collection !== 'function') return false;
  try {
    const sentinel = await database.collection('demo_environment_sentinels').findOne({ _id: DEMO_SENTINEL_ID });
    if (!sentinel || typeof sentinel !== 'object' || Array.isArray(sentinel)) return false;
    const keys = Object.keys(sentinel).sort();
    if (keys.join(',') !== '_id,environmentId,purpose,schemaVersion') return false;
    return sentinel._id === DEMO_SENTINEL_ID
      && normalizeDemoEnvironmentId(sentinel.environmentId) === normalizedEnvironmentId
      && sentinel.purpose === DEMO_SENTINEL_PURPOSE
      && sentinel.schemaVersion === 1;
  } catch {
    return false;
  }
}

/**
 * Require agreement between the live backend's connection, its operator
 * configuration, and the independent preflight process.
 */
export function verifyDemoDatabaseIdentity({
  actual,
  configuredExpected,
  requestedExpected,
  actualHost,
  configuredExpectedHost,
  requestedExpectedHost,
  actualPort,
  configuredExpectedPort,
  requestedExpectedPort,
}) {
  const actualHostValue = normalizeDemoDatabaseHost(actualHost);
  const configuredHostValue = normalizeDemoDatabaseHost(configuredExpectedHost);
  const requestedHostValue = normalizeDemoDatabaseHost(requestedExpectedHost);
  const actualPortValue = normalizeDemoDatabasePort(actualPort);
  const configuredPortValue = normalizeDemoDatabasePort(configuredExpectedPort);
  const requestedPortValue = normalizeDemoDatabasePort(requestedExpectedPort);
  return isSafeDemoDatabaseName(actual)
    && isSafeDemoDatabaseName(configuredExpected)
    && isSafeDemoDatabaseName(requestedExpected)
    && configuredExpected === requestedExpected
    && actual === configuredExpected
    && actualHostValue !== null
    && configuredHostValue !== null
    && requestedHostValue !== null
    && configuredHostValue === requestedHostValue
    && actualHostValue === configuredHostValue
    && actualPortValue !== null
    && configuredPortValue !== null
    && requestedPortValue !== null
    && configuredPortValue === requestedPortValue
    && actualPortValue === configuredPortValue;
}
