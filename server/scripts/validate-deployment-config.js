import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(process.env.WEALTHGENIE_VALIDATION_ROOT || defaultRoot);
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

const phase4MigrationJobs = docs.filter(item => item.value?.kind === 'Job'
  && item.value?.metadata?.labels?.app === 'wealthgenie-phase4-plan-review-migration');
if (phase4MigrationJobs.length !== 1) throw new Error('Exactly one Phase 4 PlanReview migration Job must be defined');
const phase4Spec = phase4MigrationJobs[0].value.spec;
const phase4Container = phase4Spec.template.spec.containers.find(item => item.name === 'phase4-plan-review-migration');
if (phase4Spec.parallelism !== 1 || phase4Spec.completions !== 1 || phase4Spec.backoffLimit !== 0) {
  throw new Error('Phase 4 PlanReview migration must be a single, non-parallel, fail-closed Job');
}
if (phase4Spec.template.spec.restartPolicy !== 'Never'
    || phase4Container?.image !== 'wealthgenie-server:latest'
    || phase4Container?.command?.join(' ') !== 'node scripts/migratePlanReviewIndexes.js'
    || !phase4Container.env?.some(item => item.name === 'MONGODB_MIGRATION_URI'
      && item.valueFrom?.secretKeyRef?.name === 'wealthgenie-secrets'
      && item.valueFrom?.secretKeyRef?.key === 'MONGODB_URI')) {
  throw new Error('Phase 4 migration Job must run its explicit script with the configured database URI');
}

const phase3MigrationJobs = docs.filter(item => item.value?.kind === 'Job'
  && item.value?.metadata?.labels?.app === 'wealthgenie-phase3-state-migration');
if (phase3MigrationJobs.length !== 1) throw new Error('Exactly one Phase 3 ML/RAG state migration Job must be defined');
const phase3Spec = phase3MigrationJobs[0].value.spec;
const phase3Container = phase3Spec.template.spec.containers.find(item => item.name === 'phase3-state-migration');
if (phase3Spec.parallelism !== 1 || phase3Spec.completions !== 1 || phase3Spec.backoffLimit !== 0) {
  throw new Error('Phase 3 migration must be a single, non-parallel, fail-closed Job');
}
if (phase3Spec.template.spec.restartPolicy !== 'Never'
    || phase3Container?.image !== 'wealthgenie-ml-service:latest'
    || phase3Container?.command?.join(' ') !== 'python scripts/migrate_phase3_state.py'
    || !phase3Container.env?.some(item => item.name === 'MONGODB_URI'
      && item.valueFrom?.secretKeyRef?.name === 'wealthgenie-secrets'
      && item.valueFrom?.secretKeyRef?.key === 'MONGODB_URI')) {
  throw new Error('Phase 3 migration Job must run the explicit migration with the configured database URI');
}

const kustomization = parse(read('k8s/kustomization.yaml'));
if (kustomization.resources?.some(resource => resource.includes('phase2-index-migration')
    || resource.includes('phase3-state-migration')
    || resource.includes('phase4-plan-review-migration'))) {
  throw new Error('One-shot database migration Jobs must only be created by ordered deployment steps');
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
const browserPhase2Migration = namedStep(browserSteps, 'Migrate Phase 2 persistence indexes');
const browserPhase3Migration = namedStep(browserSteps, 'Migrate Phase 3 ML/RAG shared-state indexes');
const browserPhase4Migration = namedStep(browserSteps, 'Migrate Phase 4 PlanReview persistence indexes');
const browserModelActivation = namedStep(browserSteps, 'Verify transactional ML model activation');
const browserArtifactVerification = namedStep(browserSteps, 'Verify trusted serving artifact bundles');
const browserStart = namedStep(browserSteps, 'Start real application services');
if (!(browserMongo.index < browserInstall.index
    && browserInstall.index < browserPhase2Migration.index
    && browserPhase2Migration.index < browserPhase3Migration.index
    && browserPhase3Migration.index < browserPhase4Migration.index
    && browserPhase4Migration.index < browserModelActivation.index
    && browserModelActivation.index < browserArtifactVerification.index
    && browserArtifactVerification.index < browserStart.index)
    || !browserPhase2Migration.step.run?.includes('MONGODB_MIGRATION_URI="$MONGODB_URI" npm run migrate:phase2-indexes --prefix server')
    || browserPhase3Migration.step['working-directory'] !== 'ml-service'
    || !browserPhase3Migration.step.run?.includes('python scripts/migrate_phase3_state.py')
    || !browserPhase4Migration.step.run?.includes('MONGODB_MIGRATION_URI="$MONGODB_URI" npm run migrate:phase4-plan-review-indexes --prefix server')) {
  throw new Error('Browser CI must run both database migrations and artifact checks before starting application services');
}

const cd = parse(read('.github/workflows/cd.yml'));
const cdSteps = cd.jobs?.['deploy-and-verify-kind']?.steps || [];
const dbApply = namedStep(cdSteps, 'Apply database prerequisites');
const secrets = namedStep(cdSteps, 'Inject ephemeral secrets for Kind validation cluster');
const dbReady = namedStep(cdSteps, 'Wait for Database and Redis to be Ready');
const cdPhase2Migration = namedStep(cdSteps, 'Run the one-shot Phase 2 index migration');
const cdPhase3Migration = namedStep(cdSteps, 'Run the one-shot Phase 3 ML/RAG state migration');
const cdPhase4Migration = namedStep(cdSteps, 'Run the one-shot Phase 4 PlanReview persistence migration');
const appApply = namedStep(cdSteps, 'Apply application manifests after database migrations');
const appReady = namedStep(cdSteps, 'Wait for Microservices to be Ready');
if (!(dbApply.index < secrets.index
    && secrets.index < dbReady.index
    && dbReady.index < cdPhase2Migration.index
    && cdPhase2Migration.index < cdPhase3Migration.index
    && cdPhase3Migration.index < cdPhase4Migration.index
    && cdPhase4Migration.index < appApply.index
    && appApply.index < appReady.index)
    || !cdPhase2Migration.step.run?.includes('kubectl create -f k8s/phase2-index-migration/job.yaml')
    || !cdPhase2Migration.step.run?.includes('kubectl wait --for=condition=complete')
    || !cdPhase3Migration.step.run?.includes('kubectl create -f k8s/phase3-state-migration/job.yaml')
    || !cdPhase3Migration.step.run?.includes('kubectl wait --for=condition=complete')
    || !cdPhase4Migration.step.run?.includes('kubectl create -f k8s/phase4-plan-review-migration/job.yaml')
    || !cdPhase4Migration.step.run?.includes('kubectl wait --for=condition=complete')
    || !appApply.step.run?.includes('kubectl apply -k k8s/')) {
  throw new Error('Kind CD must wait for both one-shot database migrations before applying application workloads');
}
console.log(`Validated ${deploymentFiles.length} deployment YAML files, ordered Phase 2/3/4 migrations in browser CI and Kind CD, Compose API/worker separation, and worker probes.`);
