import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CURRENT_PROMPT_BUNDLE } from '../agents/evolution/promptBundle.js';
import {
  buildGepaSubprocessEnv,
  createGepaBridgeInput,
  MAX_BRIDGE_BYTES,
  readBoundedGepaOutput,
  resolveApprovedPythonExecutable,
  runGepaProposalBridge,
  serializeGepaBridgeInput,
  terminateProcessTree,
  validateGepaProposal,
} from '../agents/evolution/gepaBridge.js';
import { createPromptBundle } from '../agents/evolution/promptBundle.js';

const bridgeOptions = {
  basePromptBundle: CURRENT_PROMPT_BUNDLE,
  allowedMutationSurfaces: ['promptBundle.plannerInstruction'],
  trainCases: [{ id: 'train-1', expectedAction: 'bounded', question: 'Use a bounded read-only review.' }],
  validationCases: [{ id: 'validation-1', expectedAction: 'bounded', question: 'Use a bounded read-only review.' }],
  failureFeedback: ['grounding passed; no duplicate evidence call'],
  budget: { maxCandidates: 1, maxMetricCalls: 1 },
  optimizerConfig: { provider: 'fixture' },
  pythonWorkingDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ml-service'),
};

test('GEPA Node/Python bridge runs the deterministic provider and revalidates proposals', async () => {
  const input = createGepaBridgeInput(bridgeOptions);
  assert.equal(input.optimizer.provider, 'fixture');
  assert.equal(input.trainCases[0].partition, 'train');
  assert.equal(input.validationCases[0].partition, 'validation');
  assert.equal(Object.hasOwn(input, 'holdoutCases'), false);

  const proposals = await runGepaProposalBridge(bridgeOptions);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].parentPromptBundleHash, CURRENT_PROMPT_BUNDLE.contentHash);
  assert.equal(proposals[0].promptBundle.metadata.source, 'gepa');
  assert.match(proposals[0].promptBundle.plannerInstruction, /minimum safe read-only/);
});

test('GEPA bridge rejects a caller-selected Python import directory outside the repository ML service', async () => {
  await assert.rejects(
    runGepaProposalBridge({
      ...bridgeOptions,
      pythonWorkingDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    }),
    error => error.code === 'GEPA_BRIDGE_UNTRUSTED_WORKING_DIRECTORY',
  );
});

test('GEPA bridge rejects oversized UTF-8 input before it can be written', () => {
  const input = createGepaBridgeInput({
    ...bridgeOptions,
    trainCases: Array.from({ length: 800 }, (_, index) => ({
      id: `large-case-${index}`,
      question: '₹'.repeat(1000),
    })),
  });
  assert.throws(() => serializeGepaBridgeInput(input), { code: 'GEPA_BRIDGE_INPUT_TOO_LARGE' });
  assert.ok(Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_BRIDGE_BYTES);
});

