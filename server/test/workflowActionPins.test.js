import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  validateContainerManifestDirectory,
  validateDockerfileDirectory,
  validateWorkflowDirectory,
} from '../scripts/validate-workflow-action-pins.js';

test('workflow action pin validator rejects mutable external refs and allows local actions', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-action-pins-'));
  const workflows = path.join(directory, 'workflows');
  mkdirSync(workflows);
  try {
    writeFileSync(path.join(workflows, 'mutable.yml'), [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: ./.github/actions/local-check',
      '      - uses: docker://example.invalid/action@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '    services:',
      '      redis:',
      '        image: redis:7.2-alpine',
      '',
    ].join('\n'));
    const violations = validateWorkflowDirectory(workflows);
    assert.equal(violations.length, 2);
    assert.ok(violations.some(item => /actions\/checkout@v4/.test(item)));
    assert.ok(violations.some(item => /redis:7\.2-alpine/.test(item)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('container image validators reject mutable infrastructure and Dockerfile base references', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-image-pins-'));
  const manifests = path.join(directory, 'manifests');
  mkdirSync(manifests);
  try {
    writeFileSync(path.join(manifests, 'deployment.yml'), [
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: redis',
      '          image: redis:7.2-alpine',
      '',
    ].join('\n'));
    writeFileSync(path.join(directory, 'Dockerfile'), 'FROM node:22-alpine\n');
    assert.equal(validateContainerManifestDirectory(manifests).length, 1);
    assert.equal(validateDockerfileDirectory(directory).length, 1);
    writeFileSync(path.join(directory, 'Dockerfile'), 'FROM node:22-alpine@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
    assert.equal(validateDockerfileDirectory(directory).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workflow action pin validator rejects malformed YAML and non-40-character commit refs', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-action-pins-'));
  try {
    writeFileSync(path.join(directory, 'bad.yml'), 'jobs: [unterminated');
    writeFileSync(path.join(directory, 'short-sha.yml'), 'jobs:\n  test:\n    steps:\n      - uses: actions/checkout@abcdef\n');
    const violations = validateWorkflowDirectory(directory);
    assert.equal(violations.length, 2);
    assert.ok(violations.some(item => item.includes('invalid workflow YAML')));
    assert.ok(violations.some(item => item.includes('actions/checkout@abcdef')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
