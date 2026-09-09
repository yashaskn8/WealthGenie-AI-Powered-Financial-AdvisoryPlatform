import { test, describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { processChat } from '../services/geminiChatService.js';
import { ProviderManager, GroqProviderAdapter } from '../services/providerAbstraction.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';
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
  let savedMessages = [];

  beforeEach(() => {
    originalPost = axios.post;
    originalProfileFindOne = FinancialProfile.findOne;
    originalRecFindOne = Recommendation.findOne;
    originalGoalFind = Goal.find;
    originalUserFindById = User.findById;
    originalConvFindOne = ConversationHistory.findOne;
    savedMessages = [];

    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    process.env.GROQ_API_KEY = 'mock-groq-key';

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

  // ── Groq Full Two-Pass End-to-End via processChat ──

  it('Groq two-pass: lump_sum_projection tool call with Pass 2 grounding through processChat', async () => {
    let groqCallCount = 0;

    axios.post = async (url) => {
      // Gemini fails
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini down');
      }

      if (url.includes('api.groq.com')) {
        groqCallCount++;
        if (groqCallCount === 1) {
          return {
            data: {
              choices: [{
                message: {
                  content: null,
                  tool_calls: [{
                    function: {
                      name: 'lump_sum_projection',
                      arguments: JSON.stringify({ principal: 1000000, annualRate: 0.10, years: 5 }),
                    },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { total_tokens: 100 },
            },
          };
        } else {
          return {
            data: {
              choices: [{
                message: {
                  content: 'Groq Grounded: ₹10,00,000 invested at 10% for 5 years grows to ₹16,10,510.',
                },
                finish_reason: 'stop',
              }],
              usage: { total_tokens: 130 },
            },
          };
        }
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'What will 10 lakh grow to in 5 years at 10%?',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 2, 'Groq must execute 2 passes for tool-grounded query');
    assert.equal(result.provider, 'groq');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs.length, 1);
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[0].result.futureValue, 1610510);
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /Groq Grounded/);
  });

  it('Groq two-pass: multiple simultaneous tool calls (sip + tax) are orchestrated correctly', async () => {
    let groqCallCount = 0;

    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini offline');
      }

      if (url.includes('api.groq.com')) {
        groqCallCount++;
        if (groqCallCount === 1) {
          return {
            data: {
              choices: [{
                message: {
                  content: null,
                  tool_calls: [
                    {
                      function: {
                        name: 'sip_projection',
                        arguments: JSON.stringify({ monthlyInvestment: 10000, annualRate: 0.12, years: 10 }),
                      },
                    },
                    {
                      function: {
                        name: 'tax_calculator',
                        arguments: JSON.stringify({
                          income: 2000000,
                          incomeSource: 'salary',
                          fiscalYear: 'FY2026-27',
                          age: 35,
                          regime: 'new',
                          section80C: 0,
                          nps80CCD1B: 0,
                          section80D_self: 0,
                          section80D_parents: 0,
                          parentsSenior: false,
                          hra: 0,
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { total_tokens: 150 },
            },
          };
        } else {
          return {
            data: {
              choices: [{
                message: {
                  content: 'Groq Multi-Tool: SIP grows to ₹23,23,391 and your tax has been computed.',
                },
                finish_reason: 'stop',
              }],
              usage: { total_tokens: 160 },
            },
          };
        }
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Calculate my SIP projection and tax',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 2, 'Groq must execute 2 passes');
    assert.equal(result.provider, 'groq');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs.length, 2, 'Must have 2 tool results');
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[0].tool, 'sip_projection');
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[0].success, true);
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[1].tool, 'tax_calculator');
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[1].success, true);
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
        return {
          data: {
            choices: [{
              message: {
                content: 'Debt mutual funds invest in government and corporate bonds for stable returns.',
              },
              finish_reason: 'stop',
            }],
            usage: { total_tokens: 60 },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'What are debt mutual funds?',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 1, 'Non-tool query must complete in single Groq pass');
    assert.equal(result.provider, 'groq');
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /debt mutual funds|bonds/i);
  });
});
