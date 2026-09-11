import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSpanExporter, resolveTraceLogPath } from '../config/tracing.js';

function sampleSpan() {
  return {
    spanContext: () => ({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    }),
    parentSpanId: 'c'.repeat(16),
    duration: [0, 1_000_000],
    status: { code: 1 },
    startTime: [Math.floor(Date.now() / 1000), 0],
    name: 'test.span',
    attributes: { test: true },
  };
}

function exportSpan(exporter) {
  return new Promise(resolve => {
    exporter.export([sampleSpan()], result => resolve(result));
  });
}

test('tracing resolves an explicit TRACE_LOG_PATH and creates its parent directory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-tracing-'));
  const configuredPath = path.join(tempDir, 'nested', 'traces.jsonl');

  try {
    assert.equal(resolveTraceLogPath({ TRACE_LOG_PATH: configuredPath }), path.resolve(configuredPath));
    const result = await exportSpan(new FileSpanExporter(configuredPath));
    assert.equal(result.code, 0);
    assert.ok(fs.existsSync(configuredPath));
    assert.equal(JSON.parse(fs.readFileSync(configuredPath, 'utf8').trim()).service, 'wealthgenie-express');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('tracing exporter reports a write failure once without throwing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-tracing-failure-'));
  const directoryUsedAsFile = path.join(tempDir, 'trace-directory');
  fs.mkdirSync(directoryUsedAsFile);
  const exporter = new FileSpanExporter(directoryUsedAsFile);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    assert.equal((await exportSpan(exporter)).code, 1);
    assert.equal((await exportSpan(exporter)).code, 1);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
