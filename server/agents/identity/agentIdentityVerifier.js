import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import jwt from 'jsonwebtoken';
import { AGENT_CAPABILITIES } from './agentIdentity.js';

const VERIFIED_IDENTITY = Symbol('VerifiedAgentIdentity');
const SUPPORTED_PROVIDERS = new Set(['development', 'oidc', 'spiffe']);
const DEFAULT_ALGORITHMS = Object.freeze(['RS256', 'ES256']);
const MAX_JWKS_CACHE_AGE_MS = 5 * 60 * 1000;
const DEFAULT_JWKS_REFRESH_COOLDOWN_MS = 30 * 1000;

function identityError(code, message, status = 401) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertAgentType(agentType) {
  const normalized = String(agentType || '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(AGENT_CAPABILITIES, normalized)) {
    throw identityError('AGENT_IDENTITY_MAPPING_DENIED', 'Agent identity mapping is not allowed.');
  }
  return normalized;
}

function verifiedIdentity({ provider, issuer = null, subject, audience = null, agentType, capabilities, verifiedAt = new Date() }) {
  const normalizedType = assertAgentType(agentType);
  if (!subject || !capabilities?.length) throw identityError('AGENT_IDENTITY_INVALID', 'Verified agent identity is incomplete.');
  const identity = {
    provider,
    issuer: issuer || null,
    subject: String(subject).slice(0, 240),
    audience: audience || null,
    agentType: normalizedType,
    capabilities: Object.freeze([...capabilities]),
    authenticated: true,
    verifiedAt: new Date(verifiedAt).toISOString(),
  };
  Object.defineProperty(identity, VERIFIED_IDENTITY, { value: true, enumerable: false });
  return Object.freeze(identity);
}

export function isVerifiedAgentIdentity(identity) {
  return Boolean(identity?.[VERIFIED_IDENTITY] === true
    && identity.authenticated === true
    && SUPPORTED_PROVIDERS.has(identity.provider)
    && identity.subject
    && identity.agentType
    && Array.isArray(identity.capabilities)
    && identity.verifiedAt);
}

export function assertVerifiedAgentIdentity(identity, { allowDevelopment = false, env = process.env } = {}) {
  if (isVerifiedAgentIdentity(identity)) return identity;
  // Unit/integration callers may provide the explicit development identity shape
  // outside production. Production paths always require a branded verifier result.
  if (allowDevelopment && env.NODE_ENV !== 'production'
    && identity?.provider === 'development'
    && identity.authenticated === true
    && identity.subject
    && identity.agentType) {
    const normalizedType = assertAgentType(identity.agentType);
    return verifiedIdentity({
      provider: 'development',
      subject: identity.subject,
      agentType: normalizedType,
      capabilities: AGENT_CAPABILITIES[normalizedType],
    });
  }
  throw identityError('AGENT_IDENTITY_NOT_VERIFIED', 'A cryptographically verified agent identity is required.');
}

export function restoreVerifiedAgentIdentity(identity) {
  if (!identity || identity.authenticated !== true || !identity.verifiedAt) {
    throw identityError('AGENT_IDENTITY_NOT_VERIFIED', 'Persisted agent identity is not verified.');
  }
  return verifiedIdentity(identity);
}

function resolveMappedAgentType(subject, mapping) {
  const mapped = mapping?.[subject];
  if (!mapped) throw identityError('AGENT_IDENTITY_MAPPING_DENIED', 'OIDC subject is not mapped to an allowed agent.');
  return assertAgentType(mapped);
}

function pemFromJwk(jwk) {
  try {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
  } catch {
    throw identityError('AGENT_IDENTITY_KEY_INVALID', 'OIDC signing key is invalid.');
  }
}

