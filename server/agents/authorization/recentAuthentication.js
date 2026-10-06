export const PASSKEY_ENROLLMENT_MAX_AUTH_AGE_SECONDS = 5 * 60;
const ALLOWED_CLOCK_SKEW_SECONDS = 30;

export function hasRecentSessionAuthentication(user, now = Date.now()) {
  const issuedAt = Number(user?.iat);
  if (!Number.isSafeInteger(issuedAt) || !Number.isFinite(now)) return false;
  const ageSeconds = Math.floor(now / 1000) - issuedAt;
  return ageSeconds >= -ALLOWED_CLOCK_SKEW_SECONDS
    && ageSeconds <= PASSKEY_ENROLLMENT_MAX_AUTH_AGE_SECONDS;
}
