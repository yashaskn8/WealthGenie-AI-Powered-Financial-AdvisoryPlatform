import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compose = parse(read('docker-compose.yml'));
if (!compose.services?.server || !compose.services?.['agent-worker']) throw new Error('Compose must define server and agent-worker services');
if (compose.services.server.environment?.includes?.('AGENT_WORKER_ENABLED=false') !== true) throw new Error('Compose API must disable embedded workers');
if (compose.services['agent-worker'].command?.join(' ') !== 'node worker.js') throw new Error('Compose agent-worker must run node worker.js');

const deploymentFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) deploymentFiles.push(full);
  }
}
walk(path.join(root, 'k8s'));
const docs = deploymentFiles.map(file => ({ file, value: parse(fs.readFileSync(file, 'utf8')) }));
const worker = docs.find(item => item.value?.kind === 'Deployment' && item.value?.metadata?.name === 'wealthgenie-agent-worker');
if (!worker) throw new Error('Kubernetes agent-worker Deployment is missing');
const container = worker.value.spec.template.spec.containers.find(item => item.name === 'agent-worker');
if (!container || container.command?.join(' ') !== 'node worker.js') throw new Error('Kubernetes agent-worker command is invalid');
if (!container.readinessProbe?.httpGet?.path || !container.livenessProbe?.httpGet?.path) throw new Error('Kubernetes agent-worker probes are required');

const migration = docs.find(item => item.value?.kind === 'Job'
  && item.value?.metadata?.labels?.app === 'wealthgenie-phase2-index-migration');
if (!migration) throw new Error('The one-shot Phase 2 index migration Job is missing');
const migrationSpec = migration.value.spec;
const migrationContainer = migrationSpec.template.spec.containers.find(item => item.name === 'phase2-index-migration');
if (migrationSpec.parallelism !== 1 || migrationSpec.completions !== 1 || migrationSpec.backoffLimit !== 0) {
  throw new Error('Phase 2 index migration must be a single, non-parallel, fail-closed Job');
}
if (migrationSpec.template.spec.restartPolicy !== 'Never'
    || migrationContainer?.image !== 'wealthgenie-server:latest'
    || migrationContainer?.command?.join(' ') !== 'node scripts/migratePhase2Indexes.js'
    || !migrationContainer.env?.some(item => item.name === 'MONGODB_MIGRATION_URI'
      && item.valueFrom?.secretKeyRef?.name === 'wealthgenie-secrets'
      && item.valueFrom?.secretKeyRef?.key === 'MONGODB_URI')) {
  throw new Error('Phase 2 migration Job must run the explicit script with the configured database URI');
}

const kustomization = parse(read('k8s/kustomization.yaml'));
if (kustomization.resources?.some(resource => resource.includes('phase2-index-migration'))) {
  throw new Error('One-shot migration Job must only be created by the ordered deployment step');
}

function namedStep(steps, name) {
  const index = steps.findIndex(step => step.name === name);
  if (index < 0) throw new Error(`Required deployment step is missing: ${name}`);
  return { index, step: steps[index] };
}

const ci = parse(read('.github/workflows/ci.yml'));
const browserSteps = ci.jobs?.['browser-real-dependencies']?.steps || [];
const browserMongo = namedStep(browserSteps, 'Start transaction-capable MongoDB');
const browserInstall = namedStep(browserSteps, 'Install application and browser dependencies');
const browserMigration = namedStep(browserSteps, 'Migrate Phase 2 persistence indexes');
const browserStart = namedStep(browserSteps, 'Start real application services');
if (!(browserMongo.index < browserInstall.index
    && browserInstall.index < browserMigration.index
    && browserMigration.index < browserStart.index)
    || !browserMigration.step.run?.includes('MONGODB_MIGRATION_URI="$MONGODB_URI" npm run migrate:phase2-indexes --prefix server')) {
  throw new Error('Browser CI must migrate indexes after Mongo/dependency setup and before starting Express');
}

const cd = parse(read('.github/workflows/cd.yml'));
const cdSteps = cd.jobs?.['deploy-and-verify-kind']?.steps || [];
const dbApply = namedStep(cdSteps, 'Apply database prerequisites');
const secrets = namedStep(cdSteps, 'Inject ephemeral secrets for Kind validation cluster');
const dbReady = namedStep(cdSteps, 'Wait for Database and Redis to be Ready');
const cdMigration = namedStep(cdSteps, 'Run the one-shot Phase 2 index migration');
const appApply = namedStep(cdSteps, 'Apply application manifests after index migration');
const appReady = namedStep(cdSteps, 'Wait for Microservices to be Ready');
if (!(dbApply.index < secrets.index
    && secrets.index < dbReady.index
    && dbReady.index < cdMigration.index
    && cdMigration.index < appApply.index
    && appApply.index < appReady.index)
    || !cdMigration.step.run?.includes('kubectl create -f k8s/phase2-index-migration/job.yaml')
    || !cdMigration.step.run?.includes('kubectl wait --for=condition=complete')
    || !appApply.step.run?.includes('kubectl apply -k k8s/')) {
  throw new Error('Kind CD must wait for the one-shot index migration before applying API workloads');
}
console.log(`Validated ${deploymentFiles.length} deployment YAML files, ordered Phase 2 index migration, Compose API/worker separation, and worker probes.`);
