/**
 * WealthGenie Environment & Security Configuration Validation
 *
 * Provides fail-closed validation for runtime configuration across
 * development, test, and production environments.
 */

import { validateMongoCompatibilityConfig } from './mongoCompatibility.js';

export function validateEnvironmentConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  const errors = [];
  errors.push(...validateMongoCompatibilityConfig(env).errors);

  const workerMode = String(env.AGENT_WORKER_MODE || (isProduction ? 'external' : 'embedded')).toLowerCase();
  if (!['embedded', 'external'].includes(workerMode)) {
    errors.push('AGENT_WORKER_MODE must be embedded or external');
  }
  if (isProduction && workerMode !== 'external') {
    errors.push('AGENT_WORKER_MODE must be external in production');
  }

  if (!env.JWT_SECRET || !env.JWT_SECRET.trim()) {
    errors.push('JWT_SECRET is required');
  }
  if (!env.MONGODB_URI || !env.MONGODB_URI.trim()) {
    errors.push('MONGODB_URI is required');
  }

  const researchA2AEnabled = env.AGENT_A2A_V1_ENABLED === 'true';
  const researchFeatureEnabled = researchA2AEnabled
    || env.AGENT_DEEP_RESEARCH_ENABLED === 'true'
    || env.AGENT_ADAPTIVE_RESEARCH_ENABLED === 'true'
    || env.AGENT_RESEARCH_LIVE_SEARCH_ENABLED === 'true';
  if (researchFeatureEnabled && !researchA2AEnabled) errors.push('ResearchMesh feature flags require AGENT_A2A_V1_ENABLED=true');
  if (researchA2AEnabled) {
    if (!env.AGENT_A2A_RESEARCH_URL) errors.push('AGENT_A2A_RESEARCH_URL is required when A2A ResearchMesh is enabled');
    if (isProduction && !String(env.AGENT_A2A_RESEARCH_URL || '').startsWith('https://')) errors.push('AGENT_A2A_RESEARCH_URL must use HTTPS in production');
    const identityProvider = String(env.AGENT_IDENTITY_PROVIDER || 'development').toLowerCase();
    if (isProduction && identityProvider === 'development') errors.push('Production ResearchMesh requires OIDC or SPIFFE agent identity');
    if (!isProduction && identityProvider === 'development' && !env.AGENT_A2A_DEV_TOKEN) errors.push('AGENT_A2A_DEV_TOKEN is required for development A2A ResearchMesh');
    if (isProduction && env.AGENT_A2A_CARD_SIGNING_ENABLED !== 'true') errors.push('Production ResearchMesh requires signed Agent Cards');
    if (isProduction && env.AGENT_A2A_CARD_SIGNING_ENABLED === 'true' && !env.AGENT_A2A_CARD_SIGNING_PRIVATE_KEY) errors.push('Production signed Agent Cards require AGENT_A2A_CARD_SIGNING_PRIVATE_KEY');
  }
  if (env.AGENT_RESEARCH_LIVE_SEARCH_ENABLED === 'true'
    && (String(env.RESEARCH_SEARCH_PROVIDER || '').toLowerCase() !== 'configured' || !env.RESEARCH_SEARCH_PROVIDER_URL)) {
    errors.push('Live ResearchMesh search requires the configured approved search provider and endpoint');
  }

  const jwtSecret = (env.JWT_SECRET || '').trim();
  const INSECURE_JWT_PLACEHOLDERS = [
    'CHANGE_ME',
    'default_jwt_secret',
    'super_secret_jwt',
    'your_64_char_hex',
    'ci-dev-jwt-secret',
    'secret',
  ];
  const isPlaceholderJwt = INSECURE_JWT_PLACEHOLDERS.some(p => jwtSecret.toLowerCase().includes(p.toLowerCase()));

  if (isProduction) {
    if (jwtSecret.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    }
    if (isPlaceholderJwt) {
      errors.push('Insecure or placeholder JWT_SECRET detected in production environment');
    }
    if (!env.ML_SERVICE_API_KEY || !env.ML_SERVICE_API_KEY.trim()) {
      errors.push('ML_SERVICE_API_KEY is required in production');
    } else if (env.ML_SERVICE_API_KEY.startsWith('CHANGE_ME')) {
      errors.push('Insecure placeholder ML_SERVICE_API_KEY detected in production');
    }
    if (!env.METRICS_TOKEN || env.METRICS_TOKEN.trim().length < 32
      || env.METRICS_TOKEN.includes('CHANGE_ME')) {
      errors.push('METRICS_TOKEN must be at least 32 characters in production');
    }
    const origins = (env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (origins.length === 0) {
      errors.push('CORS_ORIGINS must contain at least one trusted HTTPS origin in production');
    }
    for (const origin of origins) {
      let parsed;
      try { parsed = new URL(origin); } catch { parsed = null; }
      if (!parsed || parsed.origin !== origin.replace(/\/+$/, '') || parsed.protocol !== 'https:') {
        errors.push(`CORS_ORIGINS contains an invalid production origin: ${origin}`);
      }
    }
    const sameSite = (env.AUTH_COOKIE_SAME_SITE || 'strict').toLowerCase();
    if (!['strict', 'lax', 'none'].includes(sameSite)) {
      errors.push('AUTH_COOKIE_SAME_SITE must be strict, lax, or none');
    }
    if (sameSite === 'none' && env.AUTH_COOKIE_SECURE === 'false') {
      errors.push('SameSite=None cookies must be Secure in production');
    }
    if (env.EXPOSE_AUTH_TOKEN === 'true') {
      errors.push('EXPOSE_AUTH_TOKEN cannot be enabled in production');
    }
    if (env.AGENT_VERIFIABLE_ACTIONS_ENABLED === 'true') {
      if (env.AGENT_WEBAUTHN_APPROVAL_ENABLED !== 'true') errors.push('AGENT_WEBAUTHN_APPROVAL_ENABLED must be true when verifiable actions are enabled in production');
      if (String(env.AGENT_APPROVAL_PROVIDER || 'webauthn').toLowerCase() !== 'webauthn') errors.push('AGENT_APPROVAL_PROVIDER must be webauthn when verifiable actions are enabled in production');
      if (!env.WEBAUTHN_ORIGIN || !env.WEBAUTHN_RP_ID) errors.push('WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID are required for production verifiable actions');
      if (!env.AUTHORIZATION_SIGNING_PRIVATE_KEY || !env.AUTHORIZATION_SIGNING_PUBLIC_KEY) errors.push('Authorization signing keys are required for production verifiable actions');
      const identityProvider = String(env.AGENT_IDENTITY_PROVIDER || 'development').toLowerCase();
      if (identityProvider === 'development') errors.push('AGENT_IDENTITY_PROVIDER cannot be development for production verifiable actions');
      if (!['oidc', 'spiffe'].includes(identityProvider)) errors.push('AGENT_IDENTITY_PROVIDER must be oidc or spiffe for production verifiable actions');
      if (identityProvider === 'oidc') {
        if (!env.AGENT_OIDC_ISSUER || !env.AGENT_OIDC_AUDIENCE) errors.push('OIDC issuer and audience are required for production agent identity');
        if (!env.AGENT_OIDC_PUBLIC_KEY && !env.AGENT_OIDC_JWKS_URL) errors.push('OIDC public key or JWKS URL is required for production agent identity');
        if (!env.AGENT_OIDC_SUBJECT_MAP) errors.push('AGENT_OIDC_SUBJECT_MAP is required for production agent identity');
      }
      if (identityProvider === 'spiffe' && !env.SPIFFE_TRUST_DOMAIN) errors.push('SPIFFE_TRUST_DOMAIN is required for production agent identity');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
