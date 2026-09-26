import { describe, expect, it } from 'vitest';
import {
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
  toAuthenticationRequestOptions,
  toRegistrationCreationOptions,
} from '../webAuthnClient';

const asBuffer = text => Uint8Array.from(text, character => character.charCodeAt(0)).buffer;

describe('browser WebAuthn boundary', () => {
  it('converts server authentication challenge and credential IDs into native browser buffers', () => {
    const options = toAuthenticationRequestOptions({
      challenge: 'AQID',
      allowCredentials: [{ id: 'BAUG', type: 'public-key', transports: ['internal'] }],
      userVerification: 'required',
      mandateId: 'not-a-browser-option',
    });
    expect([...new Uint8Array(options.challenge)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(options.allowCredentials[0].id)]).toEqual([4, 5, 6]);
    expect(options.userVerification).toBe('required');
    expect(options).not.toHaveProperty('mandateId');
  });

  it('converts registration challenge, user ID, and exclusion list to native buffers', () => {
    const options = toRegistrationCreationOptions({
      challenge: 'AQID',
      user: { id: 'BAUG', name: 'member@example.test' },
      excludeCredentials: [{ id: 'BwgJ', type: 'public-key' }],
      authenticatorSelection: { userVerification: 'required' },
    });
    expect([...new Uint8Array(options.challenge)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(options.user.id)]).toEqual([4, 5, 6]);
    expect([...new Uint8Array(options.excludeCredentials[0].id)]).toEqual([7, 8, 9]);
  });

  it('serializes authentication assertions in SimpleWebAuthn JSON form', () => {
    const assertion = serializeAuthenticationCredential({
      id: 'AQID', rawId: asBuffer('\u0001\u0002\u0003'), type: 'public-key',
      response: {
        authenticatorData: asBuffer('\u0004\u0005'),
        clientDataJSON: asBuffer('\u0006\u0007'),
        signature: asBuffer('\u0008\u0009'),
        userHandle: null,
      },
      getClientExtensionResults: () => ({ appid: false }),
    });
    expect(assertion).toEqual({
      id: 'AQID', rawId: 'AQID', type: 'public-key', authenticatorAttachment: undefined,
      response: { authenticatorData: 'BAU', clientDataJSON: 'Bgc', signature: 'CAk', userHandle: null },
      clientExtensionResults: { appid: false },
    });
  });

  it('serializes registration attestation and transports for the server verifier', () => {
    const registration = serializeRegistrationCredential({
      id: 'AQID', rawId: asBuffer('\u0001\u0002\u0003'), type: 'public-key',
      response: {
        attestationObject: asBuffer('\u0004\u0005'),
        clientDataJSON: asBuffer('\u0006\u0007'),
        getTransports: () => ['internal'],
      },
      getClientExtensionResults: () => ({}),
    });
    expect(registration.response).toEqual({ attestationObject: 'BAU', clientDataJSON: 'Bgc', transports: ['internal'] });
  });

  it('rejects malformed or non-public-key ceremony data before API submission', () => {
    expect(() => toAuthenticationRequestOptions({ challenge: 'bad=', allowCredentials: [] })).toThrow(/challenge/i);
    expect(() => toRegistrationCreationOptions({ challenge: 'AQID', user: {}, excludeCredentials: [] })).toThrow(/user ID/i);
    expect(() => serializeAuthenticationCredential({ type: 'password' })).toThrow(/public-key/i);
  });
});
