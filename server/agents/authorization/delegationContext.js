import { canonicalSha256 } from '../../utils/canonicalJson.js';

const MAX_DELEGATION_DEPTH = 2;

export function createDelegationContext({ originalUser, actingAgent, parentAgent = null, purpose, action, runId, mandateId, audience, issuedAt = new Date(), expiresAt, delegationDepth = 0 }) {
  if (!originalUser || !actingAgent || !purpose || !action || !runId || !mandateId || !audience || !expiresAt) throw new TypeError('Delegation context is incomplete.');
  if (delegationDepth < 0 || delegationDepth > MAX_DELEGATION_DEPTH) throw new Error('Delegation depth exceeds the hard maximum.');
  return Object.freeze({
    version: 'delegation-context-1.0.0',
    originalUser: String(originalUser),
    actingAgent: String(actingAgent),
    parentAgent: parentAgent ? String(parentAgent) : null,
    purpose: String(purpose),
    action: String(action),
    runId: String(runId),
    mandateId: String(mandateId),
    audience: String(audience),
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    delegationDepth,
    contextHash: canonicalSha256({ originalUser: String(originalUser), actingAgent: String(actingAgent), parentAgent: parentAgent ? String(parentAgent) : null, purpose: String(purpose), action: String(action), runId: String(runId), mandateId: String(mandateId), audience: String(audience), issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), delegationDepth }),
  });
}

export function verifyDelegationContext(context, { audience, mandateId, now = new Date() } = {}) {
  if (!context || context.version !== 'delegation-context-1.0.0') throw new Error('Unsupported delegation context.');
  if (context.audience !== audience || context.mandateId !== mandateId) throw new Error('Delegation context binding mismatch.');
  if (new Date(context.expiresAt).getTime() <= now.getTime()) throw new Error('Delegation context expired.');
  if (context.delegationDepth > MAX_DELEGATION_DEPTH) throw new Error('Delegation context depth exceeded.');
  const expected = createDelegationContext(context).contextHash;
  if (expected !== context.contextHash) throw new Error('Delegation context integrity failure.');
  return true;
}

export { MAX_DELEGATION_DEPTH };

