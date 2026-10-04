import crypto from 'node:crypto';
import { AgentCard, Role, TaskState, verifyAgentCardSignature } from '@a2a-js/sdk';
import { ClientFactory, RestTransportFactory } from '@a2a-js/sdk/client';
import { validateResearchBrief } from './researchSchemas.js';
import { hashResearchBrief, verifyArtifactContentHash } from './researchArtifact.js';
import { verifyResearchArtifact } from './researchClaimVerifier.js';
import { requestPinnedHttps, validatePublicUrl } from './safePublicDocumentFetcher.js';

function clientError(code, message, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error('Research request was canceled.');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
  }
}

function abortReason(originalSignal, timeoutSignal) {
  if (originalSignal?.aborted) {
    if (originalSignal.reason instanceof Error) return originalSignal.reason;
    return Object.assign(new Error('Research request was canceled.'), { name: 'AbortError', code: 'ABORT_ERR' });
  }
  if (timeoutSignal?.aborted) return clientError('A2A_RESPONSE_TIMEOUT', 'ResearchAgent response timed out.', 502);
  return clientError('A2A_RESPONSE_TIMEOUT', 'ResearchAgent response timed out.', 502);
}

function raceWithAbort(value, signal, makeAbortError) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(makeAbortError());
    const onAbort = () => reject(makeAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(
      result => { signal.removeEventListener('abort', onAbort); resolve(result); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function safeBaseUrl(value, env = process.env) {
  let url;
  try { url = new URL(value); } catch { throw clientError('A2A_AGENT_URL_INVALID', 'ResearchAgent URL is invalid.', 503); }
  const localHttpAllowed = env.NODE_ENV !== 'production'
    && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if ((!localHttpAllowed && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw clientError('A2A_AGENT_URL_INVALID', 'ResearchAgent URL must be a credential-free HTTPS origin.', 503);
  }
  if (env.NODE_ENV === 'production') {
    try { validatePublicUrl(url.href); } catch (error) {
      const code = error?.code === 'RESEARCH_SSRF_BLOCKED' ? 'A2A_AGENT_URL_PRIVATE' : 'A2A_AGENT_URL_INVALID';
      throw clientError(code, 'Production ResearchAgent URL must resolve through the pinned public HTTPS transport.', 503);
    }
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

async function boundedFetch(fetchImpl, input, init = {}, { maxBytes = 1_000_000, timeoutMs = 10_000 } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal && AbortSignal.any ? AbortSignal.any([init.signal, timeoutSignal]) : (init.signal || timeoutSignal);
  const raceAbort = promise => raceWithAbort(promise, signal, () => abortReason(init.signal, timeoutSignal));
  let response;
  try {
    response = await raceAbort(fetchImpl(input, { ...init, signal, redirect: 'manual', credentials: 'omit' }));
  } catch (error) {
    throwIfAborted(init.signal);
    if (timeoutSignal.aborted) throw clientError('A2A_RESPONSE_TIMEOUT', 'ResearchAgent response timed out.', 502);
    throw error;
  }
  const declaredBytes = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel?.();
    throw clientError('A2A_RESPONSE_TOO_LARGE', 'ResearchAgent response exceeds the size limit.', 502);
  }
  const chunks = [];
  let total = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        if (signal.aborted) throw clientError('A2A_RESPONSE_TIMEOUT', 'ResearchAgent response timed out.', 502);
        const { done, value } = await raceAbort(reader.read());
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw clientError('A2A_RESPONSE_TOO_LARGE', 'ResearchAgent response exceeds the size limit.', 502);
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (signal.aborted) {
        try { await reader.cancel(); } catch { /* The transport may already be closed. */ }
        throw abortReason(init.signal, timeoutSignal);
      }
      throw error;
    } finally {
      reader.releaseLock?.();
    }
  } else {
    const bytes = Buffer.from(await raceAbort(response.arrayBuffer()));
    if (bytes.length > maxBytes) throw clientError('A2A_RESPONSE_TOO_LARGE', 'ResearchAgent response exceeds the size limit.', 502);
    chunks.push(bytes);
    total = bytes.length;
  }
  return new Response(Buffer.concat(chunks, total), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function authenticatedFetch(token, fetchImpl, rpcUrl) {
  return async (input, init = {}) => {
    const target = new URL(input, rpcUrl);
    const rpc = new URL(rpcUrl);
    const pathAllowed = target.pathname === rpc.pathname
      || target.pathname.startsWith(`${rpc.pathname}/`)
      || target.pathname.startsWith(`${rpc.pathname}:`);
    if (target.origin !== rpc.origin || !pathAllowed || target.username || target.password) {
      throw clientError('A2A_CREDENTIAL_DESTINATION_REJECTED', 'A2A credentials may only be sent to the pinned RPC interface.', 502);
    }
    const headers = new Headers(init.headers || {});
    headers.delete('authorization');
    headers.delete('cookie');
    headers.delete('proxy-authorization');
    if (token) headers.set('authorization', `Bearer ${token}`);
    return boundedFetch(fetchImpl, target, { ...init, headers }, { maxBytes: 1_000_000, timeoutMs: 10_000 });
  };
}

export function createPinnedResearchMeshFetch({ dnsLookup, httpsRequest } = {}) {
  return async (input, init = {}) => {
    const target = validatePublicUrl(input instanceof URL ? input.href : String(input));
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    const result = await requestPinnedHttps(target, {
      method: init.method || 'GET',
      headers,
      body: init.body,
      signal: init.signal,
      maxBytes: 1_000_000,
      timeoutMs: 10_000,
      ...(dnsLookup ? { dnsLookup } : {}),
      ...(httpsRequest ? { httpsRequest } : {}),
    });
    const status = Number(result.status);
    const bodylessStatus = [204, 205, 304].includes(status);
    return new Response(bodylessStatus ? null : result.body, {
      status,
      headers: result.headers,
    });
  };
}

async function resolvePinnedPublicKey({ kid, jku, baseUrl, configuredJwk }) {
  if (!configuredJwk) throw clientError('A2A_CARD_KEY_NOT_PINNED', 'A2A Agent Card verification requires a locally pinned signing key.', 502);
  if (configuredJwk.kid !== kid || configuredJwk.kty !== 'RSA' || !configuredJwk.n || !configuredJwk.e
      || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(name => configuredJwk[name] !== undefined)) {
    throw clientError('A2A_CARD_KEY_NOT_PINNED', 'Agent Card signing key does not match the pinned public key.', 502);
  }
  const base = safeBaseUrl(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const expectedJwks = new URL(`${basePath}/.well-known/jwks.json`, base.origin);
  let advertised;
  try { advertised = new URL(jku); } catch { throw clientError('A2A_CARD_KEY_ORIGIN_REJECTED', 'Agent Card key reference is invalid.', 502); }
  if (advertised.origin !== expectedJwks.origin || advertised.pathname !== expectedJwks.pathname || advertised.search || advertised.hash) {
    throw clientError('A2A_CARD_KEY_ORIGIN_REJECTED', 'Agent Card key reference is not the pinned issuer endpoint.', 502);
  }
  try { return crypto.createPublicKey({ key: configuredJwk, format: 'jwk' }); } catch {
    throw clientError('A2A_CARD_KEY_INVALID', 'Pinned Agent Card key is invalid.', 503);
  }
}

async function fetchAndVerifyCard({ baseUrl, fetchImpl, requireSignedCard, configuredJwk, signal }) {
  const base = safeBaseUrl(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  const cardUrl = new URL(`${basePath}/.well-known/agent-card.json`, base.origin);
  const response = await boundedFetch(fetchImpl, cardUrl, {
    headers: { accept: 'application/json' },
    signal,
  }, { maxBytes: 128_000, timeoutMs: 5_000 });
  throwIfAborted(signal);
  if (response.status >= 300 && response.status < 400) throw clientError('A2A_AGENT_CARD_REDIRECT_REJECTED', 'ResearchAgent Agent Card redirects are not allowed.', 502);
  if (!response.ok) throw clientError('A2A_AGENT_CARD_UNAVAILABLE', 'ResearchAgent Agent Card is unavailable.', 502);
  if (!String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    throw clientError('A2A_AGENT_CARD_INVALID', 'ResearchAgent Agent Card must be JSON.', 502);
  }
  const card = AgentCard.fromJSON(await response.json());
  if (requireSignedCard && !card.signatures?.length) throw clientError('A2A_AGENT_CARD_UNSIGNED', 'A signed Agent Card is required.', 502);
  if (card.signatures?.length) {
    const verifier = verifyAgentCardSignature((kid, jku) => resolvePinnedPublicKey({ kid, jku, baseUrl, configuredJwk }));
    try { await verifier(card); } catch (error) {
      throwIfAborted(signal);
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
      throw clientError('A2A_AGENT_CARD_SIGNATURE_INVALID', 'ResearchAgent Agent Card signature verification failed.', 502);
    }
  }
  throwIfAborted(signal);
  const interfaceCard = card.supportedInterfaces?.find(item => item.protocolBinding === 'HTTP+JSON' && item.protocolVersion === '1.0');
  if (!interfaceCard) throw clientError('A2A_HTTP_JSON_INTERFACE_MISSING', 'ResearchAgent does not advertise HTTP+JSON A2A v1.0.', 502);
  let rpcUrl;
  try { rpcUrl = new URL(interfaceCard.url); } catch { throw clientError('A2A_RPC_INTERFACE_INVALID', 'ResearchAgent RPC interface URL is invalid.', 502); }
  const expectedPath = `${basePath}/a2a`;
  if (rpcUrl.origin !== base.origin || rpcUrl.pathname !== expectedPath || rpcUrl.search || rpcUrl.hash || rpcUrl.username || rpcUrl.password) {
    throw clientError('A2A_RPC_INTERFACE_INVALID', 'ResearchAgent RPC interface must remain on its pinned origin and path.', 502);
  }
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
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch, requireSignedCard = false, configuredJwk = null, env = process.env, dnsLookup, httpsRequest } = {}) {
    this.baseUrl = safeBaseUrl(baseUrl, env).toString().replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = env.NODE_ENV === 'production'
      ? createPinnedResearchMeshFetch({ dnsLookup, httpsRequest })
      : fetchImpl;
    this.requireSignedCard = requireSignedCard;
    this.configuredJwk = configuredJwk;
    this.requireIndependentSourceMetadata = env.NODE_ENV === 'production';
  }

  async resolve({ signal } = {}) {
    const card = await fetchAndVerifyCard({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      requireSignedCard: this.requireSignedCard,
      configuredJwk: this.configuredJwk,
      signal,
    });
    throwIfAborted(signal);
    const interfaceCard = card.supportedInterfaces.find(item => item.protocolBinding === 'HTTP+JSON' && item.protocolVersion === '1.0');
    const rpcUrl = new URL(interfaceCard.url);
    const rpcFetch = authenticatedFetch(this.token, this.fetchImpl, rpcUrl);
    const factory = new ClientFactory({
      transports: [new RestTransportFactory({ fetchImpl: rpcFetch })],
      preferredTransports: ['HTTP+JSON'],
    });
    const client = await factory.createFromAgentCard(card);
    return { card, client };
  }

  async sendResearch({ brief, signal } = {}) {
    const validation = validateResearchBrief(brief);
    if (validation.error) throw clientError('INVALID_RESEARCH_BRIEF', 'ResearchBrief failed client boundary validation.', 400);
    throwIfAborted(signal);
    const { card, client } = await this.resolve({ signal });
    throwIfAborted(signal);
    const result = await client.sendMessage(buildRequest(validation.value), { signal });
    throwIfAborted(signal);
    const task = taskFromResult(result);
    if (!task) throw clientError('A2A_TASK_MISSING', 'ResearchAgent did not return an A2A Task.', 502);
    if (task.status.state !== TaskState.TASK_STATE_COMPLETED) {
      const code = task.status.state === TaskState.TASK_STATE_CANCELED ? 'RESEARCH_CANCELED'
        : task.status.state === TaskState.TASK_STATE_FAILED ? 'RESEARCH_TASK_FAILED' : 'RESEARCH_TASK_NOT_TERMINAL';
      throw clientError(code, 'ResearchAgent did not return a completed task.', 502);
    }
    const artifact = artifactFromTask(task);
    const verification = artifact && verifyResearchArtifact(artifact, {
      brief: validation.value,
      requireIndependentSourceMetadata: this.requireIndependentSourceMetadata,
    });
    if (!artifact || artifact.taskId !== task.id
      || artifact.researchBriefId !== validation.value.researchBriefId
      || artifact.researchBriefHash !== hashResearchBrief(validation.value)
      || !verifyArtifactContentHash(artifact)
      || !verification?.valid) {
      throw clientError('RESEARCH_ARTIFACT_INVALID', 'ResearchAgent returned an invalid or unbound artifact.', 502);
    }
    return { card, task, artifact };
  }

  async submitForCancellation({ brief, signal } = {}) {
    const validation = validateResearchBrief(brief);
    if (validation.error) throw clientError('INVALID_RESEARCH_BRIEF', 'ResearchBrief failed client boundary validation.', 400);
    const { card, client } = await this.resolve({ signal });
    const request = buildRequest(validation.value);
    const result = await client.sendMessage({
      ...request,
      configuration: { ...request.configuration, returnImmediately: true },
    }, { signal });
    const task = taskFromResult(result);
    if (!task) throw clientError('A2A_TASK_MISSING', 'ResearchAgent did not return an A2A Task.', 502);
    const canceled = await client.cancelTask({ tenant: '', id: task.id }, { signal });
    return { card, task, canceled };
  }
}

export function createResearchMeshClient({ env = process.env, fetchImpl = globalThis.fetch, dnsLookup, httpsRequest } = {}) {
  const baseUrl = env.AGENT_A2A_RESEARCH_URL;
  if (!baseUrl) throw clientError('RESEARCH_AGENT_URL_MISSING', 'AGENT_A2A_RESEARCH_URL is required when ResearchMesh is enabled.', 503);
  let configuredJwk = null;
  try {
    configuredJwk = env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK ? JSON.parse(env.AGENT_A2A_CARD_SIGNING_PUBLIC_JWK) : null;
  } catch {
    throw clientError('A2A_CARD_KEY_CONFIGURATION_INVALID', 'Pinned Agent Card public JWK is invalid JSON.', 503);
  }
  if (env.NODE_ENV === 'production' && !configuredJwk) {
    throw clientError('A2A_CARD_KEY_CONFIGURATION_INVALID', 'Production ResearchMesh requires AGENT_A2A_CARD_SIGNING_PUBLIC_JWK.', 503);
  }
  const token = env.NODE_ENV === 'production'
    ? env.AGENT_A2A_CLIENT_TOKEN?.trim()
    : (env.AGENT_A2A_CLIENT_TOKEN || env.AGENT_A2A_DEV_TOKEN)?.trim();
  if (env.NODE_ENV === 'production' && !token) {
    throw clientError('A2A_CLIENT_TOKEN_CONFIGURATION_INVALID', 'Production ResearchMesh requires AGENT_A2A_CLIENT_TOKEN.', 503);
  }
  return new ResearchMeshClient({
    baseUrl,
    token: token || null,
    fetchImpl,
    requireSignedCard: env.NODE_ENV === 'production' || env.AGENT_A2A_CARD_SIGNING_ENABLED === 'true',
    configuredJwk,
    env,
    dnsLookup,
    httpsRequest,
  });
}
