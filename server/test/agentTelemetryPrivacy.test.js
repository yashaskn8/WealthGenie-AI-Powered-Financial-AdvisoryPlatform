import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { FileSpanExporter } from '../config/tracing.js';
import { recordAgentError, sanitizeAgentAttributes } from '../agents/observability/agentTelemetry.js';

const ATTACK_VALUES = [
  'Bearer bearer-secret-sentinel',
  'JWT eyJhbGciOiJub25l.eyJzdWIiOiJzZWNyZXQifQ.jwt-secret-sentinel',
  'mongodb://user:mongo-password-sentinel@db.invalid/wealthgenie',
  'redis://user:redis-password-sentinel@cache.invalid/0',
  'email: telemetry-person-sentinel@example.invalid',
  'phone: +919876543210',
  'PAN: ABCDE1234F',
  'Aadhaar: 1234 5678 9012',
  'unlabeled bank identifier 123456789012',
  'Aadhaar: 1234 5678 9012',
  'unlabeled bank identifier 123456789012',
  'bank_account: bank-account-secret-sentinel',
  'income: 180000 salary: 120000',
  'api_key: api-key-secret-sentinel',
  'cookie: session-cookie-secret-sentinel',
  'https://s.invalid/x?X-Amz-Signature=aws-signature-sentinel&X-Goog-Signature=google-signature-sentinel',
];

const ALLOWLISTED_ATTRIBUTES = [
  'agent.name',
  'agent.version',
  'agent.run_id',
  'agent.candidate_id',
  'agent.tool_name',
  'gen_ai.system',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'error.type',
];

async function exportSpans(callbacks) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer('agent-telemetry-privacy-test');
  try {
    for (const callback of callbacks) {
      const span = tracer.startSpan('agent.operation');
      callback(span);
      span.end();
    }
    await provider.forceFlush();
    return exporter.getFinishedSpans();
  } finally {
    await provider.shutdown();
  }
}

async function exportSpan(callback) {
  const [span] = await exportSpans([callback]);
  return span;
}

test('agent telemetry redacts hostile values on every allowlisted attribute before export', async () => {
  const attacks = ATTACK_VALUES.flatMap(value => [
    () => Object.fromEntries(ALLOWLISTED_ATTRIBUTES.map(name => [name, value])),
  ]);
  const exported = await exportSpans(attacks.map(buildAttributes => span => (
    span.setAttributes(sanitizeAgentAttributes(buildAttributes()))
  )));
  const serialized = JSON.stringify(exported.map(span => ({ attributes: span.attributes, events: span.events })));

  for (const secret of [
    'bearer-secret-sentinel',
    'jwt-secret-sentinel',
    'mongo-password-sentinel',
    'redis-password-sentinel',
    'telemetry-person-sentinel@example.invalid',
    '+919876543210',
    'ABCDE1234F',
    '1234 5678 9012',
    '123456789012',
    '1234 5678 9012',
    '123456789012',
    'bank-account-secret-sentinel',
    '180000',
    '120000',
    'api-key-secret-sentinel',
    'session-cookie-secret-sentinel',
    'aws-signature-sentinel',
    'google-signature-sentinel',
  ]) {
    assert.equal(serialized.includes(secret), false, `exported telemetry leaked ${secret}`);
  }
  assert.equal(Object.keys(exported[0].attributes).length, ALLOWLISTED_ATTRIBUTES.length);
});

