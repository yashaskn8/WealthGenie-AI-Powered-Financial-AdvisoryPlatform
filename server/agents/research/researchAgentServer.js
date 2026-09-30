import crypto from 'node:crypto';
import http from 'node:http';
import mongoose from 'mongoose';
import express from 'express';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { AgentCard, Role, TaskState } from '@a2a-js/sdk';
import { RestContentTypeNotSupportedError } from '@a2a-js/sdk/errors';
import { agentCardHandler, restHandler } from '@a2a-js/sdk/server/express';
import {
  DefaultRequestHandler,
  AgentEvent,
  InMemoryTaskStore,
  defaultServerCallContextBuilder,
} from '@a2a-js/sdk/server';
import { generateAgentCardSignature } from '@a2a-js/sdk';
import { assertAgentCapability } from '../identity/agentIdentity.js';
import { createAgentIdentityVerifier } from '../identity/agentIdentityVerifier.js';
import { createResearchSearchProvider } from './researchSearchProvider.js';
import { SafePublicDocumentFetcher } from './safePublicDocumentFetcher.js';
import { runResearch } from './researchLoop.js';
import { buildResearchArtifact } from './researchArtifact.js';
import { verifyResearchArtifact } from './researchClaimVerifier.js';
import { validateResearchBrief } from './researchSchemas.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { RESEARCH_CAPABILITIES, RESEARCH_FORBIDDEN_CAPABILITIES, stableResearchId } from './researchConstants.js';
import connectDB from '../../config/db.js';
import { MongoResearchTaskStore } from '../../services/researchTaskStore.js';
import { verifyResearchTaskIndexes } from '../../services/researchTaskPersistence.js';
import { researchAgentMaxActiveTasks } from '../../services/researchTaskCapacity.js';

const RESEARCH_AGENT_TYPE = 'FINANCIAL_RESEARCH';
const REQUIRED_CALLER_TYPE = 'PLAN_REVIEW';
const RESEARCH_INPUT_MEDIA_TYPES = new Set(['application/json', 'text/plain']);

function configError(message) {
  const error = new Error(message);
  error.code = 'RESEARCH_AGENT_CONFIGURATION_INVALID';
  error.status = 503;
  return error;
}

