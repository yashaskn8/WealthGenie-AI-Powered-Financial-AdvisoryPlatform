import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  createPhase15LoopbackTlsProxy,
  copyPhase15EndToEndHeaders,
  isExpectedPhase15ProxyHost,
  validatePhase15LoopbackTlsProxyEnvironment,
} from '../scripts/phase15LoopbackTlsProxy.js';

function validEnvironment() {
  return {
    PHASE15_TLS_CERT_PATH: path.resolve('phase15-test.crt'),
    PHASE15_TLS_KEY_PATH: path.resolve('phase15-test.key'),
    PHASE15_TLS_UPSTREAM_URL: 'http://127.0.0.1:8080',
    PHASE15_TLS_LISTEN_HOST: '127.0.0.1',
    PHASE15_TLS_LISTEN_PORT: '8443',
  };
}

test('Phase 15 TLS proxy accepts only absolute temporary cert paths and fixed loopback endpoints', () => {
  assert.equal(validatePhase15LoopbackTlsProxyEnvironment(validEnvironment()).valid, true);
  assert.equal(validatePhase15LoopbackTlsProxyEnvironment({
    ...validEnvironment(),
    PHASE15_TLS_UPSTREAM_URL: 'http://example.com:8080',
  }).valid, false);
  assert.equal(validatePhase15LoopbackTlsProxyEnvironment({
    ...validEnvironment(),
    PHASE15_TLS_LISTEN_HOST: '0.0.0.0',
  }).valid, false);
  assert.equal(validatePhase15LoopbackTlsProxyEnvironment({
    ...validEnvironment(),
    PHASE15_TLS_LISTEN_PORT: '8444',
  }).valid, false);
  assert.equal(validatePhase15LoopbackTlsProxyEnvironment({
    ...validEnvironment(),
    PHASE15_TLS_KEY_PATH: 'relative.key',
  }).valid, false);
});

test('Phase 15 TLS proxy factory rejects a remote upstream even when called directly', () => {
  assert.throws(() => createPhase15LoopbackTlsProxy({
    certificate: 'unused',
    privateKey: 'unused',
    upstreamUrl: 'http://example.com:8080',
  }), /fixed loopback frontend upstream/);
});

test('Phase 15 TLS proxy accepts only its exact host and strips dynamic hop-by-hop headers', () => {
  assert.equal(isExpectedPhase15ProxyHost('127.0.0.1:8443'), true);
  assert.equal(isExpectedPhase15ProxyHost('localhost:8443'), false);
  assert.equal(isExpectedPhase15ProxyHost('127.0.0.1:8080'), false);

  const forwarded = copyPhase15EndToEndHeaders({
    accept: 'text/html',
    cookie: 'session=opaque',
    connection: 'keep-alive, x-internal-hop',
    'x-internal-hop': 'must-not-cross-proxy',
    'proxy-connection': 'x-proxy-hop',
    'x-proxy-hop': 'must-not-cross-proxy',
    'x-forwarded-proto': 'https',
    host: 'attacker.invalid',
    'content-length': '0',
  });
  assert.deepEqual(forwarded, {
    accept: 'text/html',
    cookie: 'session=opaque',
    'content-length': '0',
  });
});
