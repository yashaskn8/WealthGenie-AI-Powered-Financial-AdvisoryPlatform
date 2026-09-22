import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AGENT_CAPABILITIES } from './agentIdentity.js';

const VERIFIED_IDENTITY = Symbol('VerifiedAgentIdentity');
const SUPPORTED_PROVIDERS = new Set(['development', 'oidc', 'spiffe']);
const DEFAULT_ALGORITHMS = Object.freeze(['RS256', 'ES256']);

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

async function fetchJwksKey(jwksUri, header) {
  if (!jwksUri || !header?.kid) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key is unavailable.');
  const response = await fetch(jwksUri, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC JWKS endpoint did not return keys.');
  const body = await response.json();
  const key = body?.keys?.find(item => item.kid === header.kid && item.use !== 'enc');
  if (!key) throw identityError('AGENT_IDENTITY_KEY_UNAVAILABLE', 'OIDC signing key ID was not found.');
  return pemFromJwk(key);
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
  constructor({ issuer, audience, algorithms = DEFAULT_ALGORITHMS, subjectMap = {}, publicKey = null, jwksUri = null, jwksResolver = null } = {}) {
    this.issuer = issuer;
    this.audience = audience;
    this.algorithms = algorithms;
    this.subjectMap = subjectMap;
    this.publicKey = publicKey;
    this.jwksUri = jwksUri;
    this.jwksResolver = jwksResolver;
  }

  async verify({ token, agentType } = {}) {
    if (!token || !this.issuer || !this.audience) throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC verification is not fully configured.', 503);
    if (!this.publicKey && !this.jwksUri && !this.jwksResolver) throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'OIDC verification requires a public key or JWKS source.', 503);
    const result = await verifyJwt(token, header => this.publicKey || this.jwksResolver?.(header) || fetchJwksKey(this.jwksUri, header), {
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
  });
  if (provider === 'spiffe') return new SpiffeAgentIdentityVerifier({ trustDomain: env.SPIFFE_TRUST_DOMAIN, verifySvid: dependencies.verifySvid });
  throw identityError('AGENT_IDENTITY_CONFIGURATION_INVALID', 'Unsupported agent identity provider.', 500);
}
