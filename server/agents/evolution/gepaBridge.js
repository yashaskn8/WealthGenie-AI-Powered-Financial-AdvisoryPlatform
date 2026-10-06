import { constants as fsConstants } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPromptBundle, verifyPromptBundleHash } from './promptBundle.js';
import { scanPromptBundleSecurity } from './candidateSecurity.js';
import { validateMutationSurfaces } from './evolutionSurfaceRegistry.js';
import { createEvolutionBudget } from './evolutionBudget.js';
import { assertGepaFeedbackSafe } from './feedback.js';

const MAX_BRIDGE_BYTES = 2 * 1024 * 1024;
const PRIVATE_DATA_PATTERN = /email|phone|income|salary|monthlytakehome|bankaccount|password|jwt|rawprofile|userid|user_id|holdout|answerkey|secret|privatekey/i;
const FORBIDDEN_OUTPUT_KEY_PATTERN = /sourcecode|shellcommand|evaluator|holdout|promotionpolicy|reliabilityhardgate|financialengine|taxrules|allocation|authorization|deployment|sandboxpolicy|script|executable|code/i;
const TRUSTED_ML_SERVICE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../../../ml-service');
const MUTABLE_PROPOSAL_FIELDS = Object.freeze({
  plannerInstruction: 'promptBundle.plannerInstruction',
  synthesisInstruction: 'promptBundle.synthesisInstruction',
  evidenceOrderingPolicy: 'evidenceOrderingPolicy',
  contextCompressionPolicy: 'contextCompressionPolicy',
  safeModelRoleRouting: 'safeModelRoleRouting',
});

function pathApiFor(platform) {
  return platform === 'win32' ? win32 : posix;
}

