import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '../..');
const WORKFLOW_DIR = path.join(REPOSITORY_ROOT, '.github', 'workflows');
const IMMUTABLE_GITHUB_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@([a-f0-9]{40})$/i;
const IMMUTABLE_DOCKER_ACTION = /^docker:\/\/[^@\s]+@sha256:[a-f0-9]{64}$/i;
const IMMUTABLE_CONTAINER_IMAGE = /^[^@\s]+@sha256:[a-f0-9]{64}$/i;
const LOCAL_BUILD_IMAGE = /^wealthgenie-[a-z0-9-]+(?::[a-z0-9._-]+)?$/i;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build']);

function visit(value, file, location, violations) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, file, `${location}[${index}]`, violations));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const childLocation = location ? `${location}.${key}` : key;
    if (key === 'uses' && typeof child === 'string' && !child.startsWith('./')) {
      if (!IMMUTABLE_GITHUB_ACTION.test(child) && !IMMUTABLE_DOCKER_ACTION.test(child)) {
        violations.push(`${file}:${childLocation} uses mutable or unsupported external reference "${child}"`);
      }
      continue;
    }
    if (['image', 'node_image'].includes(key) && typeof child === 'string'
        && !LOCAL_BUILD_IMAGE.test(child) && !IMMUTABLE_CONTAINER_IMAGE.test(child)) {
      violations.push(`${file}:${childLocation} uses a mutable or unsupported external container image "${child}"`);
      continue;
    }
    visit(child, file, childLocation, violations);
  }
}

function yamlFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) found.push(...yamlFiles(fullPath));
    } else if (/\.ya?ml$/i.test(entry.name)) found.push(fullPath);
  }
  return found;
}

export function validateWorkflowDirectory(directory = WORKFLOW_DIR) {
  const violations = [];
  const files = fs.readdirSync(directory)
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();

  for (const name of files) {
    const fullPath = path.join(directory, name);
    const source = fs.readFileSync(fullPath, 'utf8');
    const document = YAML.parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) {
      violations.push(`${name}: invalid workflow YAML: ${document.errors.map(error => error.message).join('; ')}`);
      continue;
    }
    visit(document.toJS(), name, '', violations);
  }
  return violations;
}

export function validateContainerManifestDirectory(directory) {
  const violations = [];
  for (const fullPath of yamlFiles(directory)) {
    violations.push(...validateContainerManifestFile(fullPath));
  }
  return violations;
}

function validateContainerManifestFile(fullPath) {
  const violations = [];
  const source = fs.readFileSync(fullPath, 'utf8');
  const documents = YAML.parseAllDocuments(source, { uniqueKeys: true });
  const file = path.relative(REPOSITORY_ROOT, fullPath).replaceAll(path.sep, '/');
  for (const document of documents) {
    if (document.errors.length) {
      violations.push(`${file}: invalid container manifest YAML: ${document.errors.map(error => error.message).join('; ')}`);
      continue;
    }
    visit(document.toJS(), file, '', violations);
  }
  return violations;
}

export function validateDockerfileDirectory(directory = REPOSITORY_ROOT) {
  const violations = [];
  const inspect = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) inspect(fullPath);
        continue;
      }
      if (entry.name !== 'Dockerfile' && !entry.name.toLowerCase().endsWith('.dockerfile')) continue;
      const source = fs.readFileSync(fullPath, 'utf8');
      for (const [index, line] of source.split(/\r?\n/).entries()) {
        const match = line.match(/^\s*FROM(?:\s+--platform=\S+)?\s+(\S+)/i);
        if (!match) continue;
        const image = match[1];
        if (image.toLowerCase() !== 'scratch' && !IMMUTABLE_CONTAINER_IMAGE.test(image)) {
          const file = path.relative(directory, fullPath).replaceAll(path.sep, '/');
          violations.push(`${file}:${index + 1} uses an unpinned Docker base image "${image}"`);
        }
      }
    }
  };
  inspect(directory);
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const customDirectory = process.argv[2];
  const violations = [
    ...validateWorkflowDirectory(customDirectory || WORKFLOW_DIR),
    ...(customDirectory ? [] : validateContainerManifestDirectory(path.join(REPOSITORY_ROOT, 'k8s'))),
    ...(customDirectory ? [] : validateContainerManifestFile(path.join(REPOSITORY_ROOT, 'docker-compose.yml'))),
    ...(customDirectory ? [] : validateDockerfileDirectory()),
  ];
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('All external workflow actions, configured container manifests, and Dockerfile base images use immutable references.');
  }
}
