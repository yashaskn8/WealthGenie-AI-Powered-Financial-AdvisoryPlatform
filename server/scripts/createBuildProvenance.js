import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuildProvenance, serializeBuildProvenance } from '../services/buildProvenance.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(SERVER_DIR, '..');
const outputPath = path.resolve(process.env.BUILD_PROVENANCE_OUTPUT || path.join(REPOSITORY_ROOT, 'build', 'provenance.json'));
const manifest = await createBuildProvenance({
  repositoryRoot: REPOSITORY_ROOT,
  frontendArtifactDirectory: path.resolve(process.env.BUILD_FRONTEND_ARTIFACT_DIRECTORY || path.join(REPOSITORY_ROOT, 'reactapp', 'dist')),
  gitCommitSha: process.env.BUILD_GIT_COMMIT_SHA,
  gitTreeSha: process.env.BUILD_GIT_TREE_SHA,
  serverImageIdentity: process.env.BUILD_SERVER_IMAGE_ID || null,
  frontendImageIdentity: process.env.BUILD_FRONTEND_IMAGE_ID || null,
  mlImageIdentity: process.env.BUILD_ML_IMAGE_ID || null,
  workflowRunId: process.env.BUILD_WORKFLOW_RUN_ID || null,
  workflowRunAttempt: process.env.BUILD_WORKFLOW_RUN_ATTEMPT || null,
  buildTimestamp: process.env.BUILD_TIMESTAMP || null,
});
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, serializeBuildProvenance(manifest), { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  provenanceSha256: manifest.provenanceSha256,
  frontendArtifactSetSha256: manifest.frontendArtifactSetSha256,
  gitCommitSha: manifest.gitCommitSha,
  gitTreeSha: manifest.gitTreeSha,
  serverImageIdentity: manifest.serverImageIdentity,
  frontendImageIdentity: manifest.frontendImageIdentity,
  mlImageIdentity: manifest.mlImageIdentity,
})}\n`);
