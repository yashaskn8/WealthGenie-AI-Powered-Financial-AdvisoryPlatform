import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOPBACK_HOST = '127.0.0.1';
const LISTEN_PORT = 8443;
const UPSTREAM_PORT = 8080;
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
  'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'x-forwarded-port', 'x-forwarded-server', 'x-real-ip',
]);

function validPort(value, expected) {
  return typeof value === 'string' && value === String(expected);
}

export function copyPhase15EndToEndHeaders(sourceHeaders = {}) {
  const excluded = new Set(HOP_BY_HOP_HEADERS);
  for (const value of [sourceHeaders.connection, sourceHeaders['proxy-connection']]) {
    for (const name of (Array.isArray(value) ? value : [value])) {
      if (typeof name !== 'string') continue;
      for (const token of name.split(',')) {
        const normalized = token.trim().toLowerCase();
        if (normalized) excluded.add(normalized);
      }
    }
  }

  return Object.fromEntries(Object.entries(sourceHeaders)
    .filter(([name, value]) => !excluded.has(name.toLowerCase()) && value !== undefined));
}

export function isExpectedPhase15ProxyHost(value) {
  return value === `${LOOPBACK_HOST}:${LISTEN_PORT}`;
}

export function validatePhase15LoopbackTlsProxyEnvironment(environment = process.env) {
  const errors = [];
  let upstream;
  try {
    upstream = new URL(environment.PHASE15_TLS_UPSTREAM_URL || '');
  } catch {
    upstream = null;
  }
  if (!upstream || upstream.protocol !== 'http:' || upstream.hostname !== LOOPBACK_HOST
      || !validPort(upstream.port, UPSTREAM_PORT) || upstream.pathname !== '/' || upstream.search || upstream.hash
      || upstream.username || upstream.password) {
    errors.push('TLS proxy upstream must be the fixed loopback frontend origin on port 8080');
  }
  if (environment.PHASE15_TLS_LISTEN_HOST && environment.PHASE15_TLS_LISTEN_HOST !== LOOPBACK_HOST) {
    errors.push('TLS proxy may bind only to IPv4 loopback');
  }
  if (environment.PHASE15_TLS_LISTEN_PORT && !validPort(environment.PHASE15_TLS_LISTEN_PORT, LISTEN_PORT)) {
    errors.push('TLS proxy must use the fixed loopback port 8443');
  }
  for (const key of ['PHASE15_TLS_CERT_PATH', 'PHASE15_TLS_KEY_PATH']) {
    if (typeof environment[key] !== 'string' || !path.isAbsolute(environment[key])) {
      errors.push(`${key} must name an absolute ephemeral certificate path`);
    }
  }
  return { valid: errors.length === 0, errors, upstream };
}

export function createPhase15LoopbackTlsProxy({ certificate, privateKey, upstreamUrl }) {
  const upstream = new URL(upstreamUrl);
  if (upstream.protocol !== 'http:' || upstream.hostname !== LOOPBACK_HOST
      || !validPort(upstream.port, UPSTREAM_PORT) || upstream.pathname !== '/' || upstream.search || upstream.hash
      || upstream.username || upstream.password) {
    throw new TypeError('Phase 15 TLS proxy requires its fixed loopback frontend upstream.');
  }

  const server = createHttpsServer({ cert: certificate, key: privateKey, minVersion: 'TLSv1.2' }, (request, response) => {
    if (!isExpectedPhase15ProxyHost(request.headers.host)) {
      response.writeHead(421, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end('{"error":{"code":"PHASE15_PROXY_HOST_REJECTED"}}');
      return;
    }
    if (typeof request.url !== 'string' || !request.url.startsWith('/')) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end('{"error":{"code":"PHASE15_INVALID_PROXY_REQUEST"}}');
      return;
    }

    const headers = copyPhase15EndToEndHeaders(request.headers);
    headers.host = `${LOOPBACK_HOST}:${UPSTREAM_PORT}`;

    const upstreamRequest = httpRequest({
      hostname: LOOPBACK_HOST,
      port: UPSTREAM_PORT,
      method: request.method,
      path: request.url,
      headers,
      timeout: 125_000,
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, copyPhase15EndToEndHeaders(upstreamResponse.headers));
      upstreamResponse.pipe(response);
    });
    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('upstream timeout')));
    upstreamRequest.on('error', () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end('{"error":{"code":"PHASE15_UPSTREAM_UNAVAILABLE"}}');
    });
    request.on('aborted', () => upstreamRequest.destroy());
    request.pipe(upstreamRequest);
  });

  server.requestTimeout = 130_000;
  server.headersTimeout = 15_000;
  return server;
}

export async function startPhase15LoopbackTlsProxy(environment = process.env, write = line => process.stdout.write(`${line}\n`)) {
  const configuration = validatePhase15LoopbackTlsProxyEnvironment(environment);
  if (!configuration.valid) throw new TypeError(configuration.errors.join('; '));
  const [certificate, privateKey] = await Promise.all([
    readFile(environment.PHASE15_TLS_CERT_PATH),
    readFile(environment.PHASE15_TLS_KEY_PATH),
  ]);
  const server = createPhase15LoopbackTlsProxy({
    certificate,
    privateKey,
    upstreamUrl: configuration.upstream.origin,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(LISTEN_PORT, LOOPBACK_HOST, resolve);
  });
  write('Phase 15 loopback HTTPS proxy is listening on 127.0.0.1:8443.');
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startPhase15LoopbackTlsProxy();
    const stop = () => server.close(() => { process.exitCode = 0; });
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch {
    process.stderr.write('Phase 15 loopback HTTPS proxy could not start safely.\n');
    process.exitCode = 1;
  }
}
