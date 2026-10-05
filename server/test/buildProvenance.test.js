import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProvenanceMatches,
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
