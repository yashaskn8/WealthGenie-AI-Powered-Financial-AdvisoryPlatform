import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validatorPath = path.join(repositoryRoot, 'server/scripts/validate-deployment-config.js');

function withDeploymentFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-deployment-contract-'));
  try {
    fs.cpSync(path.join(repositoryRoot, '.github/workflows'), path.join(root, '.github/workflows'), { recursive: true });
    fs.cpSync(path.join(repositoryRoot, 'k8s'), path.join(root, 'k8s'), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, 'docker-compose.yml'), path.join(root, 'docker-compose.yml'));
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function validate(root) {
  return spawnSync(process.execPath, [validatorPath], {
    encoding: 'utf8',
    env: { ...process.env, WEALTHGENIE_VALIDATION_ROOT: root },
    timeout: 15000,
  });
}

function readYaml(root, relativePath) {
  return parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeYaml(root, relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), stringify(value), 'utf8');
}

test('deployment validator accepts the complete Phase 2 through Phase 5 migration sequence', () => {
  const result = validate(repositoryRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ordered Phase 2\/3\/4\/5 migrations/);
});

test('deployment validator rejects CD application before the Phase 3 migration', () => {
  withDeploymentFixture(root => {
    const workflowPath = '.github/workflows/cd.yml';
    const workflow = readYaml(root, workflowPath);
    workflow.jobs['deploy-and-verify-kind'].steps = workflow.jobs['deploy-and-verify-kind'].steps
      .filter(step => step.name !== 'Run the one-shot Phase 3 ML/RAG state migration');
    writeYaml(root, workflowPath, workflow);

    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Phase 3 ML\/RAG state migration/);
  });
});

test('deployment validator rejects an unsafe Phase 3 migration Job command', () => {
  withDeploymentFixture(root => {
    const jobPath = 'k8s/phase3-state-migration/job.yaml';
    const job = readYaml(root, jobPath);
    job.spec.template.spec.containers[0].command = ['python', 'scripts/other.py'];
    writeYaml(root, jobPath, job);

    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Phase 3 migration Job must run the explicit migration/);
  });
});

test('deployment validator rejects a Phase 3 migration Job in ordinary kustomize resources', () => {
  withDeploymentFixture(root => {
    const kustomizationPath = 'k8s/kustomization.yaml';
    const kustomization = readYaml(root, kustomizationPath);
    kustomization.resources.push('phase3-state-migration/job.yaml');
    writeYaml(root, kustomizationPath, kustomization);

    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /One-shot database migration Jobs/);
  });
});

test('deployment validator rejects Browser application startup before Phase 3 migration', () => {
  withDeploymentFixture(root => {
    const workflowPath = '.github/workflows/ci.yml';
    const workflow = readYaml(root, workflowPath);
    const steps = workflow.jobs['browser-real-dependencies'].steps;
    const migrationIndex = steps.findIndex(step => step.name === 'Migrate Phase 3 ML/RAG shared-state indexes');
    const [migration] = steps.splice(migrationIndex, 1);
    const startIndex = steps.findIndex(step => step.name === 'Start real application services');
    steps.splice(startIndex, 0, migration);
    writeYaml(root, workflowPath, workflow);

    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Browser CI must run all ordered database migrations/);
  });
});

test('deployment validator rejects Browser application startup before Phase 5 runtime migration', () => {
  withDeploymentFixture(root => {
    const workflowPath = '.github/workflows/ci.yml';
    const workflow = readYaml(root, workflowPath);
    const steps = workflow.jobs['browser-real-dependencies'].steps;
    const [migration] = steps.splice(steps.findIndex(step => step.name === 'Migrate Phase 5 durable agent runtime persistence'), 1);
    steps.splice(steps.findIndex(step => step.name === 'Start real application services'), 0, migration);
    writeYaml(root, workflowPath, workflow);

    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Browser CI must run all ordered database migrations/);
  });
});

test('deployment validator rejects Kind application rollout before Phase 5 runtime migration', () => {
  withDeploymentFixture(root => {
    const workflowPath = '.github/workflows/cd.yml';
    const workflow = readYaml(root, workflowPath);
    const steps = workflow.jobs['deploy-and-verify-kind'].steps;
    const [migration] = steps.splice(steps.findIndex(step => step.name === 'Run the one-shot Phase 5 durable agent runtime migration'), 1);
    const applyIndex = steps.findIndex(step => step.name === 'Apply application manifests after database migrations');
    steps.splice(applyIndex + 1, 0, migration);
    writeYaml(root, workflowPath, workflow);

    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Kind CD must wait for all ordered one-shot database migrations/);
  });
});