function isWithinDirectory(root, candidate, pathApi = pathApiFor(process.platform)) {
  const relativePath = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${pathApi.sep}`)
      && !pathApi.isAbsolute?.(relativePath));
}

function approvedPythonRoots(sourceEnv, platform) {
  if (platform === 'win32') {
    const roots = [
      sourceEnv.LOCALAPPDATA && win32.join(sourceEnv.LOCALAPPDATA, 'Programs', 'Python'),
      sourceEnv.ProgramFiles,
      sourceEnv['ProgramFiles(x86)'],
      sourceEnv.SystemDrive && win32.join(sourceEnv.SystemDrive, 'hostedtoolcache', 'windows', 'Python'),
      'C:\\hostedtoolcache\\windows\\Python',
      'D:\\a\\_tool\\Python',
      'C:\\Python',
    ].filter(Boolean);
    const launchers = [sourceEnv.SystemRoot && win32.join(sourceEnv.SystemRoot, 'py.exe')].filter(Boolean);
    return { roots, exactFiles: launchers };
  }
  return {
    roots: ['/usr/bin', '/usr/local/bin', '/opt/hostedtoolcache', '/opt/python', '/opt/homebrew/bin'],
    exactFiles: [],
  };
}

export async function resolveApprovedPythonExecutable(pythonExecutable = 'python', { sourceEnv = process.env, platform = process.platform } = {}) {
  const pathApi = pathApiFor(platform);
  const requested = String(pythonExecutable || 'python');
  const requestedName = pathApi.basename(requested).replace(/\.exe$/i, '').toLowerCase();
  if (!['python', 'python3', 'py'].includes(requestedName)) {
    const error = new Error('Only an approved Python interpreter name or absolute path is allowed for the GEPA bridge.');
    error.code = 'GEPA_BRIDGE_PYTHON_NOT_APPROVED';
    throw error;
  }

  const approved = approvedPythonRoots(sourceEnv, platform);
  const requestedIsAbsolute = pathApi.isAbsolute(requested);
  const entries = requestedIsAbsolute
    ? [requested]
    : String(sourceEnv.PATH || sourceEnv.Path || '').split(platform === 'win32' ? ';' : ':')
      .filter(entry => pathApi.isAbsolute(entry));
  const candidates = [];
  for (const entry of entries) {
    const base = requestedIsAbsolute ? entry : pathApi.join(entry, requestedName);
    if (platform === 'win32') candidates.push(requestedIsAbsolute ? base : `${base}.exe`);
    else candidates.push(base);
  }

  for (const candidate of candidates) {
    let canonicalPath;
    try {
      const candidateStat = await lstat(candidate);
      if (candidateStat.isSymbolicLink() && platform === 'win32') continue;
      canonicalPath = await realpath(candidate);
      const canonicalStat = await lstat(canonicalPath);
      if (!canonicalStat.isFile()) continue;
    } catch {
      continue;
    }
    const name = pathApi.basename(canonicalPath).replace(/\.exe$/i, '').toLowerCase();
    if (!/^python(?:3(?:\.\d+)*)?$/.test(name) && name !== 'py') continue;
    const inApprovedRoot = approved.roots.some(root => isWithinDirectory(root, canonicalPath, pathApi))
      || approved.exactFiles.some(file => pathApi.resolve(file).toLowerCase() === pathApi.resolve(canonicalPath).toLowerCase());
    if (!inApprovedRoot) continue;
    return canonicalPath;
  }

  const error = new Error('No Python interpreter under an approved installation directory was found for the GEPA bridge.');
  error.code = 'GEPA_BRIDGE_PYTHON_NOT_APPROVED';
  throw error;
}

export function buildGepaSubprocessEnv({ provider = 'fixture', sourceEnv = process.env, pythonWorkingDirectory, pythonTempRoot, pythonExecutable } = {}) {
  const environment = {};
  if (typeof sourceEnv.SystemRoot === 'string') environment.SystemRoot = sourceEnv.SystemRoot;
  if (typeof sourceEnv.WINDIR === 'string') environment.WINDIR = sourceEnv.WINDIR;
  const safePathEntries = [
    pythonExecutable ? dirname(pythonExecutable) : null,
    sourceEnv.SystemRoot ? join(sourceEnv.SystemRoot, 'System32') : null,
  ].filter(Boolean);
  if (safePathEntries.length > 0) environment.PATH = [...new Set(safePathEntries)].join(process.platform === 'win32' ? ';' : ':');
  if (typeof pythonWorkingDirectory === 'string') environment.PYTHONPATH = pythonWorkingDirectory;
  environment.PYTHONNOUSERSITE = '1';
  if (pythonTempRoot) {
    environment.TMPDIR = pythonTempRoot;
    environment.TEMP = pythonTempRoot;
    environment.TMP = pythonTempRoot;
  }
  if (provider === 'dspy') {
    const modelApiKey = sourceEnv.AGENT_EVOLUTION_MODEL_API_KEY || sourceEnv.DSPY_LM_API_KEY;
    if (modelApiKey) environment.AGENT_EVOLUTION_MODEL_API_KEY = modelApiKey;
  }
  return environment;
}

function assertSafeJsonValue(value, path = 'root') {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length > 12000) throw new Error(`GEPA bridge value too large at ${path}.`);
    if (PRIVATE_DATA_PATTERN.test(value)) throw new Error(`GEPA bridge private/sealed content rejected at ${path}.`);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeJsonValue(child, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_DATA_PATTERN.test(key)) throw new Error(`GEPA bridge private/sealed field rejected at ${path}.${key}.`);
      assertSafeJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Unsupported GEPA bridge value at ${path}.`);
}

