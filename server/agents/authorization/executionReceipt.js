import crypto from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../utils/canonicalJson.js';
import { RECEIPT_VERSION } from './authorizationConstants.js';

export function receiptHashPayload(receipt) {
  return {
    receiptId: receipt.receiptId,
    version: receipt.version,
    mandateId: receipt.mandateId,
    action: receipt.action,
    status: receipt.status,
    executedByServiceIdentity: receipt.executedByServiceIdentity,
    userId: String(receipt.userId),
    runId: receipt.runId,
    correlationId: receipt.correlationId || null,
    resourceId: String(receipt.resourceId),
    beforeSnapshotHash: receipt.beforeSnapshotHash,
    afterSnapshotHash: receipt.afterSnapshotHash || null,
    startedAt: new Date(receipt.startedAt).toISOString(),
    completedAt: new Date(receipt.completedAt).toISOString(),
    policyDecisionId: receipt.policyDecisionId,
    policyVersion: receipt.policyVersion,
    mandateHash: receipt.mandateHash,
    previousReceiptHash: receipt.previousReceiptHash || null,
    resultMetadata: receipt.resultMetadata,
  };
}

export function calculateReceiptHash(receipt) {
  return canonicalSha256(receiptHashPayload(receipt));
}

export function createSignedExecutionReceipt({ mandate, resultMetadata, beforeSnapshotHash, afterSnapshotHash = null, policyDecisionId, keyProvider, startedAt = new Date(), completedAt = new Date(), previousReceiptHash = null, serviceIdentity = 'wealthgenie.authorized-action-executor' }) {
  if (!keyProvider) throw new Error('Receipt signing requires an authorization key provider.');
  const receipt = {
    receiptId: crypto.randomUUID(),
    version: RECEIPT_VERSION,
    mandateId: mandate.mandateId,
    action: mandate.action,
    status: 'EXECUTED',
    executedByServiceIdentity: serviceIdentity,
    userId: String(mandate.userId),
    runId: mandate.runId,
    correlationId: mandate.correlationId || null,
    resourceId: String(mandate.resourceId),
    beforeSnapshotHash,
    afterSnapshotHash,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    policyDecisionId,
    policyVersion: mandate.policyVersion,
    mandateHash: mandate.mandateHash,
    previousReceiptHash,
    resultMetadata,
  };
  const receiptHash = calculateReceiptHash(receipt);
  return {
    ...receipt,
    receiptHash,
    signatureMetadata: { ...keyProvider.metadata(), signature: keyProvider.sign(canonicalJson({ ...receipt, receiptHash })) },
  };
}

export function verifyExecutionReceiptDetails(receipt, keyProvider) {
  const receiptHashValid = Boolean(receipt && calculateReceiptHash(receipt) === receipt.receiptHash);
  const metadata = receipt?.signatureMetadata;
  if (metadata?.algorithm !== 'Ed25519' || !metadata.keyId || !metadata.signature) return { receiptHashValid, signatureValid: false };
  const payload = canonicalJson({ ...receipt, signatureMetadata: undefined });
  const signatureValid = Boolean(typeof keyProvider?.verifyByKeyId === 'function'
    ? keyProvider.verifyByKeyId(payload, metadata.signature, metadata.keyId)
    : keyProvider?.verify?.(payload, metadata.signature, metadata.keyId));
  return { receiptHashValid, signatureValid };
}

export function verifyExecutionReceipt(receipt, keyProvider) {
  const details = verifyExecutionReceiptDetails(receipt, keyProvider);
  return Boolean(details.receiptHashValid && details.signatureValid);
}
