import 'dotenv/config';
import { ProviderManager, NVIDIA_NIM_DEFAULT_BASE_URL, NVIDIA_NIM_DEFAULT_MODEL } from '../services/providerAbstraction.js';
import { buildGroundedEvidencePacket, makeEvidenceEntry } from '../services/groundedEvidence.js';
import { generateGroundedExplanation } from '../services/groundedExplanationService.js';
import { validateGroundedExplanation } from '../services/groundingValidator.js';

function report(label, value) {
  process.stdout.write(`${label}: ${value}\n`);
}

if (!process.env.NVIDIA_API_KEY) {
  report('NIM LIVE QUALIFICATION', 'BLOCKED_MISSING_NVIDIA_API_KEY');
  process.exitCode = 2;
} else {
  const packet = buildGroundedEvidencePacket({
    question: 'Explain this synthetic official rate.',
    profile: null,
    additionalEntries: [makeEvidenceEntry('E_SYNTHETIC_RATE', 'PRODUCT_FACT', {
      name: 'Synthetic Qualification Scheme',
      ratePctPerAnnum: 7.1,
      effectiveFrom: '2026-07-01',
    }, {
      dataClass: 'SYNTHETIC_QUALIFICATION_FACT',
      displayValue: 'Synthetic Qualification Scheme rate is 7.1% p.a. effective 2026-07-01',
      source: { provider: 'SYNTHETIC_QUALIFICATION', url: null, publicationDate: '2026-07-01' },
    })],
    purpose: 'NIM_PROVIDER_QUALIFICATION_NON_SENSITIVE',
  });
  const malicious = {
    text: 'The rate is 99% [E_SYNTHETIC_RATE].',
    evidenceIdsUsed: ['E_SYNTHETIC_RATE'],
    claims: [{ text: 'The rate is 99% [E_SYNTHETIC_RATE].', evidenceIds: ['E_SYNTHETIC_RATE'] }],
    unavailableFacts: [],
  };
  if (validateGroundedExplanation(malicious, packet).valid) {
    report('NIM LIVE QUALIFICATION', 'FAIL_UNSUPPORTED_NUMBER_GUARD');
    process.exitCode = 1;
  } else {
    const startedAt = Date.now();
    const result = await generateGroundedExplanation(
      { question: 'Explain the supplied synthetic rate without adding facts.', evidencePacket: packet },
      { providers: [ProviderManager.nvidia], getCache: async () => null, setCache: async () => false },
    );
    const serialized = JSON.stringify(result);
    const secretAbsent = !serialized.includes(process.env.NVIDIA_API_KEY);
    const pass = result.status === 'GROUNDED_EXPLANATION_AVAILABLE'
      && result.provider === 'NVIDIA_NIM'
      && result.model === (process.env.NVIDIA_NIM_MODEL || NVIDIA_NIM_DEFAULT_MODEL)
      && result.validation.status === 'PASS'
      && result.evidenceIdsUsed.includes('E_SYNTHETIC_RATE')
      && secretAbsent;
    report('NIM LIVE QUALIFICATION', pass ? 'PASS' : 'FAIL');
    report('PROVIDER', result.provider);
    report('MODEL', result.model || 'UNAVAILABLE');
    report('BASE URL', process.env.NVIDIA_NIM_BASE_URL || NVIDIA_NIM_DEFAULT_BASE_URL);
    report('GROUNDING VALIDATION', result.validation.status);
    report('EVIDENCE CITATION', result.evidenceIdsUsed.includes('E_SYNTHETIC_RATE') ? 'PASS' : 'FAIL');
    report('UNSUPPORTED NUMBER REJECTION', 'PASS');
    report('SECRET EXPOSURE', secretAbsent ? 'PASS' : 'FAIL');
    report('LATENCY MS', Date.now() - startedAt);
    if (!pass) {
      report('REASON CODES', (result.validation.reasonCodes || []).join(',') || 'PROVIDER_CONTRACT_FAILED');
      process.exitCode = 1;
    }
  }
}
