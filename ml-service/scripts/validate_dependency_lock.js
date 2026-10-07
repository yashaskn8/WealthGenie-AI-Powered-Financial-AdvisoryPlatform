import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'wealthgenie-ml-lock-'));
const uvCacheDirectory = path.join(temporaryDirectory, 'uv-cache');
const exportedRequirements = path.join(temporaryDirectory, 'requirements.txt');
const exportedAgentEvolutionRequirements = path.join(temporaryDirectory, 'requirements-agent-evolution-tests.txt');
const exportedCiAuditRequirements = path.join(temporaryDirectory, 'requirements-ci-audit.txt');

function runUv(args) {
  const result = spawnSync('uv', args, {
    cwd: projectDirectory,
    encoding: 'utf8',
    env: { ...process.env, UV_CACHE_DIR: uvCacheDirectory },
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`uv ${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
}

try {
  runUv(['lock', '--check']);
  runUv([
    'export', '--locked', '--no-dev', '--format', 'requirements.txt', '--emit-index-url',
    '--no-annotate', '--no-header', '--output-file', exportedRequirements,
  ]);
  runUv([
    'export', '--locked', '--only-group', 'agent-evolution-tests', '--format', 'requirements.txt',
    '--no-emit-index-url', '--no-annotate', '--no-header', '--output-file', exportedAgentEvolutionRequirements,
  ]);
  runUv([
    'export', '--locked', '--only-group', 'ci-audit-tools', '--format', 'requirements.txt',
    '--no-emit-index-url', '--no-annotate', '--no-header', '--output-file', exportedCiAuditRequirements,
  ]);
  const checkedIn = readFileSync(path.join(projectDirectory, 'requirements.txt'));
  const regenerated = readFileSync(exportedRequirements);
  if (!checkedIn.equals(regenerated)) {
    throw new Error('requirements.txt is stale; regenerate it with the pinned uv export command.');
  }
  const checkedInAgentEvolution = readFileSync(path.join(projectDirectory, 'requirements-agent-evolution-tests.txt'));
  const regeneratedAgentEvolution = readFileSync(exportedAgentEvolutionRequirements);
  if (!checkedInAgentEvolution.equals(regeneratedAgentEvolution)) {
    throw new Error('requirements-agent-evolution-tests.txt is stale; regenerate it with the pinned uv export command.');
  }
  const checkedInCiAudit = readFileSync(path.join(projectDirectory, 'requirements-ci-audit.txt'));
  const regeneratedCiAudit = readFileSync(exportedCiAuditRequirements);
  if (!checkedInCiAudit.equals(regeneratedCiAudit)) {
    throw new Error('requirements-ci-audit.txt is stale; regenerate it with the pinned uv export command.');
  }
  process.stdout.write('ML dependency lock and hash-verified requirements exports are synchronized.\n');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
