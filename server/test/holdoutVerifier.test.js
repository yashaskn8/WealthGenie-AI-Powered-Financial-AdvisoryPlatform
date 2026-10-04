import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildHoldoutAttestationSigningPayload,
  evaluateCandidateOnHoldout as evaluateCandidateOnHoldoutWithTrustedEnvironment,
  hashHoldoutCases,
  holdoutPublicKeyId,
  HOLDOUT_ATTESTATION_SCHEMA_VERSION,
  HOLDOUT_BUNDLE_SCHEMA_VERSION,
} from '../agents/evals/holdoutVerifier.js';

const signer = crypto.generateKeyPairSync('ed25519');
const trustedPublicKey = signer.publicKey.export({ format: 'pem', type: 'spki' });
const datasetVersion = 'governed-self-evolution-1.0.0';
const attestedAt = '2026-09-25T12:00:00.000Z';

function signedBundleWithCanonicalBytes(cases) {
  const keyId = holdoutPublicKeyId(signer.publicKey);
  const payload = buildHoldoutAttestationSigningPayload({ cases, datasetVersion, attestedAt, keyId });
  return {
    schemaVersion: HOLDOUT_BUNDLE_SCHEMA_VERSION,
    cases,
    attestation: {
      ...payload.claims,
      signature: crypto.sign(null, payload.signingBytes, signer.privateKey).toString('base64'),
    },
  };
}

function sampleCase(overrides = {}) {
  return {
    id: 'case-secret-id',
    partition: 'holdout',
    expectedAction: 'NONE',
    expectedTools: ['get_current_profile_context'],
    answerKey: 'private-grader-label',
    fixture: {
      userId: 'evaluation-user',
      profileId: 'evaluation-profile',
      context: { profile: { age: 35 }, freshness: { fresh: true } },
    },
    ...overrides,
  };
}

async function evaluateCandidateOnHoldout(options) {
  const { trustedPublicKey: testKey = trustedPublicKey, ...verifierInput } = options;
  const previousKey = process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
  if (testKey == null) delete process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
  else process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY = String(testKey);
  try {
    return await evaluateCandidateOnHoldoutWithTrustedEnvironment(verifierInput);
  } finally {
    if (previousKey === undefined) delete process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
    else process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY = previousKey;
  }
}

test('trusted signed holdout runs only the sanitized candidate fixture and verifies exact data lineage', async () => {
  const sourceCase = sampleCase();
  let candidateInput;
  const evaluation = await evaluateCandidateOnHoldout({
    candidateId: 'candidate-1',
    trustedPublicKey,
    expectedDatasetHash: hashHoldoutCases([sourceCase]),
    expectedDatasetVersion: datasetVersion,
    loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sourceCase]),
    runner: async ({ caseDefinition }) => {
      candidateInput = caseDefinition;
      return {
        result: { recommendedAction: 'NONE', financialAuthorityDelta: 0, authorityMeasurementState: 'MEASURED' },
        trajectory: [],
      };
    },
  });

  assert.deepEqual(candidateInput, {
    fixture: {
      userId: 'evaluation-user',
      profileId: 'evaluation-profile',
      context: { profile: { age: 35 }, freshness: { fresh: true } },
    },
  });
  assert.equal(evaluation.scoreCards[0].scores.actionCorrect, true);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.holdoutAttestation, 'VERIFIED');
  assert.equal(evaluation.datasetHash, hashHoldoutCases([sourceCase]));
  assert.equal(evaluation.datasetVersion, datasetVersion);
});

test('missing trusted key leaves holdout unverified without loading data or invoking the candidate', async () => {
  let loadCalled = false;
  let runnerCalled = false;
  const evaluation = await evaluateCandidateOnHoldout({
    candidateId: 'candidate-untrusted',
    trustedPublicKey: null,
    loadHoldoutCases: async () => { loadCalled = true; return [sampleCase()]; },
    runner: async () => { runnerCalled = true; return {}; },
  });
  assert.equal(loadCalled, false);
  assert.equal(runnerCalled, false);
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.scoreCards.length, 0);
  assert.equal(evaluation.holdoutAttestation, 'UNVERIFIED');
  assert.equal(evaluation.holdoutFailureCode, 'HOLDOUT_TRUST_KEY_MISSING');
});

