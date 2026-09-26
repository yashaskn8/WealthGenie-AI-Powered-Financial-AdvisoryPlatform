function decodeBase64Url(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${label} is not valid base64url data.`);
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  let binary;
  try {
    binary = atob(base64);
  } catch {
    throw new TypeError(`${label} is not valid base64url data.`);
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}

function encodeBase64Url(value) {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
    throw new TypeError('WebAuthn response data must be bytes.');
  }
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function requireOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('WebAuthn options are unavailable.');
  }
}

export function toAuthenticationRequestOptions(options) {
  requireOptions(options);
  const { challenge, allowCredentials = [], rpId, timeout, userVerification, hints, extensions } = options;
  if (!Array.isArray(allowCredentials)) throw new TypeError('Passkey allow-list is invalid.');
  return {
    ...(rpId ? { rpId } : {}),
    ...(Number.isFinite(timeout) ? { timeout } : {}),
    ...(userVerification ? { userVerification } : {}),
    ...(Array.isArray(hints) ? { hints } : {}),
    ...(extensions && typeof extensions === 'object' ? { extensions } : {}),
    challenge: decodeBase64Url(challenge, 'WebAuthn challenge'),
    allowCredentials: allowCredentials.map(item => {
      if (!item || item.type !== 'public-key') throw new TypeError('Passkey allow-list entry is invalid.');
      return { ...item, id: decodeBase64Url(item.id, 'Passkey credential ID') };
    }),
  };
}

export function toRegistrationCreationOptions(options) {
  requireOptions(options);
  const {
    challenge, user, excludeCredentials = [], rp, pubKeyCredParams, timeout,
    authenticatorSelection, attestation, extensions, hints,
  } = options;
  if (!user || typeof user !== 'object' || !Array.isArray(excludeCredentials)) {
    throw new TypeError('Passkey registration options are invalid.');
  }
  return {
    ...(rp ? { rp } : {}),
    ...(Array.isArray(pubKeyCredParams) ? { pubKeyCredParams } : {}),
    ...(Number.isFinite(timeout) ? { timeout } : {}),
    ...(authenticatorSelection ? { authenticatorSelection } : {}),
    ...(attestation ? { attestation } : {}),
    ...(extensions && typeof extensions === 'object' ? { extensions } : {}),
    ...(Array.isArray(hints) ? { hints } : {}),
    challenge: decodeBase64Url(challenge, 'WebAuthn challenge'),
    user: { ...user, id: decodeBase64Url(user.id, 'WebAuthn user ID') },
    excludeCredentials: excludeCredentials.map(item => {
      if (!item || item.type !== 'public-key') throw new TypeError('Passkey exclusion entry is invalid.');
      return { ...item, id: decodeBase64Url(item.id, 'Passkey credential ID') };
    }),
  };
}

export function serializeAuthenticationCredential(credential) {
  if (!credential || credential.type !== 'public-key' || !credential.response) {
    throw new TypeError('The browser did not return a public-key assertion.');
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    response: {
      authenticatorData: encodeBase64Url(response.authenticatorData),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };
}

export function serializeRegistrationCredential(credential) {
  if (!credential || credential.type !== 'public-key' || !credential.response) {
    throw new TypeError('The browser did not return a public-key credential.');
  }
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    response: {
      attestationObject: encodeBase64Url(credential.response.attestationObject),
      clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
      transports: credential.response.getTransports?.() || [],
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };
}