test('GEPA interpreter resolution ignores a shadow executable in an unapproved PATH directory', async t => {
  let approved;
  let requestedName;
  for (const name of ['python', 'python3', 'py']) {
    try {
      approved = await resolveApprovedPythonExecutable(name);
      requestedName = name;
      break;
    } catch {
      // Try the other standard interpreter names available on this host.
    }
  }
  if (!approved) return t.skip('No Python interpreter is installed in an approved system location');

  const directory = await mkdtemp(path.join(tmpdir(), 'gepa-path-shadow-'));
  try {
    const shadowPath = path.join(directory, process.platform === 'win32' ? `${requestedName}.exe` : requestedName);
    await writeFile(shadowPath, 'malicious shadow executable', 'utf8');
    const sourceEnv = {
      ...process.env,
      PATH: [directory, path.dirname(approved)].join(path.delimiter),
    };
    const resolved = await resolveApprovedPythonExecutable(requestedName, { sourceEnv });
    assert.equal(await realpath(resolved), await realpath(approved));
    assert.notEqual(await realpath(resolved), await realpath(shadowPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('GEPA output is size-checked and a junction escape is rejected before reading outside data', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wealthgenie-gepa-output-'));
  const outputPath = path.join(directory, 'output.json');
  try {
    await writeFile(outputPath, Buffer.alloc(MAX_BRIDGE_BYTES + 1, 0x61));
    await assert.rejects(
      readBoundedGepaOutput({ outputPath, temporaryDirectory: directory }),
      /host-side size limit/i,
    );
    await writeFile(outputPath, '{"verified":true}', 'utf8');
    assert.equal(await readBoundedGepaOutput({ outputPath, temporaryDirectory: directory }), '{"verified":true}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const parent = await mkdtemp(path.join(tmpdir(), 'wealthgenie-gepa-junction-'));
  const invocationDirectory = path.join(parent, 'wealthgenie-gepa-invocation');
  const outsideDirectory = path.join(parent, 'outside');
  const sentinelPath = path.join(outsideDirectory, 'output.json');
  await mkdir(invocationDirectory);
  await mkdir(outsideDirectory);
  await writeFile(sentinelPath, 'outside-sentinel-untouched', 'utf8');
  try {
    await rm(invocationDirectory, { recursive: true, force: true });
    await symlink(outsideDirectory, invocationDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    return t.skip(`Could not create the directory junction fixture: ${error.code || error.message}`);
  }

  try {
    const escapedPath = path.join(invocationDirectory, 'output.json');
    assert.equal(await readFile(escapedPath, 'utf8'), 'outside-sentinel-untouched', 'raw path following reproduces the outside-directory escape');
    await assert.rejects(
      readBoundedGepaOutput({ outputPath: escapedPath, temporaryDirectory: invocationDirectory }),
      /private regular directory|identity changed/i,
    );
    assert.equal(await readFile(sentinelPath, 'utf8'), 'outside-sentinel-untouched');
  } finally {
    await rm(invocationDirectory, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test('GEPA timeout terminates the spawned process tree, including grandchildren', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wealthgenie-gepa-process-tree-'));
  const pidFile = path.join(directory, 'grandchild.pid');
  const childScript = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    `const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));`,
    'setInterval(() => {}, 60000);',
  ].join('\n');
  const child = spawn(process.execPath, ['-e', childScript], {
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });

  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(existsSync(pidFile), true, 'fixture child must start a grandchild');
    const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    await terminateProcessTree(child);
    if (child.exitCode === null && child.signalCode === null) await once(child, 'close');

    const exitDeadline = Date.now() + 5000;
    let alive = true;
    while (alive && Date.now() < exitDeadline) {
      if (process.platform !== 'win32') {
        try {
          const state = readFileSync(`/proc/${grandchildPid}/stat`, 'utf8').split(' ')[2];
          alive = state !== 'Z';
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          alive = false;
        }
      } else {
        try {
          process.kill(grandchildPid, 0);
          alive = true;
        } catch (error) {
          alive = error.code === 'EPERM';
        }
      }
      if (alive) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, `grandchild ${grandchildPid} must not survive GEPA timeout`);
  } finally {
    await terminateProcessTree(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('GEPA bridge rejects private or sealed optimizer inputs', () => {
  assert.throws(() => createGepaBridgeInput({
    ...bridgeOptions,
    trainCases: [{ id: 'train-private', partition: 'train', question: 'email is not allowed' }],
  }), /private|sealed/i);
  assert.throws(() => createGepaBridgeInput({
    ...bridgeOptions,
    validationCases: [{ id: 'holdout', partition: 'holdout', question: 'bounded' }],
  }), /train or validation|holdout/i);
});

test('GEPA declared mutation surface must exactly cover each submitted mutable field', () => {
  const basePromptBundle = createPromptBundle({ bundleId: 'surface-parent', version: '1', plannerInstruction: 'Planner A' });
  assert.throws(() => validateGepaProposal({
    proposalId: 'routing-smuggle',
    parentPromptBundleHash: basePromptBundle.contentHash,
    mutationSurface: ['promptBundle.plannerInstruction'],
    mutationReason: 'attempt to change routing without declaring it',
    plannerInstruction: 'Planner B',
    safeModelRoleRouting: { planner: 'EXPLAINER', synthesis: 'PLANNER' },
  }, { basePromptBundle, allowedMutationSurfaces: ['promptBundle.plannerInstruction', 'safeModelRoleRouting'] }), {
    code: 'EVOLUTION_SURFACE_DELTA_MISMATCH',
  });
});

test('GEPA Python bridge uses a private runtime environment and only the selected provider credential', () => {
  const sourceEnv = {
    PATH: 'C:\\attacker\\shadow-bin;C:\\Program Files\\Python312',
    PYTHONHOME: 'C:\\attacker\\python-home',
    PYTHONSTARTUP: 'C:\\attacker\\startup.py',
    PYTHONINSPECT: '1',
    PYTHONUSERBASE: 'C:\\attacker\\user-base',
    PYTHONPATH: 'C:\\attacker\\modules',
    SystemRoot: 'C:\\Windows',
    HOME: 'C:\\attacker\\home',
    USERPROFILE: 'C:\\attacker\\profile',
    APPDATA: 'C:\\attacker\\appdata',
    LOCALAPPDATA: 'C:\\attacker\\localappdata',
    VIRTUAL_ENV: 'C:\\attacker\\venv',
    TMPDIR: 'C:\\Users\\test\\AppData\\Local\\Temp',
    TEMP: 'C:\\Users\\test\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\test\\AppData\\Local\\Temp',
    AGENT_EVOLUTION_MODEL_API_KEY: 'selected-test-key',
    AWS_SECRET_ACCESS_KEY: 'unrelated-test-secret',
    NVIDIA_API_KEY: 'unrelated-provider-key',
    GIT_ASKPASS: 'C:\\attacker\\git-askpass.exe',
  };
  const fixtureEnv = buildGepaSubprocessEnv({
    provider: 'fixture',
    sourceEnv,
    pythonWorkingDirectory: 'C:\\trusted\\ml-service',
    pythonTempRoot: 'C:\\private\\invocation',
    pythonExecutable: 'C:\\Program Files\\Python312\\python.exe',
  });
  assert.doesNotMatch(fixtureEnv.PATH || '', /attacker/i);
  assert.equal(fixtureEnv.PYTHONHOME, undefined);
  assert.equal(fixtureEnv.PYTHONSTARTUP, undefined);
  assert.equal(fixtureEnv.PYTHONINSPECT, undefined);
  assert.equal(fixtureEnv.PYTHONUSERBASE, undefined);
  assert.equal(fixtureEnv.PYTHONPATH, 'C:\\trusted\\ml-service');
  assert.equal(fixtureEnv.PYTHONNOUSERSITE, '1');
  assert.equal(fixtureEnv.TMPDIR, 'C:\\private\\invocation');
  assert.equal(fixtureEnv.TEMP, 'C:\\private\\invocation');
  assert.equal(fixtureEnv.TMP, 'C:\\private\\invocation');
  assert.equal(fixtureEnv.HOME, undefined);
  assert.equal(fixtureEnv.USERPROFILE, undefined);
  assert.equal(fixtureEnv.APPDATA, undefined);
  assert.equal(fixtureEnv.LOCALAPPDATA, undefined);
  assert.equal(fixtureEnv.VIRTUAL_ENV, undefined);
  assert.equal(fixtureEnv.GIT_ASKPASS, undefined);
  assert.equal(fixtureEnv.AGENT_EVOLUTION_MODEL_API_KEY, undefined);
  assert.equal(fixtureEnv.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(fixtureEnv.NVIDIA_API_KEY, undefined);

  const liveEnv = buildGepaSubprocessEnv({ provider: 'dspy', sourceEnv, pythonWorkingDirectory: 'ml-service' });
  assert.equal(liveEnv.PYTHONHOME, undefined);
  assert.equal(liveEnv.PYTHONNOUSERSITE, '1');
  assert.equal(liveEnv.AGENT_EVOLUTION_MODEL_API_KEY, 'selected-test-key');
  assert.equal(liveEnv.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(liveEnv.NVIDIA_API_KEY, undefined);

  const isolatedEnv = buildGepaSubprocessEnv({
    provider: 'fixture',
    sourceEnv: { PATH: 'safe-path', TEMP: 'different-temp', TMP: 'other-temp' },
    pythonWorkingDirectory: 'ml-service',
    pythonTempRoot: 'bridge-temp-root',
    pythonExecutable: 'C:\\trusted\\python.exe',
  });
  assert.equal(isolatedEnv.TMPDIR, 'bridge-temp-root');
  assert.equal(isolatedEnv.TMPDIR, 'bridge-temp-root');
  assert.equal(isolatedEnv.TEMP, 'bridge-temp-root');
  assert.equal(isolatedEnv.TMP, 'bridge-temp-root');
});