test('a caller-supplied key cannot replace the process trust anchor', async () => {
  const previousKey = process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
  delete process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
  let runnerCalled = false;
  try {
    const evaluation = await evaluateCandidateOnHoldoutWithTrustedEnvironment({
      candidateId: 'candidate-untrusted-key-override',
      trustedPublicKey,
      loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sampleCase()]),
      runner: async () => { runnerCalled = true; return {}; },
    });
    assert.equal(evaluation.holdoutAttestation, 'UNVERIFIED');
    assert.equal(evaluation.holdoutFailureCode, 'HOLDOUT_TRUST_KEY_MISSING');
    assert.equal(runnerCalled, false);
  } finally {
    if (previousKey === undefined) delete process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
    else process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY = previousKey;
  }
});

test('one-byte-equivalent case mutation is rejected before candidate execution', async () => {
  const sourceCase = sampleCase();
  const bundle = signedBundleWithCanonicalBytes([sourceCase]);
  bundle.cases[0].fixture.context.profile.age = 36;
  let runnerCalled = false;
  await assert.rejects(
    () => evaluateCandidateOnHoldout({
      candidateId: 'candidate-tampered',
      trustedPublicKey,
      loadHoldoutCases: async () => bundle,
      runner: async () => { runnerCalled = true; return {}; },
    }),
    error => error.code === 'HOLDOUT_ATTESTATION_INVALID',
  );
  assert.equal(runnerCalled, false);
});

test('corrupt signature bytes are rejected before candidate execution', async () => {
  const bundle = signedBundleWithCanonicalBytes([sampleCase()]);
  const bytes = Buffer.from(bundle.attestation.signature, 'base64');
  bytes[0] ^= 0x01;
  bundle.attestation.signature = bytes.toString('base64');
  let runnerCalled = false;
  await assert.rejects(
    () => evaluateCandidateOnHoldout({
      candidateId: 'candidate-corrupt-signature',
      trustedPublicKey,
      loadHoldoutCases: async () => bundle,
      runner: async () => { runnerCalled = true; return {}; },
    }),
    error => error.code === 'HOLDOUT_ATTESTATION_INVALID',
  );
  assert.equal(runnerCalled, false);
});

test('wrong signing key, dataset binding, and unsupported version fail before runner execution', async t => {
  const sourceCase = sampleCase();
  const bundle = signedBundleWithCanonicalBytes([sourceCase]);
  const otherKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' });

  await t.test('wrong key', async () => {
    let called = false;
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-wrong-key', trustedPublicKey: otherKey,
      loadHoldoutCases: async () => bundle,
      runner: async () => { called = true; return {}; },
    }), error => error.code === 'HOLDOUT_ATTESTATION_INVALID');
    assert.equal(called, false);
  });

  await t.test('wrong expected hash', async () => {
    let called = false;
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-wrong-hash', trustedPublicKey,
      expectedDatasetHash: 'f'.repeat(64),
      loadHoldoutCases: async () => bundle,
      runner: async () => { called = true; return {}; },
    }), error => error.code === 'HOLDOUT_ATTESTATION_INVALID');
    assert.equal(called, false);
  });

  await t.test('wrong dataset version', async () => {
    let called = false;
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-wrong-version', trustedPublicKey,
      expectedDatasetVersion: 'other-dataset-version',
      loadHoldoutCases: async () => bundle,
      runner: async () => { called = true; return {}; },
    }), error => error.code === 'HOLDOUT_ATTESTATION_INVALID');
    assert.equal(called, false);
  });
});

test('attestation signer binds case count and only canonical ISO time', () => {
  const sourceCase = sampleCase();
  const payload = buildHoldoutAttestationSigningPayload({
    cases: [sourceCase],
    datasetVersion,
    attestedAt,
    keyId: holdoutPublicKeyId(signer.publicKey),
  });
  assert.equal(payload.claims.schemaVersion, HOLDOUT_ATTESTATION_SCHEMA_VERSION);
  assert.equal(payload.claims.caseCount, 1);
  assert.equal(payload.claims.datasetHash, hashHoldoutCases([sourceCase]));
  assert.equal(crypto.verify(null, payload.signingBytes, signer.publicKey,
    crypto.sign(null, payload.signingBytes, signer.privateKey)), true);
  assert.throws(() => buildHoldoutAttestationSigningPayload({
    cases: [sourceCase], datasetVersion, attestedAt: '2026-09-25T12:00:00Z', keyId: holdoutPublicKeyId(signer.publicKey),
  }), error => error.code === 'HOLDOUT_ATTESTATION_INVALID');
});