async function fetchJwksKeySet(jwksUri, fetchImpl = globalThis.fetch) {
  if (!jwksUri) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.');
  let uri;
  try { uri = new URL(jwksUri); } catch { throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC JWKS URL is invalid.', 503); }
  if (uri.protocol !== 'https:' || uri.username || uri.password || uri.hash) {
    throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC JWKS URL must use credential-free HTTPS.', 503);
  }
  let response;
  try {
    response = await fetchImpl(uri, {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
  } catch { throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.'); }
  if (response.status >= 300 && response.status < 400) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS redirects are not allowed.');
  if (!response.ok) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS endpoint did not return keys.');
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 64_000) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS response exceeds the size limit.');
  let bytes;
  try {
    if (!response.body?.getReader) throw new Error('Streaming response body is required.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 64_000) {
        await reader.cancel().catch(() => {});
        throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS response exceeds the size limit.');
      }
      chunks.push(Buffer.from(value));
    }
    bytes = Buffer.concat(chunks, total);
  } catch (error) {
    if (error?.code === 'AGENT_IDENTITY_KEY_UNAVAILABLE') throw error;
    throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS response could not be read.');
  }
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS response is invalid JSON.'); }
  if (!Array.isArray(body?.keys) || body.keys.length > 100) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS key set is invalid.');
  return body.keys;
}

function findJwksKey(keys, header) {
  if (typeof header?.kid !== 'string' || !header.kid || header.kid.length > 256) {
    throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.');
  }
  return keys.find(item => item.kid === header.kid
    && item.use !== 'enc'
    && (!item.alg || item.alg === header.alg)
    && (!item.key_ops || item.key_ops.includes('verify'))
    && !['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(name => item[name] !== undefined));
}

function verifyJwt(token, resolveKey, options) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, (header, callback) => {
      Promise.resolve(resolveKey(header)).then(key => callback(null, key)).catch(callback);
    }, options, (error, payload) => error ? reject(identityError('AGENT_IDENTITY_TOKEN_INVALID', 'OIDC agent identity token verification failed.')) : resolve({ header: options.complete ? payload?.header : null, payload: options.complete ? payload?.payload : payload }));
  });
}

export class DevelopmentAgentIdentityVerifier {
  constructor({ env = process.env } = {}) { this.env = env; }

  async verify({ agentType } = {}) {
    if (this.env.NODE_ENV === 'production') throw identityError('DEVELOPMENT_AGENT_IDENTITY_IN_PRODUCTION', 'Development agent identity is not permitted in production.', 500);
    const normalized = assertAgentType(agentType);
    return verifiedIdentity({ provider: 'development', subject: `dev:${normalized.toLowerCase()}`, agentType: normalized, capabilities: AGENT_CAPABILITIES[normalized] });
  }
}

export class OIDCAgentIdentityVerifier {
  constructor({
    issuer,
    audience,
    algorithms = DEFAULT_ALGORITHMS,
    subjectMap = {},
    publicKey = null,
    jwksUri = null,
    jwksResolver = null,
    fetchImpl = globalThis.fetch,
    jwksCacheTtlMs = MAX_JWKS_CACHE_AGE_MS,
    jwksRefreshCooldownMs = DEFAULT_JWKS_REFRESH_COOLDOWN_MS,
    now = () => performance.now(),
  } = {}) {
    if (!Number.isSafeInteger(jwksCacheTtlMs) || jwksCacheTtlMs < 1 || jwksCacheTtlMs > MAX_JWKS_CACHE_AGE_MS) {
      throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC JWKS cache TTL is invalid.', 503);
    }
    if (!Number.isSafeInteger(jwksRefreshCooldownMs) || jwksRefreshCooldownMs < 0 || jwksRefreshCooldownMs > MAX_JWKS_CACHE_AGE_MS) {
      throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC JWKS refresh cooldown is invalid.', 503);
    }
    if (typeof now !== 'function') throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC clock is invalid.', 503);
    this.issuer = issuer;
    this.audience = audience;
    this.algorithms = algorithms;
    this.subjectMap = subjectMap;
    this.publicKey = publicKey;
    this.jwksUri = jwksUri;
    this.jwksResolver = jwksResolver;
    this.fetchImpl = fetchImpl;
    this.jwksCacheTtlMs = jwksCacheTtlMs;
    this.jwksRefreshCooldownMs = jwksRefreshCooldownMs;
    this.now = now;
    this.jwksCache = null;
    this.jwksRefreshPromise = null;
    this.lastJwksRefreshAt = Number.NEGATIVE_INFINITY;
  }

  async resolveJwksKey(header) {
    if (!this.algorithms.includes(header?.alg)) {
      throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.');
    }
    if (typeof header?.kid !== 'string' || !header.kid || header.kid.length > 256) {
      throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.');
    }

    const now = this.now();
    const cacheIsFresh = this.jwksCache && this.jwksCache.expiresAt > now;
    if (cacheIsFresh) {
      const cachedKey = findJwksKey(this.jwksCache.keys, header);
      if (cachedKey) return pemFromJwk(cachedKey);
    }

    if (!this.jwksRefreshPromise) {
      if (now - this.lastJwksRefreshAt < this.jwksRefreshCooldownMs) {
        throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.');
      }
      this.lastJwksRefreshAt = now;
      this.jwksRefreshPromise = fetchJwksKeySet(this.jwksUri, this.fetchImpl)
        .then(keys => {
          this.jwksCache = { keys, expiresAt: this.now() + this.jwksCacheTtlMs };
          return keys;
        })
        .finally(() => { this.jwksRefreshPromise = null; });
    }

    const keys = await this.jwksRefreshPromise;
    const key = findJwksKey(keys, header);
    if (!key) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key ID was not found.');
    return pemFromJwk(key);
  }