function parsePublicBaseUrl(value, { production = false } = {}) {
  let parsed;
  try { parsed = new URL(value); } catch { throw configError('ResearchAgent public URL is invalid.'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash
      || (production && parsed.protocol !== 'https:')
      || (!production && !['http:', 'https:'].includes(parsed.protocol))) {
    throw configError('ResearchAgent public URL must be a credential-free HTTP(S) URL and HTTPS in production.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function validateProductionIdentityConfiguration(env) {
  const provider = String(env.AGENT_IDENTITY_PROVIDER || 'development').toLowerCase();
  if (provider !== 'oidc') throw configError('Production ResearchAgent requires OIDC; bearer/SPIFFE verification is not configured for this endpoint.');
  if (!env.AGENT_OIDC_ISSUER || !env.AGENT_OIDC_AUDIENCE
      || (!env.AGENT_OIDC_PUBLIC_KEY && !env.AGENT_OIDC_JWKS_URL)
      || !env.AGENT_OIDC_SUBJECT_MAP) {
    throw configError('Production ResearchAgent OIDC issuer, audience, verification key, and subject map are required.');
  }
  if (env.AGENT_OIDC_JWKS_URL) {
    let jwks;
    try { jwks = new URL(env.AGENT_OIDC_JWKS_URL); } catch { throw configError('Production OIDC JWKS URL is invalid.'); }
    if (jwks.protocol !== 'https:' || jwks.username || jwks.password || jwks.hash) throw configError('Production OIDC JWKS URL must be credential-free HTTPS.');
  }
  const algorithms = String(env.AGENT_OIDC_ALGORITHMS || 'RS256,ES256').split(',').map(value => value.trim()).filter(Boolean);
  if (!algorithms.length || algorithms.some(algorithm => !['RS256', 'ES256'].includes(algorithm))) {
    throw configError('Production OIDC algorithms must be restricted to RS256 and/or ES256.');
  }
  let subjects;
  try { subjects = JSON.parse(env.AGENT_OIDC_SUBJECT_MAP); } catch { throw configError('Production OIDC subject map is invalid JSON.'); }
  if (!subjects || Array.isArray(subjects) || typeof subjects !== 'object'
      || !Object.values(subjects).some(agentType => String(agentType).toUpperCase() === REQUIRED_CALLER_TYPE)) {
    throw configError('Production OIDC subject map must explicitly map an identity to PLAN_REVIEW.');
  }
}

function timingSafeTokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function bearerToken(req) {
  const value = req.get('authorization');
  if (typeof value !== 'string' || !/^Bearer\s+\S+$/i.test(value)) return null;
  return value.replace(/^Bearer\s+/i, '').trim();
}

function verifiedUser(identity) {
  return {
    identity,
    get isAuthenticated() { return true; },
    get userName() { return identity.subject; },
  };
}

async function buildAuthenticatedUser(req, { env, verifier }) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Authenticated A2A caller required.');
    error.code = 'A2A_AUTH_REQUIRED';
    error.status = 401;
    throw error;
  }
  if (String(env.AGENT_IDENTITY_PROVIDER || 'development').toLowerCase() === 'development'
    && !timingSafeTokenMatches(token, env.AGENT_A2A_DEV_TOKEN)) {
    const error = new Error('A2A caller authentication failed.');
    error.code = 'A2A_AUTH_INVALID';
    error.status = 401;
    throw error;
  }
  const identity = await verifier.verify({ token, agentType: REQUIRED_CALLER_TYPE });
  assertAgentCapability(identity, 'invoke:financial_research');
  return verifiedUser(identity);
}

function createAgentCard({ baseUrl }) {
  return AgentCard.fromJSON({
    name: 'WealthGenie Financial Research Agent',
    description: 'Read-only public financial and regulatory evidence research. It never receives private financial profiles or mutation authority.',
    supportedInterfaces: [{
      url: `${baseUrl.replace(/\/$/, '')}/a2a`,
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
    }],
    provider: { organization: 'WealthGenie', url: 'https://github.com/yashaskn8/WealthGenie-Architecture-Restoration' },
    version: '1.0.0',
    documentationUrl: `${baseUrl.replace(/\/$/, '')}/.well-known/agent-card.json`,
    capabilities: { streaming: false, pushNotifications: false, extensions: [] },
    securitySchemes: {
      bearerAuth: {
        httpAuthSecurityScheme: {
          description: 'Authenticated PlanReview agent identity.',
          scheme: 'Bearer',
          bearerFormat: 'OIDC or explicitly configured development token',
        },
      },
    },
    securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }],
    defaultInputModes: [...RESEARCH_INPUT_MEDIA_TYPES],
    defaultOutputModes: ['application/json'],
    skills: [{
      id: 'research_public_financial_evidence',
      name: 'Research public financial evidence',
      description: 'Retrieve and verify bounded public financial or regulatory evidence and emit claim-level provenance.',
      tags: ['public evidence', 'financial research', 'regulatory research'],
      examples: ['Verify a current public RBI or SEBI fact.'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
      securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }],
    }],
    signatures: [],
  });
}