function sanitizeCase(caseDefinition, index, expectedPartition) {
  if (!caseDefinition || typeof caseDefinition !== 'object') throw new TypeError(`GEPA case ${index} must be an object.`);
  if (caseDefinition.partition !== undefined && caseDefinition.partition !== expectedPartition) {
    throw new Error(`GEPA case ${index} must be train or validation; holdout-partition rows are not accepted.`);
  }
  const safeCase = {
    id: String(caseDefinition.id || `case-${index + 1}`).slice(0, 160),
    partition: expectedPartition,
    expectedAction: typeof caseDefinition.expectedAction === 'string' ? caseDefinition.expectedAction.slice(0, 160) : null,
    groundingRequired: caseDefinition.groundingRequired === true,
    maxTrajectoryEvents: Number.isInteger(caseDefinition.maxTrajectoryEvents) ? caseDefinition.maxTrajectoryEvents : null,
    question: typeof caseDefinition.question === 'string' ? caseDefinition.question.slice(0, 1000) : null,
    safeSummary: typeof caseDefinition.safeSummary === 'string' ? caseDefinition.safeSummary.slice(0, 2000) : null,
    failureCodes: Array.isArray(caseDefinition.failureCodes)
      ? caseDefinition.failureCodes.filter(item => typeof item === 'string').map(item => item.slice(0, 120)).slice(0, 12)
      : [],
  };
  assertSafeJsonValue(safeCase, `cases[${index}]`);
  return safeCase;
}

export function createGepaBridgeInput({ basePromptBundle, allowedMutationSurfaces, trainCases = [], validationCases = [], failureFeedback = [], budget = {}, optimizerConfig = {} } = {}) {
  verifyPromptBundleHash(basePromptBundle);
  const surfaces = validateMutationSurfaces(allowedMutationSurfaces);
  const safeTrainCases = trainCases.map((item, index) => sanitizeCase(item, index, 'train'));
  const safeValidationCases = validationCases.map((item, index) => sanitizeCase(item, index, 'validation'));
  if (!Array.isArray(failureFeedback) || failureFeedback.length > 100) {
    throw new TypeError('GEPA feedback must be a bounded list of governed evaluation records.');
  }
  const feedbackRecords = failureFeedback.slice(0, 12).map(item => {
    assertGepaFeedbackSafe(item);
    if (item.text.length > 4000) throw new TypeError('Governed GEPA feedback exceeds the bounded text size.');
    return {
      source: item.source,
      evaluationHash: item.evaluationHash,
      contentHash: item.contentHash,
      text: item.text,
    };
  });
  const safeFeedback = feedbackRecords.map(record => record.text);
  const safeOptimizer = {
    provider: optimizerConfig.provider === 'dspy' ? 'dspy' : 'fixture',
    reflectionModel: typeof optimizerConfig.reflectionModel === 'string' ? optimizerConfig.reflectionModel.slice(0, 160) : null,
    taskModel: typeof optimizerConfig.taskModel === 'string' ? optimizerConfig.taskModel.slice(0, 160) : null,
  };
  const hostBudget = createEvolutionBudget(budget);
  const input = {
    schemaVersion: 'gepa-bridge-input-1.0.0',
    basePromptBundle,
    allowedMutationSurfaces: [...surfaces],
    trainCases: safeTrainCases,
    validationCases: safeValidationCases,
    failureFeedback: safeFeedback,
    failureFeedbackProvenance: feedbackRecords.map(({ source, evaluationHash, contentHash }) => ({ source, evaluationHash, contentHash })),
    budget: {
      max_generations: hostBudget.maxGenerations,
      max_candidates: hostBudget.maxCandidates,
      max_reflection_calls: hostBudget.maxReflectionCalls,
      max_metric_calls: hostBudget.maxMetricCalls,
      max_sandbox_runs: hostBudget.maxSandboxRuns,
      max_sandbox_minutes: hostBudget.maxSandboxMinutes,
      max_total_tokens: hostBudget.maxTotalTokens,
    },
    optimizer: safeOptimizer,
  };
  assertSafeJsonValue(input);
  return Object.freeze(input);
}

export function serializeGepaBridgeInput(input) {
  const serialized = JSON.stringify(input);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > MAX_BRIDGE_BYTES) {
    const error = new Error('GEPA bridge input exceeds the host-side size limit.');
    error.code = 'GEPA_BRIDGE_INPUT_TOO_LARGE';
    throw error;
  }
  return serialized;
}

