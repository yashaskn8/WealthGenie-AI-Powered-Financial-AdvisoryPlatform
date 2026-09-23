let installedHook = null;

/** Test-only barrier registry. It is never configurable through an HTTP/API input. */
export function installFinancialStateTestHook(hook) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Financial-state test hooks may only be installed in the test environment.');
  }
  if (typeof hook !== 'function') throw new TypeError('A test hook function is required.');
  const previous = installedHook;
  installedHook = hook;
  return () => {
    if (installedHook === hook) installedHook = previous;
  };
}

export async function reachFinancialStateTestHook(boundary, context = {}) {
  if (process.env.NODE_ENV !== 'test' || !installedHook) return;
  await installedHook(boundary, context);
}
