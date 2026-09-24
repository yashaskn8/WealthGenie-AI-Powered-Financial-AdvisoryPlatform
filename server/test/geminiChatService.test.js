import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { processChat } from '../services/geminiChatService.js';
import { AIToolOrchestrator } from '../services/aiToolOrchestrator.js';
import { ConversationStateMachine, CONVERSATION_STATES } from '../services/conversationStateMachine.js';
import { LayeredMemoryManager } from '../services/layeredMemoryManager.js';
import { ExplainabilityEngine } from '../services/explainabilityEngine.js';
import { ToolTraceGraph, promptVersion } from '../services/toolTraceGraph.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import ConversationHistory from '../models/ConversationHistory.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';
import { installMockChatSessionStore } from './helpers/mockChatSessionStore.js';

const mockUserId = '60d5ecb8b3b3a72d9c8e4a11';
const mockSessionId = 'test-session-123';

const mockUser = {
  _id: mockUserId,
  email: 'test@example.com',
  name: 'Test Investor',
};

const mockProfile = {
  _id: '60d5ecb8b3b3a72d9c8e4a22',
  userId: mockUserId,
  ...canonicalProfile({
    age: 32,
    monthlySavings: 30000,
    investmentHorizonYears: 15,
    hasLumpSum: true,
    lumpSumAmount: 500000,
  }),
};

