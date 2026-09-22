import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createPromptBundle, verifyPromptBundleHash } from './promptBundle.js';
import { scanPromptBundleSecurity } from './candidateSecurity.js';
import { validateMutationSurfaces } from './evolutionSurfaceRegistry.js';
import { createEvolutionBudget } from './evolutionBudget.js';

const MAX_BRIDGE_BYTES = 2 * 1024 * 1024;
const PRIVATE_DATA_PATTERN = /email|phone|income|salary|monthlytakehome|bankaccount|password|jwt|rawprofile|userid|user_id|holdout|answerkey|secret|privatekey/i;
const FORBIDDEN_OUTPUT_KEY_PATTERN = /sourcecode|shellcommand|evaluator|holdout|promotionpolicy|reliabilityhardgate|financialengine|taxrules|allocation|authorization|deployment|sandboxpolicy|script|executable|code/i;
const SAFE_PYTHON_EXECUTABLE = /^(?:python|python3|py)(?:\.exe)?$/i;

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
    throw new Error(`GEPA case ${index} must be train or validation; holdout is sealed.`);
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
  const safeFeedback = failureFeedback.map((item, index) => {
    const value = typeof item === 'string' ? item : JSON.stringify(item);
    assertSafeJsonValue(value, `failureFeedback[${index}]`);
    return value.slice(0, 4000);
  }).slice(0, 100);
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

async function runPythonBridge({ inputPath, outputPath, provider, pythonExecutable, pythonWorkingDirectory, timeoutMs }) {
  if (!SAFE_PYTHON_EXECUTABLE.test(pythonExecutable)) throw new Error('Only the python/python3/py executables are allowed for the GEPA bridge.');
  const baseArguments = ['-m', 'agent_evolution.cli', 'run', '--input', inputPath, '--output', outputPath, '--provider', provider];
  const invocations = [{ executable: pythonExecutable, arguments: baseArguments }];
  if (process.platform === 'win32' && pythonExecutable.toLowerCase() === 'python') {
    invocations.push({ executable: 'py', arguments: ['-3', ...baseArguments] });
  }
  const executeInvocation = invocation => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: pythonWorkingDirectory,
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONPATH: pythonWorkingDirectory },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error('GEPA bridge timed out.');
      error.code = 'GEPA_BRIDGE_TIMEOUT';
      rejectPromise(error);
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-MAX_BRIDGE_BYTES); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-MAX_BRIDGE_BYTES); });
    child.on('error', error => { clearTimeout(timer); rejectPromise(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`GEPA bridge failed with exit code ${code}.`);
        error.code = 'GEPA_BRIDGE_FAILED';
        error.stderr = stderr.slice(-4000);
        rejectPromise(error);
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
  for (let index = 0; index < invocations.length; index += 1) {
    try {
      return await executeInvocation(invocations[index]);
    } catch (error) {
      if (error?.code === 'ENOENT' && index < invocations.length - 1) continue;
      throw error;
    }
  }
  throw new Error('No approved Python executable was available for the GEPA bridge.');
}

export async function runGepaProposalBridge({ basePromptBundle, allowedMutationSurfaces, trainCases = [], validationCases = [], failureFeedback = [], budget = {}, optimizerConfig = {}, pythonExecutable = 'python', pythonWorkingDirectory = resolve(process.cwd(), 'ml-service'), timeoutMs = 60000 } = {}) {
  const input = createGepaBridgeInput({ basePromptBundle, allowedMutationSurfaces, trainCases, validationCases, failureFeedback, budget, optimizerConfig });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wealthgenie-gepa-'));
  const inputPath = join(temporaryDirectory, 'input.json');
  const outputPath = join(temporaryDirectory, 'output.json');
  try {
    await writeFile(inputPath, JSON.stringify(input), { encoding: 'utf8', flag: 'wx' });
    await runPythonBridge({ inputPath, outputPath, provider: input.optimizer.provider, pythonExecutable, pythonWorkingDirectory, timeoutMs });
    const output = JSON.parse(await readFile(outputPath, { encoding: 'utf8' }));
    if (!Array.isArray(output) || output.length > input.budget.max_candidates) throw new Error('GEPA bridge output must be a bounded proposal array.');
    return Object.freeze(output.map(proposal => validateGepaProposal(proposal, input)));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export { MAX_BRIDGE_BYTES };