function rejectUnsafeProposalShape(value, path = 'proposal') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => rejectUnsafeProposalShape(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OUTPUT_KEY_PATTERN.test(key) || PRIVATE_DATA_PATTERN.test(key)) {
      throw new Error(`GEPA proposal field rejected at ${path}.${key}.`);
    }
    rejectUnsafeProposalShape(child, `${path}.${key}`);
  }
}

export function validateGepaProposal(rawProposal, { basePromptBundle, allowedMutationSurfaces } = {}) {
  if (!rawProposal || typeof rawProposal !== 'object' || Array.isArray(rawProposal)) throw new TypeError('GEPA proposal must be an object.');
  rejectUnsafeProposalShape(rawProposal);
  const allowedKeys = new Set(['proposalId', 'parentPromptBundleHash', 'mutationSurface', 'mutationReason', 'plannerInstruction', 'synthesisInstruction', 'evidenceOrderingPolicy', 'contextCompressionPolicy', 'safeModelRoleRouting', 'reflectionMetadata', 'optimizerVersion']);
  for (const key of Object.keys(rawProposal)) if (!allowedKeys.has(key)) throw new Error(`Unknown GEPA proposal field: ${key}.`);
  verifyPromptBundleHash(basePromptBundle);
  if (rawProposal.parentPromptBundleHash !== basePromptBundle.contentHash) throw new Error('GEPA proposal parent PromptBundle hash mismatch.');
  const surfaces = validateMutationSurfaces(rawProposal.mutationSurface || []);
  const allowed = new Set(allowedMutationSurfaces);
  if (surfaces.some(surface => !allowed.has(surface))) throw new Error('GEPA proposal exceeds the declared mutation surface.');
  const submittedSurfaces = Object.entries(MUTABLE_PROPOSAL_FIELDS)
    .filter(([field]) => Object.hasOwn(rawProposal, field))
    .map(([, surface]) => surface)
    .sort();
  const declaredSurfaces = [...surfaces].sort();
  if (submittedSurfaces.length !== declaredSurfaces.length
    || submittedSurfaces.some((surface, index) => surface !== declaredSurfaces[index])) {
    const error = new Error('GEPA mutationSurface must exactly match the mutable fields present in the proposal.');
    error.code = 'EVOLUTION_SURFACE_DELTA_MISMATCH';
    throw error;
  }
  const promptBundle = createPromptBundle({
    bundleId: `gepa-${String(rawProposal.proposalId || 'proposal').slice(0, 80)}`,
    version: String(rawProposal.optimizerVersion || 'gepa-candidate-1.0.0').slice(0, 160),
    plannerInstruction: rawProposal.plannerInstruction || basePromptBundle.plannerInstruction,
    synthesisInstruction: rawProposal.synthesisInstruction || basePromptBundle.synthesisInstruction,
    metadata: {
      source: 'gepa',
      proposalId: String(rawProposal.proposalId || '').slice(0, 120),
      reflectionMetadata: rawProposal.reflectionMetadata && typeof rawProposal.reflectionMetadata === 'object' ? rawProposal.reflectionMetadata : {},
    },
  });
  scanPromptBundleSecurity(promptBundle);
  return Object.freeze({
    proposalId: String(rawProposal.proposalId || '').slice(0, 120),
    parentPromptBundleHash: basePromptBundle.contentHash,
    mutationSurface: [...surfaces],
    mutationReason: String(rawProposal.mutationReason || 'GEPA proposal').slice(0, 500),
    promptBundle,
    evidenceOrderingPolicy: rawProposal.evidenceOrderingPolicy,
    contextCompressionPolicy: rawProposal.contextCompressionPolicy,
    safeModelRoleRouting: rawProposal.safeModelRoleRouting,
    reflectionFeedbackHash: rawProposal.reflectionMetadata?.feedbackHash || null,
    optimizerVersion: String(rawProposal.optimizerVersion || 'gepa-candidate-1.0.0').slice(0, 160),
  });
}

function pathEquals(left, right, platform = process.platform) {
  const pathApi = pathApiFor(platform);
  const leftPath = pathApi.resolve(left);
  const rightPath = pathApi.resolve(right);
  return platform === 'win32' ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
}

