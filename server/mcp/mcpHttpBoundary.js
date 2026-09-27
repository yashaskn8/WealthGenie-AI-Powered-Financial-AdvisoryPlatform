import { sendError } from '../middleware/errorHandler.js';
import proxyaddr from 'proxy-addr';

function parseHost(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255 || /[\s/@?#]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return { hostname: parsed.hostname.toLowerCase().replace(/\.$/, ''), port: parsed.port };
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function mcpHttpBoundary({ config }) {
  const origins = new Set(config.allowedOrigins);
  const trustedProxy = config.trustedProxyCidrs?.length ? proxyaddr.compile(config.trustedProxyCidrs) : null;
  return function validateMcpHttpBoundary(req, res, next) {
    const requestHost = parseHost(req.headers.host);
    const allowedHost = requestHost && config.allowedHosts.some(value => {
      const candidate = parseHost(value);
      if (!candidate || candidate.hostname !== requestHost.hostname) return false;
      if (candidate.port) return candidate.port === requestHost.port;
      if (!config.isProduction && isLocalHost(candidate.hostname)) return true;
      return !requestHost.port || requestHost.port === '443';
    });
    if (!allowedHost) {
      return sendError(req, res, 403, 'The MCP host is not allowed.', 'MCP_HOST_REJECTED');
    }

    if (config.isProduction) {
      const directTls = config.directTls === true && req.socket?.encrypted === true;
      const remoteAddress = req.socket?.remoteAddress || '';
      const trustedEdge = trustedProxy && trustedProxy(remoteAddress);
      const forwardedProtocol = req.headers['x-forwarded-proto'];
      const trustedForwardedTls = Boolean(trustedEdge && typeof forwardedProtocol === 'string'
        && forwardedProtocol.trim().toLowerCase() === 'https' && !forwardedProtocol.includes(','));
      if (!directTls && !trustedForwardedTls) {
        return sendError(req, res, 403, 'Remote MCP requires direct TLS or a configured trusted TLS proxy.', 'MCP_PROTOCOL_REJECTED');
      }
    }

    const origin = req.headers.origin;
    if (origin !== undefined) {
      let parsed;
      try { parsed = new URL(origin); } catch { parsed = null; }
      if (!parsed || parsed.origin !== origin || !origins.has(origin)
          || (config.isProduction && parsed.protocol !== 'https:')) {
        return sendError(req, res, 403, 'The MCP origin is not allowed.', 'MCP_ORIGIN_REJECTED');
      }
    }
    // X-Forwarded-Host is intentionally never used as authority. The direct
    // Host header must match the configured service host; trusted ingress
    // configuration remains responsible for replacing forwarded headers.
    return next();
  };
}
