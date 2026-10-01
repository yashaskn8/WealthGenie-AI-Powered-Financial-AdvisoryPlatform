import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUEST_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);
const RESPONSE_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function isA2APath(requestUrl) {
  const pathname = new URL(requestUrl || '/', 'http://127.0.0.1').pathname;
  return /^\/a2a(?:\/|$)/i.test(pathname);
}

function filteredHeaders(headers, excluded) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!excluded.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  return result;
}

export function createA2ATckAuthProxy({ token, upstreamHost = '127.0.0.1', upstreamPort = 5089 } = {}) {
  if (typeof token !== 'string' || token.trim().length < 16 || /\s/.test(token)) {
    throw new TypeError('A2A TCK proxy requires a valid test bearer token.');
  }
  if (upstreamHost !== '127.0.0.1' && upstreamHost !== '::1') {
    throw new TypeError('A2A TCK proxy upstream must be loopback-only.');
  }
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new TypeError('A2A TCK proxy upstream port is invalid.');
  }

  return http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/__ci-health') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"status":"ok"}');
      return;
    }

    const headers = filteredHeaders(request.headers, REQUEST_HOP_HEADERS);
    delete headers.authorization;
    if (isA2APath(request.url)) headers.authorization = `Bearer ${token}`;

    const upstream = http.request({
      hostname: upstreamHost,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers,
    }, upstreamResponse => {
      response.writeHead(
        upstreamResponse.statusCode || 502,
        filteredHeaders(upstreamResponse.headers, RESPONSE_HOP_HEADERS),
      );
      upstreamResponse.pipe(response);
    });

    upstream.on('error', () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{"error":"A2A_UPSTREAM_UNAVAILABLE"}');
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const listenPort = Number(process.env.A2A_TCK_PROXY_LISTEN_PORT || 5088);
  const upstreamPort = Number(process.env.A2A_TCK_PROXY_UPSTREAM_PORT || 5089);
  const server = createA2ATckAuthProxy({
    token: process.env.A2A_TCK_PROXY_TOKEN,
    upstreamPort,
  });
  server.listen(listenPort, '127.0.0.1', () => {
    process.stdout.write(`A2A TCK auth adapter listening on 127.0.0.1:${listenPort}\n`);
  });
}