function groundedGeminiPayload(text = 'The final suitability ceiling is Moderate [E_PROFILE_RISK].') {
  return {
    data: {
      modelVersion: 'gemini-runtime-test',
      candidates: [{
        content: { parts: [{ text: JSON.stringify({
          text,
          evidenceIdsUsed: ['E_PROFILE_RISK'],
          claims: [{ text, evidenceIds: ['E_PROFILE_RISK'] }],
          unavailableFacts: [],
        }) }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { totalTokenCount: 50 },
    },
  };
}

describe('GenieChat V3 Enterprise Architecture Tests', () => {
  let originalPost;
  let originalProfileFindOne;
  let originalRecFindOne;
  let originalGoalFind;
  let originalUserFindById;
  let originalConvFindOne;
  let originalEnvGemini;
  let originalEnvGroq;
  let originalEnvNvidia;
  let originalPrimaryProvider;
  let savedMessages = [];
  let restoreChatStore;

  beforeEach(() => {
    originalPost = axios.post;
    originalProfileFindOne = FinancialProfile.findOne;
    originalRecFindOne = Recommendation.findOne;
    originalGoalFind = Goal.find;
    originalUserFindById = User.findById;
    originalConvFindOne = ConversationHistory.findOne;
    originalEnvGemini = process.env.GEMINI_API_KEY;
    originalEnvGroq = process.env.GROQ_API_KEY;
    originalEnvNvidia = process.env.NVIDIA_API_KEY;
    originalPrimaryProvider = process.env.LLM_PRIMARY_PROVIDER;
    savedMessages = [];

    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    process.env.GROQ_API_KEY = 'mock-groq-key';
    process.env.NVIDIA_API_KEY = '';
    process.env.LLM_PRIMARY_PROVIDER = 'GEMINI';

    // Reset circuit breakers
    ProviderManager.gemini.recordSuccess();
    ProviderManager.groq.recordSuccess();

    // Mock DB queries
    FinancialProfile.findOne = () => ({
      sort: () => ({
        lean: async () => mockProfile,
      }),
    });

    Recommendation.findOne = () => ({
      sort: () => ({
        lean: async () => null,
      }),
    });

    Goal.find = () => ({
      sort: () => ({
        lean: async () => [],
      }),
    });

    User.findById = () => ({
      lean: async () => mockUser,
    });

    ConversationHistory.findOne = async () => ({
      userId: mockUserId,
      session_id: mockSessionId,
      messages: savedMessages,
      save: async function () {
        return true;
      },
    });
    restoreChatStore = installMockChatSessionStore(async () => ({
      userId: mockUserId,
      profileId: mockProfile._id,
      profileVersion: 1,
      profileInputHash: null,
      messages: savedMessages,
      cumulative_tokens: 0,
    }));
  });

  afterEach(() => {
    restoreChatStore?.();
    axios.post = originalPost;
    FinancialProfile.findOne = originalProfileFindOne;
    Recommendation.findOne = originalRecFindOne;
    Goal.find = originalGoalFind;
    User.findById = originalUserFindById;
    ConversationHistory.findOne = originalConvFindOne;
    if (originalEnvGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalEnvGemini;
    if (originalEnvGroq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalEnvGroq;
    if (originalEnvNvidia === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalEnvNvidia;
    if (originalPrimaryProvider === undefined) delete process.env.LLM_PRIMARY_PROVIDER; else process.env.LLM_PRIMARY_PROVIDER = originalPrimaryProvider;
  });

  it('Provider Abstraction & Fallback: ProviderManager executes Gemini adapter', async () => {
    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return groundedGeminiPayload();
      }
      throw new Error('Unexpected URL');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Rebalance portfolio',
      sessionId: mockSessionId,
    });

    assert.equal(result.version, '3.0');
    assert.equal(result.provider, 'GEMINI');
    assert.equal(result.model, 'gemini-runtime-test');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.validation_status, 'PASS');
    assert.deepEqual(lastSavedModelMsg.metadata.evidence_ids_used, ['E_PROFILE_RISK', 'E_REGULATORY_NOTICE']);
    assert.equal(lastSavedModelMsg.metadata.tool_outputs, undefined);
    assert.equal(result.explainability, undefined);
    assert.equal(result.governance, undefined);
    assert.match(result.response, /Moderate \[E_PROFILE_RISK\]/);
  });

  it('Phase 1: AIToolOrchestrator resolves parallel tool calls in a DAG graph', async () => {
    const toolRequests = [
      { tool: 'sip_projection', arguments: { monthlyInvestment: 10000, annualRate: 0.12, years: 10 } },
      { tool: 'lump_sum_projection', arguments: { principal: 500000, annualRate: 0.10, years: 5 } },
    ];

    const orchestration = await AIToolOrchestrator.orchestrate(toolRequests, { profile: mockProfile });
    assert.equal(orchestration.toolResults.length, 2);
    assert.equal(orchestration.executionGraph.status, 'SUCCESS');
    assert.equal(orchestration.toolResults[0].success, true);
    assert.equal(orchestration.toolResults[1].success, true);
  });

  it('Phase 3: ConversationStateMachine tracks explicit state transitions', () => {
    const state1 = ConversationStateMachine.transition(CONVERSATION_STATES.IDLE, { hasTools: true });
    assert.equal(state1.nextState, CONVERSATION_STATES.EXECUTING_TOOLS);

    const state2 = ConversationStateMachine.transition(CONVERSATION_STATES.IDLE, { isFallback: true });
    assert.equal(state2.nextState, CONVERSATION_STATES.FALLBACK);
  });

  it('Phase 4 & 5: LayeredMemoryManager constructs context dynamically without dumping full raw history', () => {
    const memory = LayeredMemoryManager.buildRetrievedContext('SIP planning', mockProfile, [], null, []);
    assert.equal(memory.profileMemory.age, 32);
    assert.equal(memory.preferenceMemory.riskTolerance, 'Moderate');
    assert.equal(memory.preferenceMemory.taxRegime, undefined);

    const formattedPrompt = LayeredMemoryManager.formatForPrompt(memory);
    assert.match(formattedPrompt, /"age":\s*32/);
  });

  it('Phase 6: ExplainabilityEngine produces deterministic non-hallucinated explanations', () => {
    const explanation = ExplainabilityEngine.generateExplanation(
      mockProfile,
      [{ tool: 'sip_projection', success: true, result: {} }],
      { verification_status: 'verified' }
    );

    assert.equal(explanation.arithmeticVerificationStatus, 'verified');
    assert.ok(explanation.financialEnginesUsed.includes('projectionEngine.sipFV'));
    assert.match(explanation.riskDisclosure, /market risks/i);
  });

  it('Phase 7 & 16: ToolTraceGraph & AI Governance calculate SHA-256 reproducibility hashes', () => {
    const trace = ToolTraceGraph.buildTraceGraph({
      sessionId: mockSessionId,
      userId: mockUserId,
      userMessage: 'Test query',
      stateTransition: { nextState: 'ExecutingTools' },
      provider: 'gemini',
      responseText: 'Financial output string.',
    });

    assert.ok(trace.traceId.startsWith('trace-'));
    assert.ok(trace.governance.governanceHash);
    assert.equal(trace.governance.promptVersion, promptVersion.version);
  });

  it('Phase 9 & 14: Provider Circuit Breaker opens after 3 consecutive failures', async () => {
    axios.post = async () => {
      throw new Error('500 Internal Server Error');
    };

    // 3 failures
    await ProviderManager.gemini.generate({ systemPrompt: 'test', recentHistory: [] });
    await ProviderManager.gemini.generate({ systemPrompt: 'test', recentHistory: [] });
    await ProviderManager.gemini.generate({ systemPrompt: 'test', recentHistory: [] });

    assert.equal(ProviderManager.gemini.isHealthy(), false);
  });

  it('Phase 6: processChat performs one read-only grounded call and exposes no tool surface', async () => {
    let callCount = 0;
    let requestBody;
    axios.post = async (url, body) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        callCount += 1;
        requestBody = body;
        return groundedGeminiPayload();
      }
      throw new Error('Unexpected URL');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Explain my suitability.',
      sessionId: mockSessionId,
    });

    assert.equal(callCount, 1);
    assert.equal(requestBody.tools, undefined);
    assert.equal(requestBody.generationConfig.responseMimeType, 'application/json');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs, undefined);
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /Moderate \[E_PROFILE_RISK\]/);
  });

  it('Phase 6: processChat accepts only structured cited provider output', async () => {
    let callCount = 0;
    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        callCount++;
        return groundedGeminiPayload();
      }
      throw new Error('Unexpected URL');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'What is diversification?',
      sessionId: mockSessionId,
    });

    assert.equal(callCount, 1);
    assert.equal(result.tool_results, undefined);
    assert.equal(result.validation_status, 'PASS');
    assert.match(result.response, /\[E_PROFILE_RISK\]/);
  });

  it('Phase 6: provider failure returns a deterministic evidence-backed fallback', async () => {
    axios.post = async () => {
      throw new Error('All LLM endpoints down');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Rebalance portfolio advice',
      sessionId: mockSessionId,
    });

    assert.equal(result.provider, 'DETERMINISTIC_TEMPLATE');
    assert.equal(result.fallback, true);
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /authoritative backend reports/i);
    assert.match(result.response, /\[E_PROFILE_RISK\]/);
  });
});
