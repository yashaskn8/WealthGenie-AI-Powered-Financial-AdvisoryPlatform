import crypto from 'node:crypto';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { mandateError } from './authorizationConstants.js';

export class TrustedApprovalProvider {
  constructor({ name }) { this.name = name; }
  async createOptions() { throw new Error('TrustedApprovalProvider.createOptions must be implemented.'); }
  async verify() { throw new Error('TrustedApprovalProvider.verify must be implemented.'); }
}

export class DevelopmentApprovalProvider extends TrustedApprovalProvider {
  constructor({ env = process.env } = {}) {
    super({ name: 'DEVELOPMENT' });
    if (env.NODE_ENV === 'production') throw mandateError('DEVELOPMENT_APPROVAL_IN_PRODUCTION', 'Development approval is not permitted in production.', 500);
  }

  async createOptions({ mandate }) {
    return { method: 'DEVELOPMENT', mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, expiresAt: mandate.expiresAt };
  }

  async verify({ mandate, assertion }) {
    if (!assertion || assertion.method !== 'DEVELOPMENT' || assertion.mandateId !== mandate.mandateId || assertion.mandateHash !== mandate.mandateHash) {
      throw mandateError('TRUSTED_APPROVAL_INVALID', 'The development approval does not match this mandate.');
    }
    return { verified: true, method: 'DEVELOPMENT', verifiedAt: new Date().toISOString(), credentialId: null };
  }
}

/**
 * WebAuthn adapter boundary. Assertion parsing and signature verification must
 * be supplied by a mature WebAuthn implementation (for example
 * @simplewebauthn/server). This class deliberately fails closed when the
 * adapter is missing; it never treats a browser boolean as proof of approval.
 */
export class WebAuthnApprovalProvider extends TrustedApprovalProvider {
  constructor({ verifier, origin, rpId, env = process.env } = {}) {
    super({ name: 'WEBAUTHN' });
    this.verifier = verifier;
    this.origin = origin;
    this.rpId = rpId;
    this.env = env;
  }

  async createOptions({ mandate, credentialIds = [] }) {
    if (typeof this.verifier?.generateAuthenticationOptions !== 'function') {
      throw mandateError('WEBAUTHN_PROVIDER_UNAVAILABLE', 'Passkey approval is not configured.', 503);
    }
    const challenge = crypto.randomBytes(32).toString('base64url');
    const options = await this.verifier.generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials: credentialIds.map(id => ({ id, type: 'public-key' })),
      userVerification: 'required',
      challenge,
    });
    return { ...options, mandateId: mandate.mandateId, mandateHash: mandate.mandateHash };
  }

  async verify({ mandate, assertion, credential }) {
    if (typeof this.verifier?.verifyAuthenticationResponse !== 'function') {
      throw mandateError('WEBAUTHN_PROVIDER_UNAVAILABLE', 'Passkey approval is not configured.', 503);
    }
    if (!assertion || assertion.mandateId !== mandate.mandateId || assertion.mandateHash !== mandate.mandateHash) {
      throw mandateError('TRUSTED_APPROVAL_INVALID', 'The passkey assertion is not bound to this mandate.');
    }
    const result = await this.verifier.verifyAuthenticationResponse({
      response: assertion.response,
      expectedChallenge: assertion.expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      credential,
      requireUserVerification: true,
    });
    if (!result?.verified || !result.authenticationInfo?.userVerified) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey user verification failed.');
    return {
      verified: true,
      method: 'WEBAUTHN',
      verifiedAt: new Date().toISOString(),
      credentialId: credential.id || credential.credentialId,
      newCounter: result.authenticationInfo.newCounter,
    };
  }

  async createRegistrationOptions({ user, excludeCredentials = [] }) {
    if (typeof this.verifier?.generateRegistrationOptions !== 'function') throw mandateError('WEBAUTHN_PROVIDER_UNAVAILABLE', 'Passkey enrollment is not configured.', 503);
    const challenge = crypto.randomBytes(32).toString('base64url');
    const options = await this.verifier.generateRegistrationOptions({
      rpName: 'WealthGenie',
      rpID: this.rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(String(user._id)),
      challenge,
      attestationType: 'none',
      userVerification: 'required',
      excludeCredentials: excludeCredentials.map(id => ({ id, type: 'public-key' })),
    });
    return { ...options, challenge };
  }

  async verifyRegistration({ response, expectedChallenge }) {
    if (typeof this.verifier?.verifyRegistrationResponse !== 'function') throw mandateError('WEBAUTHN_PROVIDER_UNAVAILABLE', 'Passkey enrollment is not configured.', 503);
    const result = await this.verifier.verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      requireUserVerification: true,
    });
    if (!result?.verified || !result.registrationInfo?.credential) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Passkey enrollment verification failed.');
    return result.registrationInfo;
  }
}

export function createTrustedApprovalProvider({ env = process.env, verifier = null } = {}) {
  const provider = String(env.AGENT_APPROVAL_PROVIDER || (env.NODE_ENV === 'production' ? 'webauthn' : 'development')).toLowerCase();
  if (provider === 'development') return new DevelopmentApprovalProvider({ env });
  if (provider === 'webauthn') return new WebAuthnApprovalProvider({
    verifier: verifier || { generateAuthenticationOptions, verifyAuthenticationResponse, generateRegistrationOptions, verifyRegistrationResponse },
    origin: env.WEBAUTHN_ORIGIN,
    rpId: env.WEBAUTHN_RP_ID,
    env,
  });
  throw new Error('Unsupported trusted approval provider.');
}
