import User from '../../models/User.js';
import PasskeyCredential from '../../models/PasskeyCredential.js';
import PasskeyRegistrationChallenge from '../../models/PasskeyRegistrationChallenge.js';
import { createTrustedApprovalProvider } from './approvalProviders.js';
import { mandateError } from './authorizationConstants.js';
import { normalizeWebAuthnCredential } from './webAuthnBytes.js';
import logger from '../../utils/logger.js';

async function endAuthorizationSession(session) {
  try {
    await session?.endSession?.();
  } catch (error) {
    logger.warn('Passkey registration session cleanup failed', {
      code: error?.code || 'SESSION_CLEANUP_FAILED',
    });
  }
}

async function withPasskeyRegistrationTransaction(models, dependencies, operation) {
  if (typeof dependencies.authorizationTransaction === 'function') {
    return dependencies.authorizationTransaction(operation);
  }

  const connection = models.challengeModel.db;
  if (typeof connection?.startSession !== 'function') {
    throw mandateError('AUTHORIZATION_TRANSACTION_UNAVAILABLE', 'Passkey enrollment requires transaction-capable persistence.', 503);
  }

  let session;
  try {
    session = await connection.startSession();
  } catch {
    throw mandateError('AUTHORIZATION_TRANSACTION_UNAVAILABLE', 'Passkey enrollment requires transaction-capable persistence.', 503);
  }
  if (typeof session?.withTransaction !== 'function') {
    await endAuthorizationSession(session);
    throw mandateError('AUTHORIZATION_TRANSACTION_UNAVAILABLE', 'Passkey enrollment requires transaction-capable persistence.', 503);
  }

  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await endAuthorizationSession(session);
  }
}

export async function createPasskeyRegistrationOptions({ userId, runtimeConfig = {}, dependencies = {} }) {
  const models = { userModel: User, credentialModel: PasskeyCredential, challengeModel: PasskeyRegistrationChallenge, ...dependencies };
  const user = await models.userModel.findById(userId).lean();
  if (!user) throw mandateError('AUTH_REQUIRED', 'Authenticated user not found.', 401);
  const provider = dependencies.approvalProvider || createTrustedApprovalProvider({ env: runtimeConfig.env || process.env, verifier: dependencies.webauthnVerifier });
  if (provider.name !== 'WEBAUTHN' || typeof provider.createRegistrationOptions !== 'function') throw mandateError('WEBAUTHN_PROVIDER_UNAVAILABLE', 'Passkey enrollment is not configured.', 503);
  const existing = await models.credentialModel.find({ userId }).lean();
  const options = await provider.createRegistrationOptions({ user, excludeCredentials: existing.map(item => item.credentialId) });
  await models.challengeModel.deleteMany({ userId, consumedAt: null });
  await models.challengeModel.create({ userId, challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return options;
}

export async function verifyPasskeyRegistration({ userId, response, runtimeConfig = {}, dependencies = {} }) {
  const models = { credentialModel: PasskeyCredential, challengeModel: PasskeyRegistrationChallenge, ...dependencies };
  const challenge = await models.challengeModel.findOne({ userId, consumedAt: null }).sort({ createdAt: -1 }).lean();
  if (!challenge || new Date(challenge.expiresAt).getTime() <= Date.now()) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey enrollment challenge is missing or expired.');
  const provider = dependencies.approvalProvider || createTrustedApprovalProvider({ env: runtimeConfig.env || process.env, verifier: dependencies.webauthnVerifier });
  if (provider.name !== 'WEBAUTHN' || typeof provider.verifyRegistration !== 'function') throw mandateError('WEBAUTHN_PROVIDER_UNAVAILABLE', 'Passkey enrollment is not configured.', 503);
  const info = await provider.verifyRegistration({ response, expectedChallenge: challenge.challenge });
  const credential = normalizeWebAuthnCredential({
    credentialId: info.credential?.id || info.credentialID,
    publicKey: info.credential?.publicKey || info.credentialPublicKey,
    counter: info.credential?.counter ?? info.counter ?? 0,
    transports: response?.response?.transports || [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
  });
  return withPasskeyRegistrationTransaction(models, dependencies, async session => {
    const consumed = await models.challengeModel.findOneAndUpdate(
      {
        _id: challenge._id,
        userId,
        consumedAt: null,
        $expr: { $gt: ['$expiresAt', '$$NOW'] },
      },
      { $set: { consumedAt: new Date() } },
      { new: true, session },
    );
    if (!consumed) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey enrollment challenge was consumed or expired.');

    const [saved] = await models.credentialModel.create([{ userId, ...credential }], { session });
    if (!saved) throw new Error('Passkey credential persistence returned no document.');
    return { credentialId: saved.credentialId, createdAt: saved.createdAt };
  });
}