async function signAgentCard(card, { env, baseUrl }) {
  if (env.AGENT_A2A_CARD_SIGNING_ENABLED !== 'true') return { card, jwks: null, signing: null };
  let privateKey;
  if (env.AGENT_A2A_CARD_SIGNING_PRIVATE_KEY) {
    privateKey = crypto.createPrivateKey(String(env.AGENT_A2A_CARD_SIGNING_PRIVATE_KEY).replace(/\\n/g, '\n'));
  } else if (env.NODE_ENV === 'production') {
    throw configError('Production card signing requires AGENT_A2A_CARD_SIGNING_PRIVATE_KEY.');
  } else {
    privateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const kid = String(env.AGENT_A2A_CARD_SIGNING_KEY_ID || 'wealthgenie-research-dev-key');
  const jku = `${baseUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
  const signer = generateAgentCardSignature(privateKey, { alg: 'RS256', kid, typ: 'JOSE', jku });
  const signedCard = await signer(card);
  return {
    card: signedCard,
    jwks: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] },
    signing: { kid, jku },
  };
}

function dataFromMessage(message) {
  const part = message?.parts?.find(item => item?.content?.$case === 'data' || item?.content?.$case === 'json');
  return part?.content?.value || null;
}

function statusEvent(taskId, contextId, state, text = null) {
  return AgentEvent.statusUpdate({
    taskId,
    contextId,
    status: {
      state,
      message: text ? {
        messageId: crypto.randomUUID(),
        contextId,
        taskId,
        role: Role.ROLE_AGENT,
        parts: [{ content: { $case: 'text', value: text }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      } : undefined,
      timestamp: new Date().toISOString(),
    },
    metadata: undefined,
  });
}

function initialTask(requestContext) {
  return requestContext.task || {
    id: requestContext.taskId,
    contextId: requestContext.contextId,
    status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString() },
    artifacts: [],
    history: [requestContext.userMessage],
    metadata: { agentType: RESEARCH_AGENT_TYPE },
  };
}

function mergeArtifactsById(existing = [], incoming = []) {
  const merged = new Map();
  for (const artifact of existing) if (artifact?.artifactId) merged.set(artifact.artifactId, structuredClone(artifact));
  for (const artifact of incoming) if (artifact?.artifactId) merged.set(artifact.artifactId, structuredClone(artifact));
  return [...merged.values()];
}

function messageResearchBrief(message) {
  const part = message?.parts?.find(item => ['data', 'json'].includes(item?.content?.$case));
  return part?.content?.value || null;
}

function researchArtifactFromTask(task) {
  return task?.artifacts?.flatMap(artifact => artifact.parts || [])
    .find(part => part?.content?.$case === 'data')?.content?.value || null;
}

function buildSemanticReplayArtifact({ sourceTask, targetTask }) {
  const sourceMessage = sourceTask.history?.find(message => message?.role === Role.ROLE_USER);
  const sourceBriefResult = validateResearchBrief(messageResearchBrief(sourceMessage));
  const targetMessage = targetTask.history?.find(message => message?.role === Role.ROLE_USER);
  const targetBriefResult = validateResearchBrief(messageResearchBrief(targetMessage));
  const sourceArtifact = researchArtifactFromTask(sourceTask);
  if (sourceBriefResult.error || targetBriefResult.error || !sourceArtifact
      || sourceArtifact.taskId !== sourceTask.id
      || !verifyResearchArtifact(sourceArtifact, { brief: sourceBriefResult.value }).valid) return null;

  const source = sourceArtifact;
  const artifact = buildResearchArtifact({
    brief: targetBriefResult.value,
    taskId: targetTask.id,
    artifactId: stableResearchId('A', targetTask.id),
    status: source.status,
    claims: structuredClone(source.claims),
    evidenceUnits: structuredClone(source.evidenceUnits),
    sources: structuredClone(source.sources),
    contradictions: structuredClone(source.contradictions),
    unresolvedGaps: structuredClone(source.unresolvedGaps),
    researchBudgetUsed: structuredClone(source.researchBudgetUsed),
    queryCount: source.queryCount,
    documentCount: source.documentCount,
    modelCalls: source.modelCalls,
    tokenUsage: source.tokenUsage,
    durationMs: source.durationMs,
    parentArtifactId: source.artifactId,
  });
  return verifyResearchArtifact(artifact, { brief: targetBriefResult.value }).valid ? artifact : null;
}

function enforceHttpJsonContract(req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = body => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return sendJson(body);
  };

  const contentType = req.get('content-type');
  const hasRequestBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
  if (hasRequestBody && contentType) {
    const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json' && mediaType !== 'application/a2a+json') {
      const message = `Unsupported Content-Type "${contentType}"; expected application/json or application/a2a+json.`;
      return res.status(415).json({
        error: {
          code: 415,
          status: 'INVALID_ARGUMENT',
          message,
          details: [{
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'CONTENT_TYPE_NOT_SUPPORTED',
            domain: 'a2a-protocol.org',
          }],
        },
      });
    }
  }
  return next();
}

function validateResearchInputMediaTypes(message) {
  for (const part of message?.parts || []) {
    const mediaType = String(part?.mediaType || '').split(';', 1)[0].trim().toLowerCase();
    if (!mediaType || RESEARCH_INPUT_MEDIA_TYPES.has(mediaType)) continue;
    throw new RestContentTypeNotSupportedError({
      message: `Unsupported input media type "${mediaType}"; supported input media types are application/json and text/plain.`,
    });
  }
}

class ResearchAgentRequestHandler extends DefaultRequestHandler {
  async sendMessage(params, context) {
    validateResearchInputMediaTypes(params?.message);
    return super.sendMessage(params, context);
  }
}

export class ResearchAgentExecutor {
  constructor({ run, provider, documentFetcher, taskStore, budget, activeTasks = new Map(), taskContexts = new Map() } = {}) {
    this.run = run;
    this.provider = provider;
    this.documentFetcher = documentFetcher;
    this.taskStore = taskStore;
    this.budget = budget;
    this.activeTasks = activeTasks;
    this.taskContexts = taskContexts;
    this.canceledTasks = new Set();
    this.inFlight = new Map();
    this.recoveryTimer = null;
    this.recoveryTickRunning = false;
  }

  async execute(requestContext, eventBus) {
    const taskId = requestContext.taskId;
    const existingExecution = this.inFlight.get(taskId);
    if (existingExecution) {
      await existingExecution;
      return;
    }
    const execution = this.executeRequest(requestContext, eventBus);
    this.inFlight.set(taskId, execution);
    try { await execution; } finally {
      if (this.inFlight.get(taskId) === execution) this.inFlight.delete(taskId);
    }
  }

  async executeRequest(requestContext, eventBus) {
    const identity = requestContext.context.user?.identity;
    if (identity?.agentType !== REQUIRED_CALLER_TYPE) throw Object.assign(new Error('A2A caller identity is not allowed.'), { code: 'A2A_CALLER_IDENTITY_DENIED' });
    const taskId = requestContext.taskId;
    let task = requestContext.task || initialTask(requestContext);
    let lease = null;
    if (this.taskStore?.durable) {
      let claim;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        claim = await this.taskStore.prepareAndClaim(task, requestContext.context, {
          messageId: requestContext.userMessage?.messageId,
          allowSemanticDeduplication: !requestContext.task,
        });
        if (!claim?.semanticDuplicateTaskId) break;
        const replayTask = await this.replaySemanticDuplicate({
          task,
          context: requestContext.context,
          sourceTaskId: claim.semanticDuplicateTaskId,
          requestFingerprint: claim.requestFingerprint,
        });
        if (replayTask) {
          eventBus.publish(AgentEvent.task(replayTask));
          eventBus.publish(AgentEvent.statusUpdate({ taskId: replayTask.id, contextId: replayTask.contextId, status: replayTask.status, metadata: undefined }));
          return;
        }
      }
      if (claim?.semanticDuplicateTaskId) {
        throw Object.assign(new Error('Research task semantic deduplication is contended; retry the request.'), { code: 'A2A_TASK_DEDUPLICATION_CONTENTION', status: 409 });
      }
      if (!claim) {
        task = await this.waitForTerminalTask(taskId, requestContext.context);
        eventBus.publish(AgentEvent.task(task));
        eventBus.publish(AgentEvent.statusUpdate({ taskId, contextId: task.contextId, status: task.status, metadata: undefined }));
        return;
      }
      if (claim.capacityUnavailable) {
        task = claim.task;
        eventBus.publish(AgentEvent.task(task));
        eventBus.publish(AgentEvent.statusUpdate({ taskId, contextId: task.contextId, status: task.status, metadata: undefined }));
        return;
      }
      task = claim.task;
      lease = claim.lease;
    }
    const userMessage = task.history?.find(message => message.messageId === lease?.messageId)
      || requestContext.userMessage;
    await this.runClaimedTask({ task, userMessage, lease, requestContext, eventBus, recovery: false });
  }

  async replaySemanticDuplicate({ task, context, sourceTaskId, requestFingerprint }) {
    const sourceTask = await this.waitForTerminalTask(sourceTaskId, context);
    if (sourceTask.status?.state === TaskState.TASK_STATE_COMPLETED) {
      const artifact = buildSemanticReplayArtifact({ sourceTask, targetTask: task });
      if (artifact) {
        const replayTask = structuredClone(task);
        replayTask.artifacts = mergeArtifactsById(replayTask.artifacts, [{
          artifactId: artifact.artifactId,
          name: 'ResearchArtifact',
          description: 'Verified public research artifact reused for a semantically identical brief.',
          parts: [{ content: { $case: 'data', value: artifact }, metadata: undefined, filename: '', mediaType: 'application/json' }],
          metadata: { financialAuthorityDelta: 0, deduplicatedFromTaskId: sourceTaskId },
          extensions: [],
        }]);
        replayTask.status = statusEvent(task.id, task.contextId, TaskState.TASK_STATE_COMPLETED, 'Verified research evidence reused for an identical brief.').data.status;
        const persisted = await this.taskStore.createSemanticReplay({
          task: replayTask,
          context,
          sourceTaskId,
          requestFingerprint,
        });
        if (persisted) return persisted;
      }
    }
    await this.taskStore.retireSemanticDeduplication(sourceTaskId, context, requestFingerprint);
    return null;
  }

  async waitForTerminalTask(taskId, context) {
    let delayMs = 100;
    for (;;) {
      const task = await this.taskStore.load(taskId, context);
      if (!task) throw Object.assign(new Error('Research task disappeared while waiting for its owner.'), { code: 'A2A_TASK_STATE_UNAVAILABLE', status: 503 });
      if ([TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_COMPLETED].includes(task.status?.state)) return task;
      await new Promise(resolveDelay => setTimeout(resolveDelay, delayMs));
      delayMs = Math.min(delayMs * 2, 1_000);
    }
  }

  async runClaimedTask({ task, userMessage, lease, requestContext = null, eventBus = null, recovery = false }) {
    const taskId = task.id;
    const contextId = task.contextId;
    const context = requestContext?.context;
    const controller = new AbortController();
    this.activeTasks.set(taskId, controller);
    this.taskContexts.set(taskId, contextId);
    let heartbeat = null;
    let heartbeatRunning = false;
    const durableLease = Boolean(lease && this.taskStore?.durable);
    const leaseMs = this.taskStore?.leaseMs || 30_000;
    const heartbeatIntervalMs = Math.max(250, Math.floor(leaseMs / 3));
    try {
      // The A2A request handler needs the Task event to establish task context
      // even when the domain input is rejected. Publish the submitted Task
      // before validation so fail-closed input errors become a terminal FAILED
      // Task response instead of an unassociated transport error.
      if (!recovery) eventBus.publish(AgentEvent.task(task));
      if (!userMessage || !dataFromMessage(userMessage)) {
        throw Object.assign(new Error('Research task has no valid persisted input.'), { code: 'A2A_TASK_RECOVERY_INPUT_UNAVAILABLE' });
      }
      PrometheusMetrics.inc('research_a2a_tasks_total');
      const workingStatus = statusEvent(taskId, contextId, TaskState.TASK_STATE_WORKING, 'Research is running within the configured safety budget.').data.status;
      if (recovery) {
        task.status = workingStatus;
        await this.taskStore.saveClaimed(task, lease);
      } else {
        eventBus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: workingStatus, metadata: undefined }));
      }
      if (durableLease) {
        heartbeat = setInterval(async () => {
          if (heartbeatRunning || controller.signal.aborted) return;
          heartbeatRunning = true;
          try {
            const renewed = recovery
              ? await this.taskStore.renewClaimedExecutionLease(taskId, lease)
              : await this.taskStore.renewExecutionLease(taskId, context, lease);
            if (!renewed) {
              this.taskStore.forgetExecutionLease?.(taskId, lease);
              controller.abort(Object.assign(new Error('Research task execution lease was superseded.'), { code: 'A2A_TASK_EXECUTION_LEASE_LOST' }));
            }
          } catch {
            this.taskStore.forgetExecutionLease?.(taskId, lease);
            controller.abort(Object.assign(new Error('Research task execution lease is unavailable.'), { code: 'A2A_TASK_STORE_UNAVAILABLE' }));
          } finally { heartbeatRunning = false; }
        }, heartbeatIntervalMs);
        heartbeat.unref?.();
      }
      const result = await this.run({
        brief: dataFromMessage(userMessage),
        taskId,
        artifactId: stableResearchId('A', taskId),
        provider: this.provider,
        documentFetcher: this.documentFetcher,
        budget: this.budget,
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.canceledTasks.has(taskId)) return;
      const artifact = {
        artifactId: result.artifact.artifactId,
        name: 'ResearchArtifact',
        description: 'Verified public research artifact with claim-level provenance.',
        parts: [{ content: { $case: 'data', value: result.artifact }, metadata: undefined, filename: '', mediaType: 'application/json' }],
        metadata: { financialAuthorityDelta: 0 },
        extensions: [],
      };
      const completedStatus = statusEvent(taskId, contextId, TaskState.TASK_STATE_COMPLETED, 'Research artifact verified.').data.status;
      task.artifacts = mergeArtifactsById(task.artifacts, [artifact]);
      task.status = completedStatus;
      if (durableLease) {
        // Persist the lease-fenced terminal state before sending success to the
        // A2A caller. A worker whose lease expired must not publish a completion
        // that the canonical task store rejected.
        await this.taskStore.saveClaimed(task, lease);
      }
      if (recovery) {
        return;
      } else {
        eventBus.publish(AgentEvent.artifactUpdate({ taskId, contextId, artifact, append: false, lastChunk: true, metadata: undefined }));
        eventBus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: completedStatus, metadata: undefined }));
      }
    } catch (error) {
      if (controller.signal.aborted || this.canceledTasks.has(taskId) || error?.code === 'RESEARCH_CANCELED') return;
      PrometheusMetrics.inc('research_a2a_task_failures_total');
      const failedStatus = statusEvent(taskId, contextId, TaskState.TASK_STATE_FAILED, `Research failed closed: ${error?.code || 'RESEARCH_FAILED'}.`).data.status;
      if (recovery) {
        task.status = failedStatus;
        try { await this.taskStore.saveClaimed(task, lease); } catch {
          this.taskStore.forgetExecutionLease?.(taskId, lease);
        }
      } else if (durableLease) {
        task.status = failedStatus;
        try {
          await this.taskStore.saveClaimed(task, lease);
          eventBus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: failedStatus, metadata: undefined }));
        } catch {
          // A failure is user-visible only after the canonical store accepts it.
          // Otherwise recovery owns the durable task and will publish its state
          // on the next request rather than exposing a stale worker result.
          this.taskStore.forgetExecutionLease?.(taskId, lease);
        }
      } else {
        eventBus.publish(AgentEvent.statusUpdate({ taskId, contextId, status: failedStatus, metadata: undefined }));
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.activeTasks.delete(taskId);
      this.taskContexts.delete(taskId);
      this.canceledTasks.delete(taskId);
    }
  }

  async recoverOne() {
    if (!this.taskStore?.durable || typeof this.taskStore.claimNextRecoverable !== 'function') return false;
    const claim = await this.taskStore.claimNextRecoverable();
    if (!claim) return false;
    const { task, taskId, lease } = claim;
    const message = task.history?.find(item => item.messageId === lease.messageId);
    const execution = this.runClaimedTask({ task, userMessage: message, lease, recovery: true });
    this.inFlight.set(taskId, execution);
    try { await execution; } finally {
      if (this.inFlight.get(taskId) === execution) this.inFlight.delete(taskId);
    }
    return true;
  }

  async recoverBatch(maxBatchSize = 10) {
    const boundedLimit = Math.max(1, Math.min(25, Math.floor(Number(maxBatchSize) || 10)));
    let recovered = 0;
    while (recovered < boundedLimit && await this.recoverOne()) recovered += 1;
    return recovered;
  }

  startRecoveryLoop({ intervalMs = 1_000, maxBatchSize = 10, maxBackoffMs = 30_000 } = {}) {
    if (!this.taskStore?.durable || this.recoveryTimer) return;
    intervalMs = Math.max(250, Math.min(30_000, Math.floor(Number(intervalMs) || 1_000)));
    maxBatchSize = Math.max(1, Math.min(25, Math.floor(Number(maxBatchSize) || 10)));
    maxBackoffMs = Math.max(intervalMs, Math.min(120_000, Math.floor(Number(maxBackoffMs) || 30_000)));
    this.recoveryStopping = false;
    this.recoveryBackoffMs = intervalMs;
    const tick = async () => {
      if (this.recoveryStopping || this.recoveryTickRunning) return;
      this.recoveryTickRunning = true;
      let recovered = 0;
      try {
        recovered = await this.recoverBatch(maxBatchSize);
      } catch (error) {
        console.error('Research task recovery pass failed:', error?.code || 'A2A_TASK_RECOVERY_FAILED');
      } finally {
        this.recoveryTickRunning = false;
        if (!this.recoveryStopping) {
          const nextDelay = recovered === maxBatchSize
            ? Math.min(intervalMs, 100)
            : recovered > 0 ? intervalMs : this.recoveryBackoffMs;
          this.recoveryBackoffMs = recovered > 0
            ? intervalMs
            : Math.min(Math.max(intervalMs, this.recoveryBackoffMs * 2), maxBackoffMs);
          this.recoveryTimer = setTimeout(tick, nextDelay);
          this.recoveryTimer.unref?.();
        }
      }
    };
    this.recoveryTimer = setTimeout(tick, 0);
    this.recoveryTimer.unref?.();
  }

  stopRecoveryLoop() {
    this.recoveryStopping = true;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  async cancelTask(taskId, eventBus) {
    this.canceledTasks.add(taskId);
    const controller = this.activeTasks.get(taskId);
    controller?.abort();
    eventBus.publish(statusEvent(taskId, this.taskContexts.get(taskId) || '', TaskState.TASK_STATE_CANCELED, 'Research cancellation acknowledged.'));
  }

  async drain({ graceMs = 5000 } = {}) {
    this.stopRecoveryLoop();
    for (const controller of this.activeTasks.values()) controller.abort();
    const pending = Promise.allSettled([...this.inFlight.values()]);
    let timer;
    const drained = await Promise.race([
      pending.then(() => true),
      new Promise(resolveDrain => { timer = setTimeout(() => resolveDrain(false), graceMs); }),
    ]);
    clearTimeout(timer);
    return drained;
  }
}

export async function createResearchAgentServer({ env = process.env, port = Number(env.PORT || 5088), dependencies = {} } = {}) {
  if (env.AGENT_A2A_V1_ENABLED !== 'true') throw configError('AGENT_A2A_V1_ENABLED must be true to start the ResearchAgent server.');
  const numericPort = Number(port);
  const production = env.NODE_ENV === 'production';
  const baseUrl = parsePublicBaseUrl(env.AGENT_A2A_PUBLIC_URL || `http://127.0.0.1:${numericPort}`, { production });
  if (production) validateProductionIdentityConfiguration(env);
  const verifier = dependencies.identityVerifier || createAgentIdentityVerifier({ env, dependencies });
  const provider = dependencies.provider || createResearchSearchProvider({ env, fixtureDocuments: dependencies.fixtureDocuments, fetchImpl: dependencies.fetchImpl });
  const documentFetcher = dependencies.documentFetcher || new SafePublicDocumentFetcher({ fetchImpl: dependencies.fetchImpl, dnsLookup: dependencies.dnsLookup });
  const { card: signedCard, jwks, signing } = await signAgentCard(createAgentCard({ baseUrl }), { env, baseUrl });
  const activeTasks = new Map();
  const taskContexts = new Map();
  let taskStore = dependencies.taskStore;
  if (production) {
    if (taskStore) throw configError('Production ResearchAgent does not permit injected task stores.');
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      throw configError('Production ResearchAgent requires a connected Mongo task store.');
    }
    await verifyResearchTaskIndexes();
    taskStore = new MongoResearchTaskStore({ env, maxActiveTasks: researchAgentMaxActiveTasks(env) });
  } else {
    taskStore ||= new InMemoryTaskStore();
  }
  const executor = new ResearchAgentExecutor({ run: dependencies.run || runResearch, provider, documentFetcher, taskStore, budget: dependencies.budget, activeTasks, taskContexts });
  const requestHandler = new ResearchAgentRequestHandler(signedCard, taskStore, executor);
  const app = express();
  app.disable('x-powered-by');
  app.get('/health/live', (_req, res) => res.json({ status: 'ok', agent: RESEARCH_AGENT_TYPE, protocol: 'A2A v1.0' }));
  app.get('/health/ready', async (_req, res) => {
    const databaseReady = !production || mongoose.connection.readyState === 1;
    if (!databaseReady) return res.status(503).json({ status: 'NOT_READY', reason: 'RESEARCH_TASK_STORE_UNAVAILABLE' });
    if (production) {
      try { await verifyResearchTaskIndexes({ maxActiveTasks: researchAgentMaxActiveTasks(env) }); } catch (error) {
        return res.status(503).json({ status: 'NOT_READY', reason: error.code || 'RESEARCH_TASK_PERSISTENCE_UNAVAILABLE' });
      }
    }
    return res.json({ status: 'READY', agent: RESEARCH_AGENT_TYPE, taskStore: taskStore.durable ? 'DURABLE' : 'EPHEMERAL' });
  });
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
  if (jwks) app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks));
  const userBuilder = async req => req.verifiedA2AUser || buildAuthenticatedUser(req, { env, verifier });
  const contextBuilder = options => {
    const context = defaultServerCallContextBuilder(options);
    context.state.set('verifiedAgentIdentity', options.user?.identity || null);
    return context;
  };
  app.use('/a2a', async (req, res, next) => {
    try {
      req.verifiedA2AUser = await buildAuthenticatedUser(req, { env, verifier });
      next();
    } catch {
      res.set('WWW-Authenticate', 'Bearer');
      res.status(401).json({
        error: {
          code: 401,
          message: 'Authenticated A2A caller required.',
          status: 'UNAUTHENTICATED',
          details: [],
        },
      });
    }
  });
  app.use('/a2a', enforceHttpJsonContract);
  app.use('/a2a', restHandler({ requestHandler, userBuilder, contextBuilder }));
  return { app, card: signedCard, jwks, signing, executor, taskStore };
}

