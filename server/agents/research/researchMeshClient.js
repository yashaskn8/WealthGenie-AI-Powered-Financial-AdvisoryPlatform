import crypto from 'node:crypto';
import { AgentCard, Role, TaskState, verifyAgentCardSignature } from '@a2a-js/sdk';
import { ClientFactory, RestTransportFactory } from '@a2a-js/sdk/client';
import { validateResearchBrief } from './researchSchemas.js';
import { verifyArtifactContentHash } from './researchArtifact.js';

function clientError(code, message, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function authenticatedFetch(token, fetchImpl = globalThis.fetch) {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('authorization', `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  };
}

async function resolvePublicKey({ kid, jku, baseUrl, fetchImpl, configuredJwk }) {
  const jwksUrl = jku || `${baseUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
  const parsed = new URL(jwksUrl);
  const base = new URL(baseUrl);
  if (parsed.origin !== base.origin) throw clientError('A2A_CARD_KEY_ORIGIN_REJECTED', 'Agent Card signing key origin is not trusted.', 502);
  const response = await fetchImpl(parsed);
  if (!response.ok) throw clientError('A2A_CARD_KEY_UNAVAILABLE', 'Agent Card signing keys are unavailable.', 502);
  const body = await response.json();
  const jwk = configuredJwk || body?.keys?.find(key => key.kid === kid);
  if (!jwk) throw clientError('A2A_CARD_KEY_UNAVAILABLE', 'Agent Card signing key ID was not found.', 502);
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

async function fetchAndVerifyCard({ baseUrl, fetchImpl, requireSignedCard, configuredJwk }) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/.well-known/agent-card.json`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw clientError('A2A_AGENT_CARD_UNAVAILABLE', 'ResearchAgent Agent Card is unavailable.', 502);
  const card = AgentCard.fromJSON(await response.json());
  if (requireSignedCard && !card.signatures?.length) throw clientError('A2A_AGENT_CARD_UNSIGNED', 'A signed Agent Card is required.', 502);
  if (card.signatures?.length) {
    const verifier = verifyAgentCardSignature((kid, jku) => resolvePublicKey({ kid, jku, baseUrl, fetchImpl, configuredJwk }));
    try { await verifier(card); } catch {
      throw clientError('A2A_AGENT_CARD_SIGNATURE_INVALID', 'ResearchAgent Agent Card signature verification failed.', 502);
    }
  }
  const interfaceCard = card.supportedInterfaces?.find(item => item.protocolBinding === 'HTTP+JSON' && item.protocolVersion === '1.0');
  if (!interfaceCard) throw clientError('A2A_HTTP_JSON_INTERFACE_MISSING', 'ResearchAgent does not advertise HTTP+JSON A2A v1.0.', 502);
  return card;
}

function buildRequest(brief) {
  return {
    tenant: '',
    message: {
      messageId: crypto.randomUUID(),
      contextId: crypto.randomUUID(),
      taskId: '',
      role: Role.ROLE_USER,
      parts: [{ content: { $case: 'data', value: brief }, metadata: undefined, filename: '', mediaType: 'application/json' }],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['application/json'],
      taskPushNotificationConfig: undefined,
      historyLength: 0,
      returnImmediately: false,
    },
    metadata: { researchBriefId: brief.researchBriefId },
  };
}

function taskFromResult(result) {
  return result && typeof result === 'object' && result.id && result.status ? result : null;
}

function artifactFromTask(task) {
  const part = task?.artifacts?.flatMap(artifact => artifact.parts || [])
    .find(item => item?.content?.$case === 'data');
  return part?.content?.value || null;
}

export class ResearchMeshClient {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, requireSignedCard = false, configuredJwk = null } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.requireSignedCard = requireSignedCard;
    this.configuredJwk = configuredJwk;
  }

  async resolve() {
    const cardFetch = authenticatedFetch(this.token, this.fetchImpl);
    const card = await fetchAndVerifyCard({
      baseUrl: this.baseUrl,
      fetchImpl: cardFetch,
      requireSignedCard: this.requireSignedCard,
      configuredJwk: this.configuredJwk,
    });
    const factory = new ClientFactory({
      transports: [new RestTransportFactory({ fetchImpl: cardFetch })],
      preferredTransports: ['HTTP+JSON'],
    });
    const client = await factory.createFromAgentCard(card);
    return { card, client };
  }

  async sendResearch({ brief, signal } = {}) {
    const validation = validateResearchBrief(brief);
    if (validation.error) throw clientError('INVALID_RESEARCH_BRIEF', 'ResearchBrief failed client boundary validation.', 400);
    const { card, client } = await this.resolve();
    const result = await client.sendMessage(buildRequest(validation.value), { signal });
    const task = taskFromResult(result);
    if (!task) throw clientError('A2A_TASK_MISSING', 'ResearchAgent did not return an A2A Task.', 502);
    if (task.status.state === TaskState.TASK_STATE_CANCELED) throw clientError('RESEARCH_CANCELED', 'Research task was canceled.', 499);
    if (task.status.state === TaskState.TASK_STATE_FAILED) throw clientError('RESEARCH_TASK_FAILED', 'ResearchAgent returned a failed task.', 502);
    const artifact = artifactFromTask(task);
    if (!artifact || artifact.researchBriefId !== validation.value.researchBriefId || !verifyArtifactContentHash(artifact)) {
      throw clientError('RESEARCH_ARTIFACT_INVALID', 'ResearchAgent returned an invalid or unbound artifact.', 502);
    }
    return { card, task, artifact };
  }

  async submitForCancellation({ brief } = {}) {
    const validation = validateResearchBrief(brief);
    if (validation.error) throw clientError('INVALID_RESEARCH_BRIEF', 'ResearchBrief failed client boundary validation.', 400);
    const { card, client } = await this.resolve();
    const result = await client.sendMessage({
      ...buildRequest(validation.value),
      configuration: { ...buildRequest(validation.value).configuration, returnImmediately: true },
    });
    const task = taskFromResult(result);
    if (!task) throw clientError('A2A_TASK_MISSING', 'ResearchAgent did not return an A2A Task.', 502);
    const canceled = await client.cancelTask({ tenant: '', id: task.id });
    return { card, task, canceled };
  }
}

export function createResearchMeshClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = env.AGENT_A2A_RESEARCH_URL;
  if (!baseUrl) throw clientError('RESEARCH_AGENT_URL_MISSING', 'AGENT_A2A_RESEARCH_URL is required when ResearchMesh is enabled.', 503);
  return new ResearchMeshClient({
    baseUrl,
    token: env.AGENT_A2A_CLIENT_TOKEN || env.AGENT_A2A_DEV_TOKEN || null,
    fetchImpl,
    requireSignedCard: env.NODE_ENV === 'production' || env.AGENT_A2A_CARD_SIGNING_ENABLED === 'true',
    configuredJwk: env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK ? JSON.parse(env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK) : null,
  });
}
