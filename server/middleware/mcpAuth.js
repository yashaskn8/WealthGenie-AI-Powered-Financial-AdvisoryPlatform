import jwt from 'jsonwebtoken';
import { isTokenBlacklisted, TokenRevocationUnavailableError } from '../config/redis.js';
import { sendError } from './errorHandler.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';

function hasRequiredScope(payload, requiredScope) {
  if (!requiredScope) return true;
  const scopes = [
    ...(typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : []),
    ...(Array.isArray(payload.scopes) ? payload.scopes.filter(value => typeof value === 'string') : []),
  ];
  return scopes.includes(requiredScope);
}

/** Remote MCP deliberately accepts only a resource-scoped Bearer JWT. */
export function verifyMcpBearer({ config, env = process.env, checkRevocation = isTokenBlacklisted } = {}) {
  return async function mcpBearerMiddleware(req, res, next) {
    const header = req.headers.authorization;
    const match = typeof header === 'string'
      ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header)
      : null;
    if (!match) {
      PrometheusMetrics.inc('mcp_auth_rejections_total');
      return sendError(req, res, 401, 'A valid MCP Bearer token is required.', 'MCP_AUTH_REQUIRED');
    }

    try {
      const secret = config?.jwtSecret || env.MCP_JWT_SECRET;
      if (typeof secret !== 'string' || secret.length < 32 || secret === env.JWT_SECRET) {
        throw Object.assign(new Error('MCP signing key is unavailable or not isolated.'), { code: 'MCP_AUTH_CONFIGURATION_INVALID' });
      }
      const verifyOptions = { algorithms: ['HS256'], audience: config?.jwtAudience, issuer: config?.jwtIssuer };
      if (!verifyOptions.audience || !verifyOptions.issuer) {
        throw Object.assign(new Error('MCP token issuer and audience are required.'), { code: 'MCP_AUTH_CONFIGURATION_INVALID' });
      }
      const payload = jwt.verify(match[1], secret, verifyOptions);
      if (!payload || typeof payload !== 'object' || !payload.userId
          || typeof payload.jti !== 'string' || payload.jti.length < 1 || payload.jti.length > 128
          || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)
          || payload.token_use !== 'mcp'
          || (config?.requiredScope && !hasRequiredScope(payload, config.requiredScope))) {
        PrometheusMetrics.inc('mcp_auth_rejections_total');
        return sendError(req, res, 401, 'The token is not authorized for MCP access.', 'MCP_AUTH_SCOPE_REQUIRED');
      }
      if (payload.jti && await checkRevocation(payload.jti)) {
        PrometheusMetrics.inc('mcp_auth_rejections_total');
        return sendError(req, res, 401, 'The MCP token has been revoked.', 'MCP_AUTH_TOKEN_REVOKED');
      }
      req.mcpPrincipal = Object.freeze({
        userId: String(payload.userId),
        role: typeof payload.role === 'string' ? payload.role : 'user',
        scopes: Object.freeze([
          ...(typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : []),
          ...(Array.isArray(payload.scopes) ? payload.scopes.filter(value => typeof value === 'string') : []),
        ]),
      });
      return next();
    } catch (error) {
      if (error instanceof TokenRevocationUnavailableError || error?.code === 'TOKEN_REVOCATION_UNAVAILABLE') {
        return sendError(req, res, 503, 'MCP authentication status is temporarily unavailable.', 'MCP_AUTH_UNAVAILABLE');
      }
      PrometheusMetrics.inc('mcp_auth_rejections_total');
      const code = error?.name === 'TokenExpiredError' ? 'MCP_AUTH_TOKEN_EXPIRED' : 'MCP_AUTH_TOKEN_INVALID';
      return sendError(req, res, 401, 'The MCP Bearer token is invalid or expired.', code);
    }
  };
}
