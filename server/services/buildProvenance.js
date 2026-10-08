import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, opendir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const BUILD_PROVENANCE_SCHEMA = 'wealthgenie.build-provenance.v2';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
export const MAX_FRONTEND_ARTIFACT_COUNT = 2048;
export const MAX_FRONTEND_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_FRONTEND_ARTIFACT_SET_BYTES = 64 * 1024 * 1024;
export const MAX_FRONTEND_PROVENANCE_BYTES = 4 * 1024 * 1024;
const MAX_FRONTEND_ARTIFACT_DEPTH = 32;
const MAX_FRONTEND_ARTIFACT_ENTRY_COUNT = 4096;
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

export function isSafeFrontendArtifactPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !/^[a-z]:/i.test(value)
    && !/[%](?:2e|2f|5c)/i.test(value)
    && !/[\u0000-\u001f\u007f\u2028\u2029\u2044\u2215\uff0f\uff3c]/u.test(value)
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some(segment => !segment || segment === '.' || segment === '..')
    && path.posix.normalize(value) === value;
}

function isValidFrontendArtifactInventory(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FRONTEND_ARTIFACT_COUNT) return false;
  let previousPath = null;
  let totalBytes = 0;
  const paths = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const keys = Object.keys(entry).sort();
    if (keys.length !== 3 || keys[0] !== 'byteLength' || keys[1] !== 'path' || keys[2] !== 'sha256') return false;
    if (!isSafeFrontendArtifactPath(entry.path)
        || !SHA64.test(entry.sha256 || '')
        || !Number.isSafeInteger(entry.byteLength)
        || entry.byteLength < 0
        || entry.byteLength > MAX_FRONTEND_ARTIFACT_BYTES
        || paths.has(entry.path)
        || (previousPath !== null && previousPath >= entry.path)) return false;
    totalBytes += entry.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_FRONTEND_ARTIFACT_SET_BYTES) return false;
    paths.add(entry.path);
    previousPath = entry.path;
  }
  return paths.has('index.html');
}

async function hashFrontendArtifactFile(filePath, maxBytes) {
  const hash = createHash('sha256');
  let byteLength = 0;
  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    byteLength += chunk.byteLength;
    if (byteLength > maxBytes) throw new Error('Frontend artifact exceeds the configured byte budget.');
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), byteLength };
}

async function collectFrontendArtifacts(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Frontend artifact root must be a real directory.');
  const entries = [];
  let entryCount = 0;
  let totalBytes = 0;
  async function walk(directory, relativeDirectory = '') {
    const depth = relativeDirectory ? relativeDirectory.split('/').length : 0;
    const children = await opendir(directory);
    for await (const child of children) {
      entryCount += 1;
      if (entryCount > MAX_FRONTEND_ARTIFACT_ENTRY_COUNT) throw new Error('Frontend artifact tree exceeds the configured entry limit.');
      const childDepth = depth + 1;
      if (childDepth > MAX_FRONTEND_ARTIFACT_DEPTH) throw new Error('Frontend artifact tree exceeds the configured depth limit.');
      const absolutePath = path.join(directory, child.name);
      const relativePath = relativeDirectory ? relativeDirectory + '/' + child.name : child.name;
      const normalizedPath = relativePath.replace(/\\/g, '/');
      if (!isSafeFrontendArtifactPath(normalizedPath)) throw new Error('Frontend artifact path is unsafe.');
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) throw new Error('Frontend artifacts may not contain symbolic links.');
      if (info.isDirectory()) {
        await walk(absolutePath, normalizedPath);
        continue;
      }
      if (!info.isFile()) throw new Error('Frontend artifacts may contain only regular files.');
      if (entries.length >= MAX_FRONTEND_ARTIFACT_COUNT) throw new Error('Frontend artifact inventory exceeds the configured count limit.');
      if (info.size > MAX_FRONTEND_ARTIFACT_BYTES) throw new Error('Frontend artifact exceeds the per-file byte budget.');
      if (!Number.isSafeInteger(info.size) || totalBytes + info.size > MAX_FRONTEND_ARTIFACT_SET_BYTES) {
        throw new Error('Frontend artifact set exceeds the aggregate byte budget.');
      }
      const digest = await hashFrontendArtifactFile(absolutePath, Math.min(MAX_FRONTEND_ARTIFACT_BYTES, MAX_FRONTEND_ARTIFACT_SET_BYTES - totalBytes));
      if (digest.byteLength !== info.size) throw new Error('Frontend artifact changed while it was being hashed.');
      totalBytes += digest.byteLength;
      entries.push({ path: normalizedPath, sha256: digest.sha256, byteLength: digest.byteLength });
    }
  }
  await walk(root);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!isValidFrontendArtifactInventory(entries)) throw new Error('Frontend artifacts must include a valid index.html inventory.');
  return entries;
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
  manifest.frontendArtifactInventory = await collectFrontendArtifacts(frontendArtifactDirectory);
  manifest.frontendArtifactSetSha256 = sha256(canonicalJson(manifest.frontendArtifactInventory));
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
  if (!isValidFrontendArtifactInventory(manifest.frontendArtifactInventory)) {
    errors.push('FRONTEND_ARTIFACT_INVENTORY_INVALID');
  } else if (sha256(canonicalJson(manifest.frontendArtifactInventory)) !== manifest.frontendArtifactSetSha256) {
    errors.push('FRONTEND_ARTIFACT_SET_HASH_MISMATCH');
  }
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
