import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { AgentCard, Role, TaskState } from '@a2a-js/sdk';
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
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { RESEARCH_CAPABILITIES, RESEARCH_FORBIDDEN_CAPABILITIES } from './researchConstants.js';

const RESEARCH_AGENT_TYPE = 'FINANCIAL_RESEARCH';
const REQUIRED_CALLER_TYPE = 'PLAN_REVIEW';

function configError(message) {
  const error = new Error(message);
  error.code = 'RESEARCH_AGENT_CONFIGURATION_INVALID';
  error.status = 503;
  return error;
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
    defaultInputModes: ['application/json'],
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

class ResearchAgentExecutor {
  constructor({ run, provider, documentFetcher, budget, activeTasks = new Map(), taskContexts = new Map() } = {}) {
    this.run = run;
    this.provider = provider;
    this.documentFetcher = documentFetcher;
    this.budget = budget;
    this.activeTasks = activeTasks;
    this.taskContexts = taskContexts;
    this.canceledTasks = new Set();
  }

  async execute(requestContext, eventBus) {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const controller = new AbortController();
    this.activeTasks.set(taskId, controller);
    this.taskContexts.set(taskId, contextId);
    PrometheusMetrics.inc('research_a2a_tasks_total');
    eventBus.publish(AgentEvent.task(initialTask(requestContext)));
    eventBus.publish(statusEvent(taskId, contextId, TaskState.TASK_STATE_WORKING, 'Research is running within the configured safety budget.'));
    try {
      const identity = requestContext.context.user?.identity;
      if (identity?.agentType !== REQUIRED_CALLER_TYPE) throw Object.assign(new Error('A2A caller identity is not allowed.'), { code: 'A2A_CALLER_IDENTITY_DENIED' });
      const brief = dataFromMessage(requestContext.userMessage);
      const result = await this.run({
        brief,
        taskId,
        provider: this.provider,
        documentFetcher: this.documentFetcher,
        budget: this.budget,
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.canceledTasks.has(taskId)) return;
      eventBus.publish(AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact: {
          artifactId: result.artifact.artifactId,
          name: 'ResearchArtifact',
          description: 'Verified public research artifact with claim-level provenance.',
          parts: [{ content: { $case: 'data', value: result.artifact }, metadata: undefined, filename: '', mediaType: 'application/json' }],
          metadata: { financialAuthorityDelta: 0 },
          extensions: [],
        },
        append: false,
        lastChunk: true,
        metadata: undefined,
      }));
      eventBus.publish(statusEvent(taskId, contextId, TaskState.TASK_STATE_COMPLETED, 'Research artifact verified.'));
    } catch (error) {
      if (controller.signal.aborted || this.canceledTasks.has(taskId) || error?.code === 'RESEARCH_CANCELED') return;
      PrometheusMetrics.inc('research_a2a_task_failures_total');
      eventBus.publish(statusEvent(taskId, contextId, TaskState.TASK_STATE_FAILED, `Research failed closed: ${error?.code || 'RESEARCH_FAILED'}.`));
    } finally {
      this.activeTasks.delete(taskId);
      this.taskContexts.delete(taskId);
      this.canceledTasks.delete(taskId);
    }
  }

  async cancelTask(taskId, eventBus) {
    this.canceledTasks.add(taskId);
    const controller = this.activeTasks.get(taskId);
    controller?.abort();
    eventBus.publish(statusEvent(taskId, this.taskContexts.get(taskId) || '', TaskState.TASK_STATE_CANCELED, 'Research cancellation acknowledged.'));
  }
}

export async function createResearchAgentServer({ env = process.env, port = Number(env.PORT || 5088), dependencies = {} } = {}) {
  if (env.AGENT_A2A_V1_ENABLED !== 'true') throw configError('AGENT_A2A_V1_ENABLED must be true to start the ResearchAgent server.');
  const numericPort = Number(port);
  const baseUrl = env.AGENT_A2A_PUBLIC_URL || `http://127.0.0.1:${numericPort}`;
  if (env.NODE_ENV === 'production' && !baseUrl.startsWith('https://')) throw configError('Production ResearchAgent requires an HTTPS AGENT_A2A_PUBLIC_URL.');
  const verifier = dependencies.identityVerifier || createAgentIdentityVerifier({ env, dependencies });
  const provider = dependencies.provider || createResearchSearchProvider({ env, fixtureDocuments: dependencies.fixtureDocuments, fetchImpl: dependencies.fetchImpl });
  const documentFetcher = dependencies.documentFetcher || new SafePublicDocumentFetcher({ fetchImpl: dependencies.fetchImpl, dnsLookup: dependencies.dnsLookup });
  const { card: signedCard, jwks, signing } = await signAgentCard(createAgentCard({ baseUrl }), { env, baseUrl });
  const activeTasks = new Map();
  const taskContexts = new Map();
  const executor = new ResearchAgentExecutor({ run: dependencies.run || runResearch, provider, documentFetcher, budget: dependencies.budget, activeTasks, taskContexts });
  const taskStore = dependencies.taskStore || new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(signedCard, taskStore, executor);
  const app = express();
  app.disable('x-powered-by');
  app.get('/health/live', (_req, res) => res.json({ status: 'ok', agent: RESEARCH_AGENT_TYPE, protocol: 'A2A v1.0' }));
  app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
  if (jwks) app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks));
  const userBuilder = async req => buildAuthenticatedUser(req, { env, verifier });
  const contextBuilder = options => {
    const context = defaultServerCallContextBuilder(options);
    context.state.set('verifiedAgentIdentity', options.user?.identity || null);
    return context;
  };
  app.use('/a2a', async (req, res, next) => {
    try {
      await userBuilder(req);
      next();
    } catch {
      res.status(401).json({ error: 'A2A_AUTH_FAILED', message: 'Authenticated A2A caller required.' });
    }
  });
  app.use('/a2a', restHandler({ requestHandler, userBuilder, contextBuilder }));
  return { app, card: signedCard, jwks, signing, executor, taskStore };
}

export async function startResearchAgentServer({ env = process.env, port = Number(env.PORT || 5088), dependencies = {} } = {}) {
  const instance = await createResearchAgentServer({ env, port, dependencies });
  const server = http.createServer(instance.app);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    ...instance,
    server,
    port: typeof address === 'object' && address ? address.port : port,
    close: () => new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())),
  };
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
