import { test, describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { processChat } from '../services/geminiChatService.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import ConversationHistory from '../models/ConversationHistory.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const mockUserId = '60d5ecb8b3b3a72d9c8e4a11';
const mockSessionId = 'test-session-2pass';

const mockUser = {
  _id: mockUserId,
  email: 'investor@example.com',
  name: 'Grounded Investor',
};

const mockProfile = {
  _id: '60d5ecb8b3b3a72d9c8e4a33',
  userId: mockUserId,
  ...canonicalProfile({ age: 30, monthlySavings: 20000 }),
};

describe('Phase 3: Two-Pass Tool-Grounded Chat Loop Tests', () => {
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

  it('Two-Pass Execution: Pass 1 requests sip_projection tool, Pass 2 grounds final response in tool result', async () => {
    let callCount = 0;
    let pass2ReceivedToolResult = false;
    let pass1ResponseText = 'Pass 1 ungrounded guess: your SIP might grow to ₹20,00,000.';

    axios.post = async (url, payload) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        callCount++;
        if (callCount === 1) {
          // Pass 1: Emit native function call
          return {
            data: {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: 'sip_projection',
                          args: { monthlyInvestment: 10000, annualRate: 0.12, years: 10 },
                        },
                      },
                    ],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { totalTokenCount: 100 },
            },
          };
        } else {
          // Pass 2: Received history with functionResponse part
          const contents = payload.contents || [];
          const lastTurn = contents[contents.length - 1];
          const hasFunctionResponse = lastTurn?.parts?.some(p => p.functionResponse?.name === 'sip_projection');
          if (hasFunctionResponse) {
            pass2ReceivedToolResult = true;
          }

          return {
            data: {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: 'Based on exact computation, a monthly SIP of ₹10,000 at 12% over 10 years yields a future value of ₹23,23,391.',
                      },
                    ],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { totalTokenCount: 150 },
            },
          };
        }
      }
      throw new Error('Unexpected URL');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Calculate future value of 10000 monthly SIP for 10 years at 12%',
      sessionId: mockSessionId,
    });

    assert.equal(callCount, 2, 'Must execute exactly two passes for tool-grounded query');
    assert.equal(pass2ReceivedToolResult, true, 'Pass 2 must receive tool execution result in conversation history');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs.length, 1);
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[0].result.futureValue, 2323391);
    assert.equal(result.tool_results, undefined, 'Raw tool results must not leak in client DTO');
    assert.match(result.response, /₹23,23,391/);
    assert.notEqual(result.response, pass1ResponseText, 'Pass 2 response must differ from ungrounded Pass 1 text');
  });

  it('Direct Answer Path: General inquiry without tools returns Pass 1 response directly without Pass 2', async () => {
    let callCount = 0;

    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        callCount++;
        return {
          data: {
            candidates: [
              {
                content: {
                  parts: [{ text: 'Equity mutual funds invest in stocks of listed companies.' }],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { totalTokenCount: 80 },
          },
        };
      }
      throw new Error('Unexpected URL');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'What are equity mutual funds?',
      sessionId: mockSessionId,
    });

    assert.equal(callCount, 1, 'Direct non-computational query must complete in Pass 1');
    assert.match(result.response, /invest in stocks/);
    assert.equal(result.tool_results, undefined);
  });

  it('Groq Provider Fallback: Groq executes native tool call and Pass 2 grounding when Gemini fails', async () => {
    let groqCallCount = 0;

    axios.post = async (url, payload) => {
      // Gemini endpoint fails
      if (url.includes('generativelanguage.googleapis.com')) {
        throw new Error('Gemini 500 error');
      }

      // Groq API endpoint
      if (url.includes('api.groq.com')) {
        groqCallCount++;
        if (groqCallCount === 1) {
          // Pass 1: Groq emits tool call using OpenAI tool_calls format
          return {
            data: {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        function: {
                          name: 'sip_projection',
                          arguments: JSON.stringify({ monthlyInvestment: 15000, annualRate: 0.12, years: 10 }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
              usage: { total_tokens: 110 },
            },
          };
        } else {
          // Pass 2: Groq receives tool execution result and generates grounded output
          return {
            data: {
              choices: [
                {
                  message: {
                    content: 'Groq Grounded: Monthly SIP of ₹15,000 grows to ₹34,85,086.',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: { total_tokens: 140 },
            },
          };
        }
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Calculate 15000 monthly SIP for 10 years at 12%',
      sessionId: mockSessionId,
    });

    assert.equal(groqCallCount, 2, 'Groq provider must execute 2 passes when invoked');
    assert.equal(result.provider, 'groq');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs.length, 1);
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[0].result.futureValue, 3485086);
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /Groq Grounded/);
  });

  it('Tool Execution Fault Isolation: processChat recovers cleanly when a tool throws or fails', async () => {
    let callCount = 0;

    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        callCount++;
        if (callCount === 1) {
          return {
            data: {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: 'rebalance_calculator',
                          args: { invalid_param: true }, // Invalid arguments to trigger tool failure
                        },
                      },
                    ],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { totalTokenCount: 90 },
            },
          };
        } else {
          return {
            data: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'I noticed an issue calculating exact rebalance targets, but here is general advice.' }],
                  },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { totalTokenCount: 100 },
            },
          };
        }
      }
      throw new Error('Unexpected URL');
    };

    const result = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Rebalance portfolio with bad inputs',
      sessionId: mockSessionId,
    });

    assert.equal(callCount, 2, 'Pass 2 must run even when tool execution returns failure status');
    const lastSavedModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    assert.equal(lastSavedModelMsg.metadata.tool_outputs.length, 1);
    assert.equal(lastSavedModelMsg.metadata.tool_outputs[0].success, false);
    assert.equal(result.tool_results, undefined);
    assert.match(result.response, /general advice/);
  });
});
