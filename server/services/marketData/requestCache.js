import { getCache, setCache } from '../../config/redis.js';

const inFlight = new Map();

export async function coalesceMarketRequest(key, loader) {
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = Promise.resolve()
    .then(loader)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export async function readThroughMarketCache({
  cacheKey,
  ttlSeconds,
  forceRefresh = false,
  loader,
  shouldCache = result => result?.status !== 'SOURCE_ERROR',
}) {
  if (!forceRefresh) {
    const cached = await getCache(cacheKey);
    if (cached) return {
      ...cached,
      cache: { hit: true, backend: 'REDIS' },
      cacheMetadata: cached.cacheMetadata || { cachedAt: null },
    };
  }

  return coalesceMarketRequest(cacheKey, async () => {
    if (!forceRefresh) {
      const cachedAfterWait = await getCache(cacheKey);
      if (cachedAfterWait) return {
        ...cachedAfterWait,
        cache: { hit: true, backend: 'REDIS' },
        cacheMetadata: cachedAfterWait.cacheMetadata || { cachedAt: null },
      };
    }
    const result = await loader();
    if (shouldCache(result)) {
      await setCache(cacheKey, {
        ...result,
        cacheMetadata: { ...(result?.cacheMetadata || {}), cachedAt: new Date().toISOString() },
      }, ttlSeconds);
    }
    return { ...result, cache: { hit: false, backend: 'REDIS' } };
  });
}

export function clearInFlightMarketRequestsForTest() {
  inFlight.clear();
}