function sameFileIdentity(left, right) {
  if (left.size !== right.size || left.dev !== right.dev) return false;
  if (left.ino && right.ino) return left.ino === right.ino;
  return left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function samePrivateDirectoryIdentity(directoryPath, initialInfo, initialRealPath) {
  try {
    const currentInfo = await lstat(directoryPath);
    if (!currentInfo.isDirectory() || currentInfo.isSymbolicLink() || !sameFileIdentity(initialInfo, currentInfo)) {
      return false;
    }
    const currentRealPath = await realpath(directoryPath);
    if (!pathEquals(currentRealPath, initialRealPath)) return false;
    return sameFileIdentity(initialInfo, await lstat(currentRealPath));
  } catch {
    return false;
  }
}

export async function readBoundedGepaOutput({ outputPath, temporaryDirectory, maxBytes = MAX_BRIDGE_BYTES } = {}) {
  const expectedOutputPath = resolve(temporaryDirectory, 'output.json');
  if (!pathEquals(outputPath, expectedOutputPath)) throw new Error('GEPA output path is not the expected invocation output file.');

  const rootInfo = await lstat(temporaryDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('GEPA invocation directory is not a private regular directory.');
  const rootRealPath = await realpath(temporaryDirectory);
  if (!sameFileIdentity(rootInfo, await lstat(rootRealPath))) throw new Error('GEPA invocation directory identity changed.');

  const outputInfo = await lstat(expectedOutputPath);
  if (!outputInfo.isFile() || outputInfo.isSymbolicLink()) throw new Error('GEPA output must be a regular file.');
  if (outputInfo.nlink > 1) throw new Error('GEPA output must not be hard-linked.');
  if (outputInfo.size > maxBytes) throw new Error('GEPA output exceeds the host-side size limit.');

  const outputRealPath = await realpath(expectedOutputPath);
  if (!isWithinDirectory(rootRealPath, outputRealPath)
      || !pathEquals(outputRealPath, join(rootRealPath, 'output.json'))
      || !await samePrivateDirectoryIdentity(temporaryDirectory, rootInfo, rootRealPath)) {
    throw new Error('GEPA output resolved outside its invocation directory.');
  }

  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const handle = await open(expectedOutputPath, fsConstants.O_RDONLY | noFollow);
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile() || openedInfo.size > maxBytes || !sameFileIdentity(outputInfo, openedInfo)) {
      throw new Error('GEPA output changed before it could be read.');
    }
    const openedRealPath = await realpath(expectedOutputPath);
    if (!pathEquals(openedRealPath, outputRealPath)
        || !isWithinDirectory(rootRealPath, openedRealPath)
        || !await samePrivateDirectoryIdentity(temporaryDirectory, rootInfo, rootRealPath)) {
      throw new Error('GEPA output identity changed before it could be read.');
    }

    const contents = await handle.readFile();
    if (contents.byteLength > maxBytes) throw new Error('GEPA output exceeds the host-side size limit.');

    const afterInfo = await lstat(expectedOutputPath);
    const afterRealPath = await realpath(expectedOutputPath);
    if (!afterInfo.isFile() || afterInfo.isSymbolicLink() || !sameFileIdentity(outputInfo, afterInfo)
        || !pathEquals(afterRealPath, outputRealPath) || !isWithinDirectory(rootRealPath, afterRealPath)
        || !await samePrivateDirectoryIdentity(temporaryDirectory, rootInfo, rootRealPath)) {
      throw new Error('GEPA output changed while it was being read.');
    }
    return contents.toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') child.kill('SIGKILL');
    }
    return;
  }

  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const taskkillPath = join(systemRoot, 'System32', 'taskkill.exe');
  await new Promise(resolvePromise => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolvePromise();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 5000);
    const killer = spawn(taskkillPath, ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: join(systemRoot, 'System32') },
    });
    killer.once('error', () => {
      child.kill();
      finish();
    });
    killer.once('close', code => {
      if (code !== 0) child.kill();
      finish();
    });
  });
}

