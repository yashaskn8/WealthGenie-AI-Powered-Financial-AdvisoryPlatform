import User from '../../models/User.js';
import PasskeyCredential from '../../models/PasskeyCredential.js';
import PasskeyRegistrationChallenge from '../../models/PasskeyRegistrationChallenge.js';
import { createTrustedApprovalProvider } from './approvalProviders.js';
import { mandateError } from './authorizationConstants.js';

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
  const credentialId = info.credential?.id || info.credentialID;
  const publicKey = info.credential?.publicKey || info.credentialPublicKey;
  const counter = info.credential?.counter ?? info.counter ?? 0;
  if (!credentialId || !publicKey) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey registration returned incomplete credential metadata.');
  const credential = await models.credentialModel.create({ userId, credentialId, publicKey: Buffer.from(publicKey), counter, transports: response?.response?.transports || [] });
  await models.challengeModel.updateOne({ _id: challenge._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  return { credentialId: credential.credentialId, createdAt: credential.createdAt };
}

