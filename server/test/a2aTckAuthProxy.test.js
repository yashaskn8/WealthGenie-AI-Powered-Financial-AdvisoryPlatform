import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createA2ATckAuthProxy } from '../scripts/a2aTckAuthProxy.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('TCK auth adapter injects only its fixed credential on the A2A path', async t => {
  const observed = [];
  const upstream = http.createServer((request, response) => {
    observed.push({ path: request.url, authorization: request.headers.authorization || null });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = createA2ATckAuthProxy({ token: 'ci-only-token-value-1234', upstreamPort });
  const proxyPort = await listen(proxy);
  t.after(async () => {
    proxy.close();
    upstream.close();
    await Promise.all([once(proxy, 'close'), once(upstream, 'close')]);
  });

  const publicResponse = await fetch(`http://127.0.0.1:${proxyPort}/.well-known/agent-card.json`, {
    headers: { authorization: 'Bearer attacker-controlled' },
  });
  assert.equal(publicResponse.status, 200);
  assert.equal(observed[0].authorization, null);

  const a2aResponse = await fetch(`http://127.0.0.1:${proxyPort}/a2a/message:send`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer attacker-controlled',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(a2aResponse.status, 200);
  assert.deepEqual(observed[1], {
    path: '/a2a/message:send',
    authorization: 'Bearer ci-only-token-value-1234',
  });

  const lookalikeResponse = await fetch(`http://127.0.0.1:${proxyPort}/a2a-not-a-route`, {
    headers: { authorization: 'Bearer attacker-controlled' },
  });
  assert.equal(lookalikeResponse.status, 200);
  assert.equal(observed[2].authorization, null);
});

test('TCK auth adapter rejects non-loopback upstream configuration', () => {
  assert.throws(
    () => createA2ATckAuthProxy({ token: 'ci-only-token-value-1234', upstreamHost: 'example.com' }),
    /loopback-only/,
  );
});