test('recordAgentError exports only sanitized bounded exception data, including nested provider errors', async () => {
  const cause = new Error('PAN: ABCDE1234F; account: nested-account-secret-sentinel');
  const error = new Error(
    'provider failed for income: 180000; Authorization: Bearer exception-bearer-sentinel; ' +
      'mongodb://user:exception-mongo-secret-sentinel@db.invalid/app',
    { cause },
  );
  error.name = 'ProviderError';
  error.code = 'error-code-safe';
  error.config = {
    headers: { cookie: 'exception-cookie-secret-sentinel' },
    url: 'https://storage.invalid/file?X-Goog-Signature=exception-google-signature-sentinel',
  };
  error.response = { data: { apiKey: 'exception-api-key-secret-sentinel' } };

  const exported = await exportSpan(span => recordAgentError(span, error));
  const serialized = JSON.stringify({ attributes: exported.attributes, events: exported.events });

  for (const secret of [
    '180000',
    'exception-bearer-sentinel',
    'exception-mongo-secret-sentinel',
    'ABCDE1234F',
    '1234 5678 9012',
    '1234 5678 9012',
    'nested-account-secret-sentinel',
    'exception-cookie-secret-sentinel',
    'exception-google-signature-sentinel',
    'exception-api-key-secret-sentinel',
  ]) {
    assert.equal(serialized.includes(secret), false, `exported exception telemetry leaked ${secret}`);
  }
  assert.equal(exported.events.length, 1);
  assert.equal(exported.events[0].attributes['exception.type'], 'ProviderError');
  assert.equal(exported.attributes['error.type'], 'error-code-safe');
  assert.match(exported.events[0].attributes['exception.message'], /provider failed/);

  const directory = mkdtempSync(path.join(tmpdir(), 'wealthgenie-trace-exception-'));
  try {
    const tracePath = path.join(directory, 'trace.jsonl');
    const fileExporter = new FileSpanExporter(tracePath);
    await new Promise((resolve, reject) => fileExporter.export([exported], result => (
      result.code === 0 ? resolve() : reject(result.error)
    )));
    const record = JSON.parse(readFileSync(tracePath, 'utf8'));
    assert.equal(record.events.length, 1);
    assert.equal(record.events[0].attributes['exception.type'], 'ProviderError');
    assert.equal(JSON.stringify(record).includes('ABCDE1234F'), false);
    assert.equal(JSON.stringify(record).includes('exception-bearer-sentinel'), false);
    assert.equal(Object.hasOwn(record.events[0].attributes, 'exception.stacktrace'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Axios, Mongo, Redis, A2A, MCP, and WebAuthn exception fields are sanitized before export', async () => {
  const errors = [
    Object.assign(new Error('axios request failed'), {
      name: 'AxiosError',
      code: 'ERR_BAD_RESPONSE',
      config: { headers: { authorization: 'Bearer axios-bearer-secret-sentinel' } },
      response: { data: { email: 'axios-person-sentinel@example.invalid', cookie: 'axios-cookie-sentinel' } },
    }),
    Object.assign(new Error('Mongo connection failed mongodb://user:mongo-family-secret-sentinel@db.invalid/app'), {
      name: 'MongoServerError',
      code: 11000,
      connectionString: 'mongodb://user:mongo-family-secret-sentinel@db.invalid/app',
    }),
    Object.assign(new Error('Redis connection failed redis://user:redis-family-secret-sentinel@cache.invalid/0'), {
      name: 'RedisConnectionError',
    }),
    Object.assign(new Error('A2A task carried JWT eyJhbGciOiJub25l.eyJzdWIiOiJhMmEifQ.a2a-jwt-secret-sentinel'), {
      name: 'A2AError',
    }),
    Object.assign(new Error('MCP request failed with api_key: mcp-api-key-secret-sentinel'), {
      name: 'McpError',
    }),
    Object.assign(new Error('WebAuthn challenge PAN: ABCDE1234F phone: +919876543210'), {
      name: 'WebAuthnError',
    }),
    Object.assign(new Error('Aadhaar 1234 5678 9012; account 123456789012'), {
      name: 'IdentityError',
    }),
    Object.assign(new Error('Aadhaar 1234 5678 9012; account 123456789012'), {
      name: 'IdentityError',
    }),
  ];
  const exportedData = [];

  for (const error of errors) {
    const exported = await exportSpan(span => recordAgentError(span, error));
    exportedData.push(JSON.stringify({ attributes: exported.attributes, events: exported.events }));
  }

  const serialized = exportedData.join('\n');
  for (const secret of [
    'axios-bearer-secret-sentinel',
    'axios-person-sentinel@example.invalid',
    'axios-cookie-sentinel',
    'mongo-family-secret-sentinel',
    'redis-family-secret-sentinel',
    'a2a-jwt-secret-sentinel',
    'mcp-api-key-secret-sentinel',
    'ABCDE1234F',
    '+919876543210',
    '1234 5678 9012',
    '123456789012',
    '1234 5678 9012',
    '123456789012',
  ]) {
    assert.equal(serialized.includes(secret), false, `exported exception telemetry leaked ${secret}`);
  }
  assert.match(serialized, /AxiosError/);
  assert.match(serialized, /MongoServerError/);
  assert.match(serialized, /RedisConnectionError/);
  assert.match(serialized, /A2AError/);
  assert.match(serialized, /McpError/);
  assert.match(serialized, /WebAuthnError/);
});

test('telemetry accepts only finite scalar values and bounds sanitized strings', () => {
  let accessorCalled = false;
  const attributes = {
    'agent.name': 'safe'.repeat(100),
    'agent.step_count': Number.POSITIVE_INFINITY,
    'agent.status': ['not', 'scalar'],
    'agent.tool_name': true,
  };
  Object.defineProperty(attributes, 'agent.run_id', {
    enumerable: true,
    get() {
      accessorCalled = true;
      return 'must-not-run';
    },
  });

  const safe = sanitizeAgentAttributes(attributes);
  assert.equal(safe['agent.name'].length, 120);
  assert.equal(safe['agent.step_count'], undefined);
  assert.equal(safe['agent.status'], undefined);
  assert.equal(safe['agent.tool_name'], true);
  assert.equal(safe['agent.run_id'], undefined);
  assert.equal(accessorCalled, false);
});

test('file span exporter applies the same value sanitization to emitted span attributes', async () => {
  const exported = await exportSpans(ATTACK_VALUES.map(value => span => span.setAttributes(
    Object.fromEntries(ALLOWLISTED_ATTRIBUTES.map(name => [name, value])),
  )));
  const directory = mkdtempSync(path.join(tmpdir(), 'wealthgenie-telemetry-'));
  const filePath = path.join(directory, 'traces.jsonl');

  try {
    await new Promise((resolve, reject) => {
      new FileSpanExporter(filePath).export(exported, result => {
        if (result.code !== 0) reject(result.error || new Error('trace export failed'));
        else resolve();
      });
    });
    const serialized = readFileSync(filePath, 'utf8');
    for (const secret of [
      'bearer-secret-sentinel',
      'jwt-secret-sentinel',
      'mongo-password-sentinel',
      'redis-password-sentinel',
      'telemetry-person-sentinel@example.invalid',
      '+919876543210',
      'ABCDE1234F',
      '1234 5678 9012',
      '123456789012',
      '1234 5678 9012',
      '123456789012',
      'bank-account-secret-sentinel',
      '180000',
      '120000',
      'api-key-secret-sentinel',
      'session-cookie-secret-sentinel',
      'aws-signature-sentinel',
      'google-signature-sentinel',
    ]) {
      assert.equal(serialized.includes(secret), false, `file telemetry leaked ${secret}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('file span exporter reduces dynamic span names and hides sink error details', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wealthgenie-telemetry-span-'));
  const filePath = path.join(directory, 'traces.jsonl');
  const [span] = await exportSpans([() => {}]);
  const exporter = new FileSpanExporter(filePath);
  const dynamicSpan = new Proxy(span, {
    get(target, property) {
      return property === 'name'
        ? 'POST /profile/prana-income-180000'
        : Reflect.get(target, property, target);
    },
  });

  try {
    await new Promise((resolve, reject) => {
      exporter.export([dynamicSpan], result => {
        if (result.code !== 0) reject(result.error || new Error('trace export failed'));
        else resolve();
      });
    });
    const serialized = readFileSync(filePath, 'utf8');
    assert.match(serialized, /"name":"http\.request\.POST"/);
    assert.equal(serialized.includes('prana-income-180000'), false);

    const directoryUsedAsFile = mkdtempSync(path.join(tmpdir(), 'wealthgenie-telemetry-failure-'));
    const failureExporter = new FileSpanExporter(directoryUsedAsFile);
    let result;
    await new Promise(resolve => failureExporter.export([dynamicSpan], value => {
      result = value;
      resolve();
    }));
    assert.equal(result.code, 1);
    assert.equal(result.error.message, 'Trace export failed.');
    rmSync(directoryUsedAsFile, { recursive: true, force: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
