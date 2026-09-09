import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { processChat } from '../services/geminiChatService.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import ConversationHistory from '../models/ConversationHistory.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const mockUserId = '60d5ecb8b3b3a72d9c8e4a11';
const mockSessionId = 'test-groq-session';

const mockUser = {
  _id: mockUserId,
  email: 'groqtest@example.com',
  name: 'Groq Test Investor',
};

const mockProfile = {
  _id: '60d5ecb8b3b3a72d9c8e4a22',
  userId: mockUserId,
  ...canonicalProfile({
    age: 35,
    monthlyTakeHome: 150000,
    monthlySavings: 40000,
    riskTolerance: 'Aggressive',
    investmentHorizonYears: 20,
    hasLumpSum: true,
    lumpSumAmount: 1000000,
  }),
};

describe('Groq Provider Native Tool-Calling Integration Tests', () => {
  let originalPost;
  let originalProfileFindOne;
  let originalRecFindOne;
  let originalGoalFind;
  let originalUserFindById;
  let originalConvFindOne;
  let originalNvidiaKey;
  let originalPrimaryProvider;
  let savedMessages = [];

  beforeEach(() => {
    originalPost = axios.post;
    originalProfileFindOne = FinancialProfile.findOne;
    originalRecFindOne = Recommendation.findOne;
    originalGoalFind = Goal.find;
    originalUserFindById = User.findById;
    originalConvFindOne = ConversationHistory.findOne;
    originalNvidiaKey = process.env.NVIDIA_API_KEY;
    originalPrimaryProvider = process.env.LLM_PRIMARY_PROVIDER;
    savedMessages = [];

    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    process.env.GROQ_API_KEY = 'mock-groq-key';
    process.env.NVIDIA_API_KEY = '';
    process.env.LLM_PRIMARY_PROVIDER = 'GEMINI';

    ProviderManager.gemini.recordSuccess();
    ProviderManager.groq.recordSuccess();

    FinancialProfile.findOne = () => ({ sort: () => ({ lean: async () => mockProfile }) });
    Recommendation.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    Goal.find = () => ({ sort: () => ({ lean: async () => [] }) });
    User.findById = () => ({ lean: async () => mockUser });
    ConversationHistory.findOne = async () => ({
      userId: mockUserId,
      session_id: mockSessionId,
      messages: savedMessages,
      save: async function () { return true; },
    });
  });

  afterEach(() => {
    axios.post = originalPost;
    FinancialProfile.findOne = originalProfileFindOne;
    Recommendation.findOne = originalRecFindOne;
    Goal.find = originalGoalFind;
    User.findById = originalUserFindById;
    ConversationHistory.findOne = originalConvFindOne;
    if (originalNvidiaKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalNvidiaKey;
    if (originalPrimaryProvider === undefined) delete process.env.LLM_PRIMARY_PROVIDER; else process.env.LLM_PRIMARY_PROVIDER = originalPrimaryProvider;
  });

  // ── Groq Adapter Unit Tests ──

  it('GroqProviderAdapter parses OpenAI-format tool_calls into normalized { tool, arguments } shape', async () => {
    let groqCallCount = 0;

    axios.post = async (url) => {
      if (url.includes('api.groq.com')) {
        groqCallCount++;
        return {
          data: {
            choices: [{
              message: {
                content: null,
                tool_calls: [
                  {
                    function: {
                      name: 'tax_calculator',
                      arguments: JSON.stringify({ income: 1500000, regime: 'new' }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { total_tokens: 95 },
          },
        };
      }
      throw new Error('Unexpected URL');
    };

    const result = await ProviderManager.groq.generate({
      systemPrompt: 'You are a financial advisor.',
      recentHistory: [{ role: 'user', parts: [{ text: 'Calculate my tax' }] }],
      tools: [{ name: 'tax_calculator', description: 'Tax calc', parameters: { type: 'object' } }],
    });

    assert.equal(groqCallCount, 1);
    assert.equal(result.provider, 'groq');
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].tool, 'tax_calculator');
    assert.deepEqual(result.tool_calls[0].arguments, { income: 1500000, regime: 'new' });
  });

  it('GroqProviderAdapter handles stringified JSON arguments correctly', async () => {
    axios.post = async (url) => {
      if (url.includes('api.groq.com')) {
        return {
          data: {
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  function: {
                    name: 'sip_projection',
                    arguments: '{"monthlyInvestment":25000,"annualRate":0.12,"years":15}',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { total_tokens: 80 },
          },
        };
      }
      throw new Error('Unexpected URL');
    };

    const result = await ProviderManager.groq.generate({
      systemPrompt: 'Test',
      recentHistory: [{ role: 'user', parts: [{ text: 'SIP calc' }] }],
    });

    assert.equal(result.tool_calls[0].arguments.monthlyInvestment, 25000);
    assert.equal(result.tool_calls[0].arguments.annualRate, 0.12);
    assert.equal(result.tool_calls[0].arguments.years, 15);
  });

  it('GroqProviderAdapter handles malformed/unparseable arguments gracefully (defaults to {})', async () => {
    axios.post = async (url) => {
      if (url.includes('api.groq.com')) {
        return {
          data: {
            choices: [{
              message: {
                content: null,
                tool_calls: [{
                  function: {
                    name: 'sip_projection',
                    arguments: 'THIS IS NOT JSON AT ALL',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { total_tokens: 50 },
          },
        };
      }
      throw new Error('Unexpected URL');
    };

    const result = await ProviderManager.groq.generate({
      systemPrompt: 'Test',
      recentHistory: [{ role: 'user', parts: [{ text: 'broken args' }] }],
    });

    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].tool, 'sip_projection');
    assert.deepEqual(result.tool_calls[0].arguments, {}, 'Malformed arguments must default to empty object');
  });

  it('GroqProviderAdapter returns null when GROQ_API_KEY is missing', async () => {
    const savedKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    const result = await ProviderManager.groq.generate({
      systemPrompt: 'Test',
      recentHistory: [],
    });

    assert.equal(result, null, 'Must return null when API key is missing');
    process.env.GROQ_API_KEY = savedKey;
  });

  it('GroqProviderAdapter returns null when circuit breaker is open', async () => {
    // Manually open the circuit breaker
    ProviderManager.groq.failureCount = 3;
    ProviderManager.groq.circuitOpenUntil = Date.now() + 60000;

    const result = await ProviderManager.groq.generate({
      systemPrompt: 'Test',
      recentHistory: [],
    });

    assert.equal(result, null, 'Must return null when circuit is open');
    // Reset for other tests
    ProviderManager.groq.recordSuccess();
  });

  it('GroqProviderAdapter records failure and opens circuit after 3 consecutive HTTP errors', async () => {
    ProviderManager.groq.recordSuccess(); // reset

    axios.post = async () => { throw new Error('Groq 503 Service Unavailable'); };

    await ProviderManager.groq.generate({ systemPrompt: 'test', recentHistory: [] });
    assert.equal(ProviderManager.groq.failureCount, 1);
    assert.equal(ProviderManager.groq.isHealthy(), true);

    await ProviderManager.groq.generate({ systemPrompt: 'test', recentHistory: [] });
    assert.equal(ProviderManager.groq.failureCount, 2);
    assert.equal(ProviderManager.groq.isHealthy(), true);

    await ProviderManager.groq.generate({ systemPrompt: 'test', recentHistory: [] });
    assert.equal(ProviderManager.groq.failureCount, 3);
    assert.equal(ProviderManager.groq.isHealthy(), false, 'Circuit must open after 3 failures');

    // Reset for other tests
    ProviderManager.groq.recordSuccess();
  });

  // ── Groq grounded explanation integration via processChat ──

  it('Groq fallback receives one read-only grounded request with no tool surface', async () => {
    let groqCallCount = 0;
    let requestBody;

    axios.post = async (url, body) => {
      // Gemini fails
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini down');
      }

      if (url.includes('api.groq.com')) {
        groqCallCount++;
        requestBody = body;
        const text = 'The profile age is 35 years [E_PROFILE_AGE].';
        return { data: {
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: JSON.stringify({
            text, evidenceIdsUsed: ['E_PROFILE_AGE'], claims: [{ text, evidenceIds: ['E_PROFILE_AGE'] }], unavailableFacts: [],
          }) }, finish_reason: 'stop' }],
          usage: { total_tokens: 80 },
        } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Explain my age evidence.',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 1);
    assert.equal(requestBody.tools, undefined);
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
    assert.equal(result.provider, 'GROQ');
    assert.equal(result.model, 'openai/gpt-oss-120b');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs, undefined);
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /35 years \[E_PROFILE_AGE\]/);
  });

  it('Groq tool-call-only output is never executed and fails closed', async () => {
    let groqCallCount = 0;

    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini offline');
      }

      if (url.includes('api.groq.com')) {
        groqCallCount++;
        return { data: {
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: null, tool_calls: [{
            function: { name: 'portfolio_optimizer', arguments: '{}' },
          }] }, finish_reason: 'tool_calls' }],
          usage: { total_tokens: 50 },
        } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Calculate my SIP projection and tax',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 1);
    assert.equal(result.provider, 'DETERMINISTIC_TEMPLATE');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs, undefined);
    assert.ok(lastSavedModelMsg.metadata.validation_reason_codes.includes('EMPTY_COMPLETION'));
    assert.equal(result.tool_results, undefined);
  });

  it('Groq direct answer: non-tool query completes in single pass without Pass 2', async () => {
    let groqCallCount = 0;

    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini unreachable');
      }

      if (url.includes('api.groq.com')) {
        groqCallCount++;
        const text = 'The profile age is 35 years [E_PROFILE_AGE].';
        return { data: {
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: JSON.stringify({
            text, evidenceIdsUsed: ['E_PROFILE_AGE'], claims: [{ text, evidenceIds: ['E_PROFILE_AGE'] }], unavailableFacts: [],
          }) }, finish_reason: 'stop' }],
          usage: { total_tokens: 60 },
        } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Explain my age evidence.',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 1, 'Non-tool query must complete in single Groq pass');
    assert.equal(result.provider, 'GROQ');
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /35 years \[E_PROFILE_AGE\]/);
  });
});
