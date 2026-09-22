import crypto from 'node:crypto';
import path from 'node:path';
import { assertSandboxCommandAllowed, assertSandboxManifestIntegrity, assertSandboxWorkspacePath } from './sandboxManifest.js';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function assertWorkspaceContent(content) {
  const value = String(content || '');
  if (value.length > 1024 * 1024 || value.includes('\u0000') || /BEGIN\s+(?:RSA|EC|OPENSSH)\s+PRIVATE KEY|(?:api[_-]?key|secret|password|token|jwt)\s*[:=]/i.test(value)) {
    const error = new Error('Sandbox workspace content contains forbidden or oversized data.');
    error.code = 'SANDBOX_CONTENT_REJECTED';
    throw error;
  }
  return value;
}

function pathAllowed(candidate, roots) {
  if (!candidate || !roots.length) return false;
  const resolved = path.resolve(candidate);
  return roots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

function attestedResult({ manifest, provider, sessionId, result = {} }) {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  return Object.freeze({
    candidateId: manifest.candidateId,
    manifestHash: manifest.manifestHash,
    promptBundleHash: manifest.promptBundleHash,
    scaffoldHash: manifest.scaffoldHash,
    testResults: result.testResults || null,
    evaluationMetrics: result.evaluationMetrics || null,
    reliabilityMetrics: result.reliabilityMetrics || null,
    stdoutHash: hash(stdout),
    stderrHash: hash(stderr),
    startedAt: result.startedAt || new Date().toISOString(),
    completedAt: result.completedAt || new Date().toISOString(),
    provider,
    sandboxSessionIdHash: hash(sessionId),
  });
}

export class FixtureEvolutionSandboxProvider {
  constructor({ execute = null } = {}) {
    this.name = 'fixture';
    this.execute = execute;
  }

  async run({ manifest, candidate, fixture } = {}) {
    assertSandboxManifestIntegrity(manifest);
    if (typeof this.execute !== 'function') {
      const error = new Error('Fixture sandbox execution callback is required.');
      error.code = 'SANDBOX_EXECUTOR_REQUIRED';
      throw error;
    }
    const startedAt = new Date().toISOString();
    const result = await this.execute({ manifest, candidate, fixture });
    return attestedResult({ manifest, provider: this.name, sessionId: `fixture:${manifest.candidateId}`, result: { ...result, startedAt, completedAt: new Date().toISOString() } });
  }
}

export class E2BEvolutionSandboxProvider {
  constructor({ enabled = false, production = false, apiKey = process.env.E2B_API_KEY, template = 'base' } = {}) {
    this.name = 'e2b';
    this.enabled = Boolean(enabled) && !production;
    this.production = Boolean(production);
    this.apiKey = apiKey || null;
    this.template = String(template || 'base');
  }

  async run({ manifest, workspaceFiles = [], command = 'node --test candidate-evaluation' } = {}) {
    assertSandboxManifestIntegrity(manifest);
    assertSandboxCommandAllowed(command);
    if (!Array.isArray(workspaceFiles) || workspaceFiles.some(file => {
      const filePath = assertSandboxWorkspacePath(file?.path);
      assertWorkspaceContent(file?.content);
      return !manifest.allowedFiles.includes(filePath);
    })) {
      const error = new Error('Workspace file is outside the sandbox manifest allowlist.');
      error.code = 'SANDBOX_FILE_REJECTED';
      throw error;
    }
    if (!this.enabled || this.production) {
      const error = new Error('E2B evolution sandbox is disabled by default and unavailable in production.');
      error.code = 'E2B_SANDBOX_DISABLED';
      throw error;
    }
    if (!this.apiKey) {
      const error = new Error('E2B_API_KEY is required for live sandbox execution.');
      error.code = 'E2B_API_KEY_REQUIRED';
      throw error;
    }
    const { Sandbox } = await import('e2b');
    const startedAt = new Date().toISOString();
    let sandbox;
    try {
      sandbox = await Sandbox.create(this.template, {
        timeoutMs: manifest.timeoutMs,
        allowInternetAccess: false,
        envs: {},
        apiKey: this.apiKey,
      });
      for (const file of workspaceFiles) {
        await sandbox.files.write(assertSandboxWorkspacePath(file.path), assertWorkspaceContent(file.content));
      }
      const execution = await sandbox.commands.run(command, { timeoutMs: manifest.timeoutMs });
      return attestedResult({
        manifest,
        provider: this.name,
        sessionId: sandbox.sandboxId,
        result: {
          stdout: execution?.stdout || execution?.output || '',
          stderr: execution?.stderr || '',
          testResults: { exitCode: Number(execution?.exitCode ?? 0) },
          startedAt,
          completedAt: new Date().toISOString(),
        },
      });
    } finally {
      if (sandbox && typeof sandbox.kill === 'function') await sandbox.kill().catch(() => undefined);
    }
  }
}

export function createSandboxProvider({ enabled = false, allowedRoots = [], production = false } = {}) {
  const roots = allowedRoots.map(root => path.resolve(root));
  return Object.freeze({
    enabled: Boolean(enabled) && !production,
    async run() {
      const error = new Error('Evolution sandbox execution is disabled by default.');
      error.code = 'SANDBOX_DISABLED';
      throw error;
    },
    isPathAllowed(candidate) { return pathAllowed(candidate, roots); },
  });
}

export function createEvolutionSandboxProvider({ provider = 'fixture', enabled = false, production = false, execute = null } = {}) {
  if (provider === 'fixture') return new FixtureEvolutionSandboxProvider({ execute });
  if (provider === 'e2b') return new E2BEvolutionSandboxProvider({ enabled, production });
  const error = new Error('Unknown evolution sandbox provider.');
  error.code = 'SANDBOX_PROVIDER_UNKNOWN';
  throw error;
}
