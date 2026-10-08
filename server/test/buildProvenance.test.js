import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProvenanceMatches,
  canonicalJson,
  createBuildProvenance,
  serializeBuildProvenance,
  verifyBuildProvenance,
} from '../services/buildProvenance.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const SERVER_IMAGE = `sha256:${'1'.repeat(64)}`;
const FRONTEND_IMAGE = `sha256:${'2'.repeat(64)}`;
const ML_IMAGE = `sha256:${'3'.repeat(64)}`;

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wealthgenie-build-provenance-'));
  const frontend = path.join(directory, 'frontend');
  await mkdir(path.join(frontend, 'assets'), { recursive: true });
  await writeFile(path.join(frontend, 'index.html'), '<html>build-a</html>');
  await writeFile(path.join(frontend, 'assets', 'app.js'), 'window.build = "a";');
  const provenance = await createBuildProvenance({
    repositoryRoot: REPO_ROOT,
    frontendArtifactDirectory: frontend,
    gitCommitSha: SOURCE_SHA,
    gitTreeSha: TREE_SHA,
    serverImageIdentity: SERVER_IMAGE,
    frontendImageIdentity: FRONTEND_IMAGE,
    mlImageIdentity: ML_IMAGE,
    workflowRunId: '123456',
    workflowRunAttempt: '2',
    buildTimestamp: '2026-10-05T00:00:00.000Z',
  });
  return { directory, frontend, provenance };
}