async function runPythonBridge({ inputPath, outputPath, provider, pythonExecutable, pythonWorkingDirectory, pythonTempRoot, timeoutMs }) {
  const baseArguments = ['-m', 'agent_evolution.cli', 'run', '--input', inputPath, '--output', outputPath, '--provider', provider];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonExecutable, baseArguments, {
      cwd: pythonWorkingDirectory,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: buildGepaSubprocessEnv({ provider, pythonWorkingDirectory, pythonTempRoot, pythonExecutable }),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    let terminationPromise = null;
    const timer = setTimeout(() => {
      timedOut = true;
      terminationPromise = terminateProcessTree(child);
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-MAX_BRIDGE_BYTES); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-MAX_BRIDGE_BYTES); });
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      clearTimeout(timer);
      Promise.resolve(terminationPromise).then(() => {
        if (timedOut) {
          const error = new Error('GEPA bridge timed out and the child process tree has exited.');
          error.code = 'GEPA_BRIDGE_TIMEOUT';
          rejectPromise(error);
          return;
        }
        if (spawnError) {
          rejectPromise(spawnError);
          return;
        }
        if (code !== 0) {
          const error = new Error(`GEPA bridge failed with exit code ${code}.`);
          error.code = 'GEPA_BRIDGE_FAILED';
          error.stderr = stderr.slice(-4000);
          rejectPromise(error);
          return;
        }
        resolvePromise({ stdout, stderr });
      }, rejectPromise);
    });
  });
}

export async function runGepaProposalBridge({ basePromptBundle, allowedMutationSurfaces, trainCases = [], validationCases = [], failureFeedback = [], budget = {}, optimizerConfig = {}, pythonExecutable = 'python', pythonWorkingDirectory = TRUSTED_ML_SERVICE_DIRECTORY, timeoutMs = 60000 } = {}) {
  let resolvedPythonWorkingDirectory;
  try {
    const [requestedDirectory, trustedDirectory] = await Promise.all([
      realpath(resolve(pythonWorkingDirectory)),
      realpath(TRUSTED_ML_SERVICE_DIRECTORY),
    ]);
    if (requestedDirectory !== trustedDirectory) throw new Error('directory mismatch');
    resolvedPythonWorkingDirectory = trustedDirectory;
  } catch {
    const error = new Error('GEPA bridge Python working directory must be the repository ML service.');
    error.code = 'GEPA_BRIDGE_UNTRUSTED_WORKING_DIRECTORY';
    throw error;
  }
  const input = createGepaBridgeInput({ basePromptBundle, allowedMutationSurfaces, trainCases, validationCases, failureFeedback, budget, optimizerConfig });
  const serializedInput = serializeGepaBridgeInput(input);
  const approvedPythonExecutable = await resolveApprovedPythonExecutable(pythonExecutable);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wealthgenie-gepa-'));
  const privateTemporaryDirectory = await realpath(temporaryDirectory);
  const inputPath = join(privateTemporaryDirectory, 'input.json');
  const outputPath = join(privateTemporaryDirectory, 'output.json');
  try {
    await writeFile(inputPath, serializedInput, { encoding: 'utf8', flag: 'wx' });
    await runPythonBridge({
      inputPath,
      outputPath,
      provider: input.optimizer.provider,
      pythonExecutable: approvedPythonExecutable,
      pythonWorkingDirectory: resolvedPythonWorkingDirectory,
      pythonTempRoot: privateTemporaryDirectory,
      timeoutMs,
    });
    const output = JSON.parse(await readBoundedGepaOutput({ outputPath, temporaryDirectory: privateTemporaryDirectory }));
    if (!Array.isArray(output) || output.length > input.budget.max_candidates) throw new Error('GEPA bridge output must be a bounded proposal array.');
    return Object.freeze(output.map(proposal => validateGepaProposal(proposal, input)));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export { MAX_BRIDGE_BYTES };
