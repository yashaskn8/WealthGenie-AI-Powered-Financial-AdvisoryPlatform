import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const BUILD_PROVENANCE_SCHEMA = 'wealthgenie.build-provenance.v1';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const LOCK_FILES = Object.freeze({
  serverLockSha256: 'server/package-lock.json',
  frontendLockSha256: 'reactapp/package-lock.json',
  mlRequirementsSha256: 'ml-service/requirements.txt',
});

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFrontendArtifacts(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Frontend artifact root must be a real directory.');
  const entries = [];
  async function walk(directory, relativeDirectory = '') {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error('Frontend artifacts may not contain symbolic links.');
      if (info.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!info.isFile()) throw new Error('Frontend artifacts may contain only regular files.');
      const contents = await readFile(absolutePath);
      entries.push({ path: relativePath.replace(/\\/g, '/'), sha256: sha256(contents), byteLength: contents.byteLength });
    }
  }
  await walk(root);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return sha256(canonicalJson(entries));
}

function validateBuildTimestamp(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export async function createBuildProvenance({
  repositoryRoot,
  frontendArtifactDirectory,
  gitCommitSha,
  gitTreeSha,
  serverImageIdentity = null,
  frontendImageIdentity = null,
  mlImageIdentity = null,
  workflowRunId = null,
  workflowRunAttempt = null,
  buildTimestamp = null,
}) {
  const manifest = {
    schemaVersion: BUILD_PROVENANCE_SCHEMA,
    gitCommitSha: String(gitCommitSha || '').toLowerCase(),
    gitTreeSha: String(gitTreeSha || '').toLowerCase(),
  };
  for (const [field, relativePath] of Object.entries(LOCK_FILES)) {
    manifest[field] = sha256(await readFile(path.join(repositoryRoot, relativePath)));
  }
  manifest.frontendArtifactSetSha256 = await hashFrontendArtifacts(frontendArtifactDirectory);
  manifest.serverImageIdentity = serverImageIdentity || null;
  manifest.frontendImageIdentity = frontendImageIdentity || null;
  manifest.mlImageIdentity = mlImageIdentity || null;
  manifest.workflowRunId = workflowRunId == null ? null : String(workflowRunId);
  manifest.workflowRunAttempt = workflowRunAttempt == null ? null : String(workflowRunAttempt);
  manifest.buildTimestamp = buildTimestamp || null;
  manifest.provenanceSha256 = sha256(canonicalJson(manifest));
  const validation = verifyBuildProvenance(manifest);
  if (!validation.valid) throw new TypeError(`Build provenance is invalid: ${validation.errors.join(', ')}`);
  return manifest;
}

export function serializeBuildProvenance(manifest) {
  return `${canonicalJson(manifest)}\n`;
}

export function verifyBuildProvenance(manifest, expected = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['MANIFEST_INVALID'] };
  }
  if (manifest.schemaVersion !== BUILD_PROVENANCE_SCHEMA) errors.push('SCHEMA_MISMATCH');
  if (!SHA40.test(manifest.gitCommitSha || '')) errors.push('COMMIT_SHA_INVALID');
  if (!SHA40.test(manifest.gitTreeSha || '')) errors.push('TREE_SHA_INVALID');
  for (const field of Object.keys(LOCK_FILES)) {
    if (!SHA64.test(manifest[field] || '')) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (!SHA64.test(manifest.frontendArtifactSetSha256 || '')) errors.push('FRONTEND_ARTIFACT_SHA_INVALID');
  for (const field of ['serverImageIdentity', 'frontendImageIdentity', 'mlImageIdentity']) {
    if (manifest[field] !== null && !IMAGE_ID.test(manifest[field] || '')) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  for (const field of ['workflowRunId', 'workflowRunAttempt']) {
    if (manifest[field] !== null && (typeof manifest[field] !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(manifest[field]))) {
      errors.push(`${field.toUpperCase()}_INVALID`);
    }
  }
  if (manifest.workflowRunAttempt !== null && !/^[1-9]\d*$/.test(manifest.workflowRunAttempt || '')) {
    errors.push('WORKFLOW_RUN_ATTEMPT_INVALID');
  }
  if (manifest.buildTimestamp !== null && !validateBuildTimestamp(manifest.buildTimestamp)) errors.push('BUILD_TIMESTAMP_INVALID');
  const { provenanceSha256, ...unsignedManifest } = manifest;
  if (!SHA64.test(provenanceSha256 || '') || sha256(canonicalJson(unsignedManifest)) !== provenanceSha256) {
    errors.push('MANIFEST_HASH_MISMATCH');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && value !== null && manifest[field] !== value) errors.push(`EXPECTED_${field.toUpperCase()}_MISMATCH`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function buildProvenanceMatches(left, right) {
  return verifyBuildProvenance(left).valid
    && verifyBuildProvenance(right).valid
    && left.provenanceSha256 === right.provenanceSha256;
}

export function loadBuildProvenance(filePath = process.env.APP_BUILD_PROVENANCE_PATH) {
  if (!filePath) return { status: 'UNAVAILABLE', manifest: null, errors: [] };
  try {
    const manifest = JSON.parse(readFileSync(filePath, 'utf8'));
    const result = verifyBuildProvenance(manifest);
    return result.valid
      ? { status: 'VERIFIED', manifest, errors: [] }
      : { status: 'INVALID', manifest: null, errors: result.errors };
  } catch {
    return { status: 'INVALID', manifest: null, errors: ['MANIFEST_UNREADABLE'] };
  }
}
