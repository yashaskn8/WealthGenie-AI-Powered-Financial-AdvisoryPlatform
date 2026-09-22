import ExecutionReceipt from '../../models/ExecutionReceipt.js';
import UserIntentMandate from '../../models/UserIntentMandate.js';
import Recommendation from '../../models/Recommendation.js';
import { createAuthorizationKeyProvider } from './keyProvider.js';
import { verifyExecutionReceiptDetails } from './executionReceipt.js';
import { verifyMandateRecord } from './mandateService.js';

function id(value) { return value === null || value === undefined ? null : String(value); }

function ownedReference(receipt, mandate) {
  return receipt.mandateId === mandate.mandateId
    && receipt.userId === id(mandate.userId)
    && receipt.action === mandate.action
    && receipt.resourceId === id(mandate.resourceId)
    && receipt.runId === mandate.runId
    && receipt.mandateHash === mandate.mandateHash;
}

/**
 * Verify an execution receipt against its historical mandate and the owned
 * recommendation it references. The response intentionally contains no
 * financial payload; it is a cryptographic/integrity result only.
 */
export async function verifyExecutionReceiptForUser({ receiptId, userId, dependencies = {}, runtimeConfig = {} } = {}) {
  const models = { receiptModel: ExecutionReceipt, mandateModel: UserIntentMandate, recommendationModel: Recommendation, ...dependencies };
  const receipt = await models.receiptModel.findOne({ receiptId, userId }).lean();
  if (!receipt) return { verified: false, reason: 'RECEIPT_NOT_FOUND', receiptId: id(receiptId) };

  const env = runtimeConfig.env || process.env;
  const keyProvider = dependencies.keyProvider || createAuthorizationKeyProvider({ env, required: env.NODE_ENV === 'production' });
  const receiptDetails = (() => {
    try { return verifyExecutionReceiptDetails(receipt, keyProvider); } catch { return { receiptHashValid: false, signatureValid: false }; }
  })();
  const { receiptHashValid, signatureValid } = receiptDetails;

  const mandate = await models.mandateModel.findOne({ mandateId: receipt.mandateId, userId }).lean();
  let mandateValid = false;
  if (mandate) {
    try { mandateValid = verifyMandateRecord(mandate, keyProvider) === true; } catch { mandateValid = false; }
  }
  const bindingsValid = Boolean(mandate && ownedReference(receipt, mandate));

  const recommendationId = receipt.resultMetadata?.recommendationId;
  let resultReferenceValid = false;
  if (recommendationId && mandate && receipt.status === 'EXECUTED') {
    const recommendation = await models.recommendationModel.findOne({
      _id: recommendationId,
      userId,
      profileId: mandate.profileId,
    }).select('_id').lean();
    resultReferenceValid = Boolean(recommendation);
  }

  return {
    verified: Boolean(receiptHashValid && signatureValid && mandateValid && bindingsValid && resultReferenceValid),
    receiptHashValid,
    signatureValid,
    mandateValid,
    bindingsValid,
    resultReferenceValid,
    keyId: receipt.signatureMetadata?.keyId || null,
    verificationVersion: 'execution-receipt-verification-1.0.0',
    receiptId: receipt.receiptId,
  };
}