export async function startResearchAgentServer({ env = process.env, port = Number(env.PORT || 5088), dependencies = {} } = {}) {
  if (env.NODE_ENV === 'production') validateProductionIdentityConfiguration(env);
  let connectedHere = false;
  try {
    if (env.NODE_ENV === 'production' && mongoose.connection.readyState !== 1) {
      if (!env.MONGODB_URI) throw configError('Production ResearchAgent requires MONGODB_URI for durable task storage.');
      await connectDB({ uri: env.MONGODB_URI, env, options: { autoIndex: false }, requireTransactions: true });
      connectedHere = true;
    }
    const instance = await createResearchAgentServer({ env, port, dependencies });
    const server = http.createServer(instance.app);
    const host = env.AGENT_A2A_BIND_HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolveListen);
    });
    const address = server.address();
    instance.executor.startRecoveryLoop();
    return {
      ...instance,
      server,
      port: typeof address === 'object' && address ? address.port : port,
      close: async ({ graceMs = 5000 } = {}) => {
        let drainError;
        try {
          await instance.executor.drain({ graceMs });
        } catch (error) {
          drainError = error;
        }
        try {
          const closed = new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
          if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
          if (typeof server.closeAllConnections === 'function') {
            const forcedClose = setTimeout(() => server.closeAllConnections(), graceMs);
            forcedClose.unref?.();
            try { await closed; } finally { clearTimeout(forcedClose); }
          } else await closed;
        } finally {
          if (connectedHere) await mongoose.disconnect();
        }
        if (drainError) throw drainError;
      },
    };
  } catch (error) {
    if (connectedHere) await mongoose.disconnect().catch(() => {});
    throw error;
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  startResearchAgentServer().then(({ port }) => {
    process.stdout.write(`FinancialResearchAgent listening on 127.0.0.1:${port}\n`);
  }).catch(error => {
    process.stderr.write(`${error.code || 'RESEARCH_AGENT_START_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { RESEARCH_AGENT_TYPE, REQUIRED_CALLER_TYPE, RESEARCH_CAPABILITIES, RESEARCH_FORBIDDEN_CAPABILITIES };