  async verify({ token, agentType } = {}) {
    if (!token || !this.issuer || !this.audience) throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC verification is not fully configured.', 503);
    if (!this.publicKey && !this.jwksUri && !this.jwksResolver) throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC verification requires a public key or JWKS source.', 503);
    const result = await verifyJwt(token, header => {
      if (this.publicKey) return this.publicKey;
      if (this.jwksResolver) return this.jwksResolver(header);
      return this.resolveJwksKey(header);
    }, {
      algorithms: this.algorithms,
      issuer: this.issuer,
      audience: this.audience,
      complete: true,
    });
    const payload = result.payload;
    if (!payload?.sub || !payload?.exp || payload.exp * 1000 <= Date.now() || (payload.nbf && payload.nbf * 1000 > Date.now())) {
      throw identityError('AGENT_IDENTITY_TOKEN_INVALID', 'OIDC token time claims are invalid.');
    }
    const mappedType = resolveMappedAgentType(payload.sub, this.subjectMap);
    if (agentType && mappedType !== assertAgentType(agentType)) throw identityError('AGENT_IDENTITY_MAPPING_DENIED', 'OIDC subject is mapped to a different agent type.');
    return verifiedIdentity({ provider: 'oidc', issuer: this.issuer, subject: payload.sub, audience: this.audience, agentType: mappedType, capabilities: AGENT_CAPABILITIES[mappedType] });
  }
}

export class SpiffeAgentIdentityVerifier {
  constructor({ trustDomain, verifySvid } = {}) { this.trustDomain = trustDomain; this.verifySvid = verifySvid; }

  async verify({ svid, agentType } = {}) {
    if (typeof this.verifySvid !== 'function') throw identityError('SPIFFE_VERIFIER_UNAVAILABLE', 'SPIFFE SVID verification is not configured.', 503);
    const verified = await this.verifySvid({ svid, trustDomain: this.trustDomain });
    if (!verified?.verified || !verified.subject?.startsWith(`spiffe://${this.trustDomain}/`)) throw identityError('SPIFFE_IDENTITY_INVALID', 'SPIFFE SVID verification failed.');
    const mappedType = assertAgentType(verified.agentType);
    if (agentType && mappedType !== assertAgentType(agentType)) throw identityError('AGENT_IDENTITY_MAPPING_DENIED', 'SPIFFE identity is mapped to a different agent type.');
    return verifiedIdentity({ provider: 'spiffe', issuer: this.trustDomain, subject: verified.subject, audience: verified.audience || null, agentType: mappedType, capabilities: AGENT_CAPABILITIES[mappedType] });
  }
}

function parseSubjectMap(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'AGENT_OIDC_SUBJECT_MAP must be valid JSON.', 500);
  }
}

export function createAgentIdentityVerifier({ env = process.env, dependencies = {} } = {}) {
  const provider = String(env.AGENT_IDENTITY_PROVIDER || 'development').toLowerCase();
  if (provider === 'development') return new DevelopmentAgentIdentityVerifier({ env });
  if (provider === 'oidc') return new OIDCAgentIdentityVerifier({
    issuer: env.AGENT_OIDC_ISSUER,
    audience: env.AGENT_OIDC_AUDIENCE,
    algorithms: String(env.AGENT_OIDC_ALGORITHMS || 'RS256,ES256').split(',').map(item => item.trim()).filter(Boolean),
    subjectMap: parseSubjectMap(env.AGENT_OIDC_SUBJECT_MAP),
    publicKey: env.AGENT_OIDC_PUBLIC_KEY || null,
    jwksUri: env.AGENT_OIDC_JWKS_URL || null,
    jwksResolver: dependencies.jwksResolver,
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
  });
  if (provider === 'spiffe') return new SpiffeAgentIdentityVerifier({ trustDomain: env.SPIFFE_TRUST_DOMAIN, verifySvid: dependencies.verifySvid });
  throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'Unsupported agent identity provider.', 500);
}
