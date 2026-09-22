import { canonicalSha256 } from '../../utils/canonicalJson.js';

export const EVOLUTION_SANDBOX_MANIFEST_VERSION = 'evolution-sandbox-manifest-1.0.0';
export const DEFAULT_SANDBOX_TIMEOUT_MS = 60000;
export const ALLOWED_SANDBOX_COMMANDS = Object.freeze([
  'node --test candidate-evaluation',
  'npm ci --ignore-scripts',
  'npm run lint',
]);
const FORBIDDEN_WORKSPACE_PATH = /(?:^|[\\/])(?:\.env(?:\.|$)|credentials?|secrets?|private|id_rsa|\.git(?:[\\/]|$))/i;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export function assertSandboxCommandAllowed(command) {
  if (!ALLOWED_SANDBOX_COMMANDS.includes(String(command || ''))) {
    const error = new Error('Sandbox command is not allowlisted.');
    error.code = 'SANDBOX_COMMAND_REJECTED';
    throw error;
  }
  return true;
}

export function assertSandboxWorkspacePath(filePath) {
  const value = String(filePath || '');
  if (!value || value.includes('\u0000') || value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.split(/[\\/]/).includes('..') || FORBIDDEN_WORKSPACE_PATH.test(value)) {
    const error = new Error('Sandbox workspace path is not allowed.');
    error.code = 'SANDBOX_PATH_REJECTED';
    throw error;
  }
  return value;
}

export function createEvolutionSandboxManifest({
  candidateId,
  scaffoldHash,
  promptBundleHash,
  allowedFiles = [],
  expectedFiles = [],
  allowedCommands = ['node --test candidate-evaluation'],
  timeoutMs = DEFAULT_SANDBOX_TIMEOUT_MS,
  networkPolicy = 'deny-all',
  datasetHash,
  evaluationVersion,
  reliabilityVersion,
} = {}) {
  if (!candidateId || !scaffoldHash || !promptBundleHash || !datasetHash) throw new Error('Sandbox manifest hashes are required.');
  if (networkPolicy !== 'deny-all') throw new Error('Evolution sandbox network policy must be deny-all.');
  const commands = [...new Set(allowedCommands.map(String))];
  commands.forEach(assertSandboxCommandAllowed);
  const payload = {
    manifestVersion: EVOLUTION_SANDBOX_MANIFEST_VERSION,
    candidateId: String(candidateId),
    scaffoldHash: String(scaffoldHash),
    promptBundleHash: String(promptBundleHash),
    allowedFiles: [...new Set(allowedFiles.map(assertSandboxWorkspacePath))].sort(),
    expectedFiles: [...new Set(expectedFiles.map(assertSandboxWorkspacePath))].sort(),
    allowedCommands: commands,
    timeoutMs: Math.min(DEFAULT_SANDBOX_TIMEOUT_MS, Math.max(1000, Number(timeoutMs) || DEFAULT_SANDBOX_TIMEOUT_MS)),
    networkPolicy,
    datasetHash: String(datasetHash),
    evaluationVersion: String(evaluationVersion || 'unknown'),
    reliabilityVersion: String(reliabilityVersion || 'unknown'),
  };
  return freeze({ ...payload, manifestHash: canonicalSha256(payload) });
}

export function assertSandboxManifestIntegrity(manifest) {
  if (!manifest?.manifestHash) throw new Error('Sandbox manifest hash is required.');
  const { manifestHash, ...payload } = manifest;
  if (canonicalSha256(payload) !== manifestHash) throw new Error('Sandbox manifest hash mismatch.');
  if (payload.networkPolicy !== 'deny-all') throw new Error('Sandbox network policy must be deny-all.');
  payload.allowedCommands.forEach(assertSandboxCommandAllowed);
  return true;
}