test('build provenance binds source tree, authoritative locks, frontend bytes, images, and workflow identity', async () => {
  const fixture = await createFixture();
  try {
    const result = verifyBuildProvenance(fixture.provenance, {
      gitCommitSha: SOURCE_SHA,
      gitTreeSha: TREE_SHA,
      frontendArtifactSetSha256: fixture.provenance.frontendArtifactSetSha256,
      serverImageIdentity: SERVER_IMAGE,
      frontendImageIdentity: FRONTEND_IMAGE,
      mlImageIdentity: ML_IMAGE,
    });
    assert.equal(result.valid, true, result.errors.join(', '));
    assert.match(fixture.provenance.serverLockSha256, /^[a-f0-9]{64}$/);
    assert.match(fixture.provenance.frontendLockSha256, /^[a-f0-9]{64}$/);
    assert.match(fixture.provenance.mlRequirementsSha256, /^[a-f0-9]{64}$/);
    assert.match(fixture.provenance.frontendArtifactSetSha256, /^[a-f0-9]{64}$/);
    assert.match(fixture.provenance.provenanceSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(serializeBuildProvenance(fixture.provenance)).provenanceSha256, fixture.provenance.provenanceSha256);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('provenance rejects the right commit with a wrong tree, wrong frontend bytes, or wrong lockfile', async () => {
  const fixture = await createFixture();
  try {
    for (const expected of [
      { gitCommitSha: SOURCE_SHA, gitTreeSha: 'c'.repeat(40) },
      { frontendArtifactSetSha256: 'd'.repeat(64) },
      { serverLockSha256: 'e'.repeat(64) },
    ]) {
      assert.equal(verifyBuildProvenance(fixture.provenance, expected).valid, false);
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('provenance rejects wrong image identities and frontend/backend manifests from different builds', async () => {
  const fixture = await createFixture();
  try {
    assert.equal(verifyBuildProvenance(fixture.provenance, { serverImageIdentity: `sha256:${'4'.repeat(64)}` }).valid, false);
    const otherFrontend = path.join(fixture.directory, 'other-frontend');
    await mkdir(otherFrontend, { recursive: true });
    await writeFile(path.join(otherFrontend, 'index.html'), '<html>build-b</html>');
    const otherBuild = await createBuildProvenance({
      repositoryRoot: REPO_ROOT,
      frontendArtifactDirectory: otherFrontend,
      gitCommitSha: SOURCE_SHA,
      gitTreeSha: TREE_SHA,
      serverImageIdentity: SERVER_IMAGE,
      frontendImageIdentity: `sha256:${'4'.repeat(64)}`,
      mlImageIdentity: ML_IMAGE,
      workflowRunId: '123456',
      workflowRunAttempt: '2',
      buildTimestamp: '2026-10-05T00:00:00.000Z',
    });
    assert.equal(verifyBuildProvenance(otherBuild).valid, true);
    assert.equal(buildProvenanceMatches(fixture.provenance, otherBuild), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('provenance rejects tampered or unsafe frontend artifact inventories', async () => {
  const fixture = await createFixture();
  try {
    const rehashManifest = manifest => {
      const unsigned = { ...manifest };
      delete unsigned.provenanceSha256;
      return {
        ...manifest,
        provenanceSha256: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
      };
    };
    const changedArtifact = structuredClone(fixture.provenance);
    changedArtifact.frontendArtifactInventory[0].sha256 = 'e'.repeat(64);
    const changedArtifactResult = verifyBuildProvenance(rehashManifest(changedArtifact));
    assert.equal(changedArtifactResult.valid, false);
    assert.ok(changedArtifactResult.errors.includes('FRONTEND_ARTIFACT_SET_HASH_MISMATCH'));

    const unsafePath = structuredClone(fixture.provenance);
    unsafePath.frontendArtifactInventory[0].path = '../escape.js';
    const unsafePathResult = verifyBuildProvenance(rehashManifest(unsafePath));
    assert.equal(unsafePathResult.valid, false);
    assert.ok(unsafePathResult.errors.includes('FRONTEND_ARTIFACT_INVENTORY_INVALID'));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('provenance rejects drive-letter, encoded-delimiter, and Unicode-separator artifact paths', async () => {
  const fixture = await createFixture();
  try {
    for (const unsafePath of [
      'C:/outside.js',
      'assets/%2e%2e/escape.js',
      'assets/name%2fescape.js',
      'assets/name%5c..%5cescape.js',
      'assets/a\u2215b.js',
      'assets/a\u2044b.js',
      'assets/a\uFF0Fb.js',
      'assets/a\uFF3Cb.js',
    ]) {
      const manifest = structuredClone(fixture.provenance);
      manifest.frontendArtifactInventory[0].path = unsafePath;
      manifest.frontendArtifactInventory.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      manifest.frontendArtifactSetSha256 = createHash('sha256')
        .update(canonicalJson(manifest.frontendArtifactInventory)).digest('hex');
      delete manifest.provenanceSha256;
      manifest.provenanceSha256 = createHash('sha256').update(canonicalJson(manifest)).digest('hex');
      const result = verifyBuildProvenance(manifest);
      assert.equal(result.valid, false, unsafePath);
      assert.ok(result.errors.includes('FRONTEND_ARTIFACT_INVENTORY_INVALID'), unsafePath);
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('provenance rejects per-artifact and aggregate frontend byte budgets above measured limits', async () => {
  const fixture = await createFixture();
  try {
    const reseal = manifest => {
      manifest.frontendArtifactInventory.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      manifest.frontendArtifactSetSha256 = createHash('sha256')
        .update(canonicalJson(manifest.frontendArtifactInventory)).digest('hex');
      delete manifest.provenanceSha256;
      manifest.provenanceSha256 = createHash('sha256').update(canonicalJson(manifest)).digest('hex');
      return manifest;
    };
    const oversizedFile = structuredClone(fixture.provenance);
    oversizedFile.frontendArtifactInventory[0].byteLength = 16 * 1024 * 1024 + 1;
    assert.ok(verifyBuildProvenance(reseal(oversizedFile)).errors.includes('FRONTEND_ARTIFACT_INVENTORY_INVALID'));

    const oversizedSet = structuredClone(fixture.provenance);
    oversizedSet.frontendArtifactInventory = [
      ...Array.from({ length: 5 }, (_, index) => ({
        path: 'assets/large-' + index + '.bin',
        sha256: String(index + 1).repeat(64),
        byteLength: 16 * 1024 * 1024,
      })),
      ...oversizedSet.frontendArtifactInventory,
    ];
    const aggregateResult = verifyBuildProvenance(reseal(oversizedSet));
    assert.equal(aggregateResult.valid, false);
    assert.ok(aggregateResult.errors.includes('FRONTEND_ARTIFACT_INVENTORY_INVALID'));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('frontend provenance collection rejects an oversized file before hashing it', async () => {
  const fixture = await createFixture();
  try {
    const oversizedPath = path.join(fixture.frontend, 'assets', 'oversized.bin');
    await writeFile(oversizedPath, Buffer.alloc(0));
    await truncate(oversizedPath, 16 * 1024 * 1024 + 1);
    await assert.rejects(createBuildProvenance({
      repositoryRoot: REPO_ROOT,
      frontendArtifactDirectory: fixture.frontend,
      gitCommitSha: SOURCE_SHA,
      gitTreeSha: TREE_SHA,
    }), /frontend artifact.*(size|limit|budget)/i);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('provenance detects a tampered manifest and hashes nested frontend paths deterministically', async () => {
  const fixture = await createFixture();
  try {
    const tampered = { ...fixture.provenance, gitTreeSha: 'c'.repeat(40) };
    assert.equal(verifyBuildProvenance(tampered).valid, false);
    const canonicalHash = fixture.provenance.frontendArtifactSetSha256;
    await writeFile(path.join(fixture.frontend, 'assets', 'app.js'), 'window.build = "different";');
    const changed = await createBuildProvenance({
      repositoryRoot: REPO_ROOT,
      frontendArtifactDirectory: fixture.frontend,
      gitCommitSha: SOURCE_SHA,
      gitTreeSha: TREE_SHA,
      serverImageIdentity: SERVER_IMAGE,
      frontendImageIdentity: FRONTEND_IMAGE,
      mlImageIdentity: ML_IMAGE,
      workflowRunId: '123456',
      workflowRunAttempt: '2',
      buildTimestamp: '2026-10-05T00:00:00.000Z',
    });
    assert.notEqual(changed.frontendArtifactSetSha256, canonicalHash);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