test('signed holdout hash canonically binds Dates and rejects non-JSON cycles', () => {
  const dateCase = sampleCase({ fixture: { context: { generatedAt: new Date('2026-09-01T00:00:00.000Z') } } });
  const stringCase = sampleCase({ fixture: { context: { generatedAt: '2026-09-01T00:00:00.000Z' } } });
  assert.equal(hashHoldoutCases([dateCase]), hashHoldoutCases([stringCase]));
  const cyclic = sampleCase();
  cyclic.fixture.context.self = cyclic.fixture.context;
  assert.throws(() => hashHoldoutCases([cyclic]), error => error.code === 'HOLDOUT_DATA_INVALID');
});

test('holdout candidate runner rejects unsigned or structurally invalid bundles before execution', async t => {
  await t.test('unsigned legacy array', async () => {
    let runnerCalled = false;
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-legacy', trustedPublicKey,
      loadHoldoutCases: async () => [sampleCase()],
      runner: async () => { runnerCalled = true; return {}; },
    }), error => error.code === 'HOLDOUT_ATTESTATION_INVALID');
    assert.equal(runnerCalled, false);
  });

  await t.test('missing execution fixture', async () => {
    let runnerCalled = false;
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-no-fixture', trustedPublicKey,
      loadHoldoutCases: async () => signedBundleWithCanonicalBytes([{ partition: 'holdout', expectedAction: 'NONE' }]),
      runner: async () => { runnerCalled = true; return {}; },
    }), error => error.code === 'HOLDOUT_FIXTURE_INVALID');
    assert.equal(runnerCalled, false);
  });

  await t.test('grading label nested in execution fixture', async () => {
    let runnerCalled = false;
    const sourceCase = sampleCase({ fixture: { context: { profile: { age: 35 }, evaluation: { expectedAction: 'PRIVATE_LABEL' } } } });
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-label', trustedPublicKey,
      loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sourceCase]),
      runner: async () => { runnerCalled = true; return {}; },
    }), error => error.code === 'HOLDOUT_FIXTURE_INVALID');
    assert.equal(runnerCalled, false);
  });

  await t.test('alternate expected-outcome label nested in execution fixture', async () => {
    let runnerCalled = false;
    const sourceCase = sampleCase({ fixture: { context: { profile: { age: 35 }, expectedOutcome: 'PRIVATE_LABEL' } } });
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-alternate-label',
      loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sourceCase]),
      runner: async () => { runnerCalled = true; return {}; },
    }), error => error.code === 'HOLDOUT_FIXTURE_INVALID');
    assert.equal(runnerCalled, false);
  });

  await t.test('expected evidence and grading metadata never enter the candidate-visible context', async () => {
    for (const field of ['expectedEvidence', 'gradingNotes', 'graderNotes', 'goldAnswer', 'scoringRubric']) {
      let runnerCalled = false;
      const sourceCase = sampleCase({
        fixture: { context: { profile: { age: 35 }, [field]: 'PRIVATE_GRADING_SENTINEL' } },
      });
      await assert.rejects(() => evaluateCandidateOnHoldout({
        candidateId: `candidate-${field}`,
        loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sourceCase]),
        runner: async () => { runnerCalled = true; return {}; },
      }), error => error.code === 'HOLDOUT_FIXTURE_INVALID', field);
      assert.equal(runnerCalled, false, `${field} must be rejected before candidate execution`);
    }
  });

  await t.test('unknown PlanReview context roots are rejected instead of passed through', async () => {
    let runnerCalled = false;
    const sourceCase = sampleCase({
      fixture: { context: { profile: { age: 35 }, internalNote: 'PRIVATE_CONTEXT_SENTINEL' } },
    });
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-unknown-context-root',
      loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sourceCase]),
      runner: async () => { runnerCalled = true; return {}; },
    }), error => error.code === 'HOLDOUT_FIXTURE_INVALID');
    assert.equal(runnerCalled, false);
  });

  await t.test('missing action oracle rejects before candidate execution', async () => {
    let runnerCalled = false;
    const sourceCase = sampleCase({ expectedAction: null });
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-missing-oracle',
      loadHoldoutCases: async () => signedBundleWithCanonicalBytes([sourceCase]),
      runner: async () => { runnerCalled = true; return {}; },
    }), error => error.code === 'HOLDOUT_DATA_INVALID');
    assert.equal(runnerCalled, false);
  });
});

test('private or non-Ed25519 verifier key is rejected instead of trusted', async () => {
  for (const key of [signer.privateKey.export({ format: 'pem', type: 'pkcs8' }), crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey]) {
    await assert.rejects(() => evaluateCandidateOnHoldout({
      candidateId: 'candidate-invalid-key', trustedPublicKey: key,
      loadHoldoutCases: async () => { throw new Error('must not load'); },
      runner: async () => ({}),
    }), error => error.code === 'HOLDOUT_TRUST_KEY_INVALID');
  }
});
