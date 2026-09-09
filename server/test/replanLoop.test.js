import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundedEvidencePacket } from '../services/groundedEvidence.js';
import { generateGroundedExplanation } from '../services/groundedExplanationService.js';

function packet() {
  return buildGroundedEvidencePacket({
    question: 'Explain suitability.',
    profile: {
      age: 35,
      monthlySavings: 20000,
      riskTolerance: 'Moderate',
      suitabilityRisk: 'Moderate',
      investmentHorizonYears: 10,
      investmentGoals: ['Wealth Growth'],
      suitabilityReasonCodes: ['PREFERENCE_CAP'],
    },
  });
}

function output(value = 'Moderate') {
  const text = `The backend suitability ceiling is ${value} [E_PROFILE_RISK].`;
  return JSON.stringify({
    text,
    evidenceIdsUsed: ['E_PROFILE_RISK'],
    claims: [{ text, evidenceIds: ['E_PROFILE_RISK'] }],
    unavailableFacts: [],
  });
}

const noCache = { getCache: async () => null, setCache: async () => false };

describe('Phase 6 bounded grounded generation', () => {
  it('never exposes tools or starts an LLM-controlled replan loop', async () => {
    let calls = 0;
    let request;
    const provider = {
      name: 'nvidia_nim',
      configuredModel: () => 'test-model',
      generate: async args => {
        calls += 1;
        request = args;
        return { provider: 'nvidia_nim', model: 'test-model', text: output(), tool_calls: [{ tool: 'portfolio_optimizer' }] };
      },
    };
    const result = await generateGroundedExplanation({ question: 'Explain suitability.', evidencePacket: packet() }, {
      providers: [provider], ...noCache,
    });
    assert.equal(calls, 1);
    assert.equal(request.tools, null);
    assert.equal(result.provider, 'NVIDIA_NIM');
    assert.equal(result.validation.status, 'PASS');
    assert.equal(result.toolCalls, undefined);
  });

  it('uses the identical evidence contract when moving to the next provider', async () => {
    const requests = [];
    const first = {
      name: 'nvidia_nim', configuredModel: () => 'nim-test',
      generate: async args => {
        requests.push(args);
        return { provider: 'nvidia_nim', model: 'nim-test', text: output('Aggressive') };
      },
    };
    const second = {
      name: 'gemini', configuredModel: () => 'gemini-test',
      generate: async args => {
        requests.push(args);
        return { provider: 'gemini', model: 'gemini-test', text: output() };
      },
    };
    const result = await generateGroundedExplanation({ question: 'Explain suitability.', evidencePacket: packet() }, {
      providers: [first, second], ...noCache,
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].recentHistory[0].parts[0].text, requests[1].recentHistory[0].parts[0].text);
    assert.equal(result.provider, 'GEMINI');
    assert.equal(result.model, 'gemini-test');
  });

  it('bounds failures to one call per configured provider and then fails closed', async () => {
    let calls = 0;
    const providers = Array.from({ length: 3 }, (_, index) => ({
      name: `provider_${index}`,
      configuredModel: () => `model_${index}`,
      generate: async () => {
        calls += 1;
        return { provider: `provider_${index}`, model: `model_${index}`, text: '{malformed' };
      },
    }));
    const result = await generateGroundedExplanation({ question: 'Explain suitability.', evidencePacket: packet() }, {
      providers, ...noCache,
    });
    assert.equal(calls, 3);
    assert.equal(result.provider, 'DETERMINISTIC_TEMPLATE');
    assert.equal(result.fallback, true);
    assert.ok(result.validation.reasonCodes.includes('MALFORMED_GROUNDED_JSON'));
  });
});
