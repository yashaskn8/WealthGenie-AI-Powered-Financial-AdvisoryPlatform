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
console.log(`Validated ${deploymentFiles.length} deployment YAML files, Compose API/worker separation, and worker probes.`);
