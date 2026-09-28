const OFFICIAL_PRIMARY_HOSTS = new Set([
  'rbi.org.in',
  'sebi.gov.in',
  'incometax.gov.in',
  'incometaxindia.gov.in',
  'amfiindia.com',
  'indiapost.gov.in',
  'dea.gov.in',
]);

const PRIMARY_ISSUER_HOSTS = new Set([
  'sbi.co.in',
]);

const TRUSTED_SECONDARY_HOSTS = new Set([
  'reuters.com',
  'livemint.com',
  'moneycontrol.com',
]);

export const RESEARCH_SOURCE_TRUST_TIERS = Object.freeze([
  'OFFICIAL_PRIMARY',
  'PRIMARY_ISSUER',
  'TRUSTED_SECONDARY',
  'UNVERIFIED',
]);

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function classifyResearchSource({ url } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { return 'UNVERIFIED'; }
  // TLS is part of source identity: an official hostname served over cleartext
  // HTTP is not qualified evidence and must never receive a trusted tier.
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return 'UNVERIFIED';
  const hostname = parsed.hostname.toLowerCase();
  if ([...OFFICIAL_PRIMARY_HOSTS].some(domain => hostMatches(hostname, domain))) return 'OFFICIAL_PRIMARY';
  if ([...PRIMARY_ISSUER_HOSTS].some(domain => hostMatches(hostname, domain))) return 'PRIMARY_ISSUER';
  if ([...TRUSTED_SECONDARY_HOSTS].some(domain => hostMatches(hostname, domain))) return 'TRUSTED_SECONDARY';
  return 'UNVERIFIED';
}

export function sourceTrustRank(tier) {
  return RESEARCH_SOURCE_TRUST_TIERS.indexOf(tier) === -1 ? RESEARCH_SOURCE_TRUST_TIERS.length : RESEARCH_SOURCE_TRUST_TIERS.indexOf(tier);
}

export function isSourceTierAtLeast(actual, required) {
  return sourceTrustRank(actual) <= sourceTrustRank(required);
}
