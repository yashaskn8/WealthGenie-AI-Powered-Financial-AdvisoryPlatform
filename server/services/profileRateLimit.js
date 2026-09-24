import { createError } from '../middleware/errorHandler.js';

export const PROFILE_BUILD_LIMIT = 10;
const WINDOW_SECONDS = 60 * 60;

const INCREMENT_WITH_EXPIRY = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

function unavailableError() {
  return createError(
    503,
    'Profile submission rate limiting is unavailable.',
    'Profile creation is temporarily unavailable. Please try again shortly.',
    { code: 'PROFILE_RATE_LIMIT_UNAVAILABLE' },
  );
}

/**
 * Atomically consume a profile-build quota. Redis is required for this
 * cross-process limit; when it cannot enforce the limit, mutation fails closed.
 */
export async function consumeProfileBuildQuota(userId, { client, available, limit = PROFILE_BUILD_LIMIT } = {}) {
  if (!userId || !Number.isSafeInteger(limit) || limit < 1 || !available || !client?.eval) {
    throw unavailableError();
  }

  let count;
  try {
    count = Number(await client.eval(INCREMENT_WITH_EXPIRY, {
      keys: [`profile:ratelimit:${String(userId)}`],
      arguments: [String(WINDOW_SECONDS)],
    }));
  } catch {
    throw unavailableError();
  }
  if (!Number.isSafeInteger(count) || count < 1) throw unavailableError();
  return count <= limit;
}

export { INCREMENT_WITH_EXPIRY as PROFILE_BUILD_RATE_LIMIT_SCRIPT };
