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
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
