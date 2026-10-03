const SAFE_DATABASE_NAME = /^[A-Za-z0-9_-]{1,63}$/;
const RESERVED_DATABASE_NAMES = new Set(['admin', 'config', 'local', 'test']);

export function isSafeDemoDatabaseName(value) {
  return typeof value === 'string'
    && SAFE_DATABASE_NAME.test(value)
    && !RESERVED_DATABASE_NAMES.has(value.toLowerCase());
}

/**
 * Require agreement between the live backend's connection, its operator
 * configuration, and the independent preflight process.
 */
export function verifyDemoDatabaseIdentity({ actual, configuredExpected, requestedExpected }) {
  return isSafeDemoDatabaseName(actual)
    && isSafeDemoDatabaseName(configuredExpected)
    && isSafeDemoDatabaseName(requestedExpected)
    && configuredExpected === requestedExpected
    && actual === configuredExpected;
}
