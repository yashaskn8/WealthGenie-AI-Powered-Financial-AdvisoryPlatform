import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundedEvidencePacket, makeEvidenceEntry } from '../services/groundedEvidence.js';
import { generateGroundedExplanation } from '../services/groundedExplanationService.js';

const profile = Object.freeze({
  age: 35,
  monthlySavings: 20000,
  riskTolerance: 'Moderate',
  suitabilityRisk: 'Moderate',
  investmentHorizonYears: 10,
  investmentGoals: ['Wealth Growth'],
  suitabilityReasonCodes: ['PREFERENCE_CAP'],
});

function runHostile(packet, text) {
  const provider = {
    name: 'nvidia_nim',
    configuredModel: () => 'test-model',
    generate: async () => ({
      provider: 'nvidia_nim',
      model: 'test-model',
      text: JSON.stringify({
        text,
        evidenceIdsUsed: [text.match(/\[(E_[A-Z0-9_:-]+)\]/)?.[1] || 'E_PROFILE_RISK'],
        claims: [{
          text,
          evidenceIds: [text.match(/\[(E_[A-Z0-9_:-]+)\]/)?.[1] || 'E_PROFILE_RISK'],
        }],
        unavailableFacts: [],
        proposedAllocation: [{ instrument: 'Bitcoin', weight: 100 }],
      }),
    }),
  };
  return generateGroundedExplanation({ question: 'Explain the authoritative result.', evidencePacket: packet }, {
    providers: [provider], getCache: async () => null, setCache: async () => false,
  });
}

describe('Phase 6 financial-authority isolation', () => {
  it('cannot introduce an instrument or alter authoritative recommendation weights', async () => {
    const recommendation = {
      modelVersion: 'recommendation-test',
      profileInputHash: 'profile-hash',
      instruments: [{ id: 'debt', name: 'Debt Fund', type: 'Debt_MF', allocationWeight: 1, nominalReturn: 7 }],
    };
    const packet = buildGroundedEvidencePacket({ question: 'Explain my recommendation.', profile, recommendation });
    const before = JSON.stringify({ packet, recommendation });
    const result = await runHostile(packet, 'Add Bitcoin to the portfolio [E_REC_001].');
    assert.equal(result.provider, 'DETERMINISTIC_TEMPLATE');
    assert.equal(result.fallback, true);
    assert.doesNotMatch(result.text, /bitcoin/i);
    assert.equal(JSON.stringify({ packet, recommendation }), before);
    assert.deepEqual(recommendation.instruments, [{ id: 'debt', name: 'Debt Fund', type: 'Debt_MF', allocationWeight: 1, nominalReturn: 7 }]);
  });

  it('cannot change profile suitability or deterministic market context', async () => {
    const market = makeEvidenceEntry('E_MARKET_CONTEXT', 'MARKET_CONTEXT', {
      context: 'CAUTIOUS', authorityRole: 'DETERMINISTIC_POLICY_CHAMPION', reasonCodes: ['PRICE_BELOW_MA50'],
    }, { dataClass: 'DETERMINISTIC_POLICY_RESULT', displayValue: 'CAUTIOUS deterministic market context' });
    const packet = buildGroundedEvidencePacket({
      question: 'Explain suitability and context.', profile, additionalEntries: [market],
    });
    const suitability = await runHostile(packet, 'Your suitability is Aggressive [E_PROFILE_RISK].');
    const context = await runHostile(packet, 'The deterministic market context is Normal [E_MARKET_CONTEXT].');
    assert.equal(suitability.provider, 'DETERMINISTIC_TEMPLATE');
    assert.equal(context.provider, 'DETERMINISTIC_TEMPLATE');
    assert.doesNotMatch(suitability.text, /Aggressive/);
    assert.doesNotMatch(context.text, /market context is Normal/i);
    assert.equal(profile.suitabilityRisk, 'Moderate');
    assert.equal(market.value.context, 'CAUTIOUS');
  });

  it('cannot modify tax, official-rate, or projection facts', async () => {
    const entries = [
      makeEvidenceEntry('E_TAX_POLICY', 'TAX', { taxAmount: 12000, policyVersion: 'tax-v1' }, {
        dataClass: 'AUTHORITATIVE_BACKEND_RESULT', displayValue: 'Tax amount INR 12,000 under tax-v1',
      }),
      makeEvidenceEntry('E_GOV_PPF_RATE', 'PRODUCT_FACT', { ratePct: 7.1 }, {
        dataClass: 'QUARTERLY_OFFICIAL_RATE', displayValue: 'PPF official rate 7.1%',
      }),
      makeEvidenceEntry('E_PROJECTION_ASSUMPTION', 'PROJECTION', { annualReturnAssumptionPct: 8, providerForecast: false }, {
        dataClass: 'MODEL_ASSUMPTION', displayValue: 'WealthGenie model return assumption 8%',
      }),
    ];
    const packet = buildGroundedEvidencePacket({ question: 'Explain these facts.', profile, additionalEntries: entries });
    const cases = [
      ['Tax is INR 99,999 [E_TAX_POLICY].', /99,999/],
      ['PPF pays 15% [E_GOV_PPF_RATE].', /15%/],
      ['The projection assumption is 25% [E_PROJECTION_ASSUMPTION].', /25%/],
    ];
    for (const [text, forbidden] of cases) {
      const result = await runHostile(packet, text);
      assert.equal(result.provider, 'DETERMINISTIC_TEMPLATE');
      assert.doesNotMatch(result.text, forbidden);
    }
    assert.deepEqual(entries.map(item => item.value), [
      { taxAmount: 12000, policyVersion: 'tax-v1' },
      { ratePct: 7.1 },
      { annualReturnAssumptionPct: 8, providerForecast: false },
    ]);
  });

  it('cannot promote HMM shadow state or gain an execution channel', async () => {
    const packet = buildGroundedEvidencePacket({
      question: 'Explain HMM.', profile,
      additionalEntries: [makeEvidenceEntry('E_HMM_SHADOW', 'ML_DIAGNOSTIC', {
        state: 'STATE_0', role: 'SHADOW', allocationAuthority: false,
      }, { dataClass: 'SHADOW_DIAGNOSTIC', displayValue: 'STATE_0 shadow diagnostic' })],
    });
    let request;
    const provider = {
      name: 'nvidia_nim', configuredModel: () => 'test-model',
      generate: async args => {
        request = args;
        const text = 'The shadow diagnostic reports STATE_0 [E_HMM_SHADOW].';
        return { provider: 'nvidia_nim', model: 'test-model', text: JSON.stringify({
          text, evidenceIdsUsed: ['E_HMM_SHADOW'], claims: [{ text, evidenceIds: ['E_HMM_SHADOW'] }], unavailableFacts: [],
        }) };
      },
    };
    const result = await generateGroundedExplanation({ question: 'Report the shadow state without interpreting it.', evidencePacket: packet }, {
      providers: [provider], getCache: async () => null, setCache: async () => false,
    });
    assert.equal(result.provider, 'NVIDIA_NIM');
    assert.match(result.text, /STATE_0/);
    assert.doesNotMatch(result.text, /bull|bear|crash|recession/i);
    assert.equal(request.tools, null);
    assert.equal(result.proposedAllocation, undefined);
  });
});
