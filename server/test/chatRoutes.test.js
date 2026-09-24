import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import chatRouter from '../routes/chatRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import Goal from '../models/Goal.js';
import ConversationHistory from '../models/ConversationHistory.js';
import User from '../models/User.js';
import { defaultChatSessionStore } from '../services/chatSessionStore.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';
import { installMockChatSessionStore } from './helpers/mockChatSessionStore.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-wealthgenie-2026';
process.env.JWT_SECRET = JWT_SECRET;

const mockUserId = '60d5ecb8b3b3a72d9c8e4a11';
const validToken = jwt.sign({ userId: mockUserId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });

const mockProfile = {
  _id: '60d5ecb8b3b3a72d9c8e4a22',
  userId: mockUserId,
  ...canonicalProfile({ age: 30, monthlySavings: 25000, investmentHorizonYears: 15 }),
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
  app.use(errorHandler);
  return app;
}

describe('Chat Routes Integration & Input Validation Tests', () => {
  let originalProfileFindOne;
  let originalRecFindOne;
  let originalGoalFind;
  let originalConvFindOne;
  let originalUserFindById;
  let restoreChatStore;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    process.env.GROQ_API_KEY = 'mock-groq-key';
    ProviderManager.gemini.recordSuccess();
    ProviderManager.groq.recordSuccess();

    originalProfileFindOne = FinancialProfile.findOne;
    originalRecFindOne = Recommendation.findOne;
    originalGoalFind = Goal.find;
    originalConvFindOne = ConversationHistory.findOne;
    originalUserFindById = User.findById;

    FinancialProfile.findOne = (query) => ({
      sort: () => ({
        lean: async () => (query?.userId === mockUserId ? mockProfile : null),
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

    ConversationHistory.findOne = async (query) => ({
      userId: query?.userId || mockUserId,
      session_id: query?.session_id || 'test-session-123',
      messages: [],
      save: async () => true,
    });
    restoreChatStore = installMockChatSessionStore(async ({ userId, sessionId }) => ({
      userId,
      profileId: mockProfile._id,
      profileVersion: mockProfile.version || 1,
      profileInputHash: null,
      session_id: sessionId,
      messages: [],
      message_sequence: 0,
      session_version: 1,
      cumulative_tokens: 0,
      reserved_tokens: 0,
    }));

    User.findById = (id) => ({
      lean: async () => ({ name: 'Test User', email: 'test@example.com' }),
    });
  });

  afterEach(() => {
    FinancialProfile.findOne = originalProfileFindOne;
    Recommendation.findOne = originalRecFindOne;
    Goal.find = originalGoalFind;
    ConversationHistory.findOne = originalConvFindOne;
    User.findById = originalUserFindById;
    restoreChatStore?.();
  });

  it('POST /api/chat/message rejects unauthenticated request with 401', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });
      assert.equal(res.status, 401);
    });
  });

  it('POST /api/chat/message rejects empty message with 400 Bad Request', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ message: '   ' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error || data.details?.[0], /Validation failed|cannot be empty/);
    });
  });

  it('POST /api/chat/message rejects message exceeding 1000 chars with 400', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const hugeMessage = 'A'.repeat(1001);
      const res = await rawRequest(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ message: hugeMessage }),
      });
      assert.equal(res.status, 400);
    });
  });

  // ── MCP Two-Pass Contract Protocol & Route Coverage ──
  // Cross-Reference: Service-level execution mechanics are tested in server/test/twoPassChatLoop.test.js and server/test/geminiChatService.test.js

  it('POST /api/chat/message responds with 200 and complete V3 contract response shape', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ message: 'What is my optimal tax regime?' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(typeof data.response, 'string');
      assert.equal(typeof data.session_id, 'string');
      assert.equal(data.version, '3.0');
      assert.equal(typeof data.latency_ms, 'number');
      assert.equal(typeof data.grounded, 'boolean');
      assert.ok(Array.isArray(data.citations), 'Response must contain citations array');
      assert.ok(Array.isArray(data.action_cards), 'Response must contain action_cards array');

      // Negative Security Assertions: Internal audit/governance/raw LLM fields MUST NOT leak to client
      assert.equal(data.audit, undefined, 'Response must NOT contain internal audit object');
      assert.equal(data.original_llm_response, undefined, 'Response must NOT contain raw pre-compliance LLM output');
      assert.equal(data.execution_graph, undefined, 'Response must NOT contain internal execution graph');
      assert.equal(data.tool_outputs, undefined, 'Response must NOT contain raw tool outputs');
      assert.equal(data.tool_requests, undefined, 'Response must NOT contain raw tool requests');
      assert.equal(data.tool_calls, undefined, 'Response must NOT contain raw function calling payload');
      assert.equal(data.tool_results, undefined, 'Response must NOT contain raw tool execution results');
      assert.equal(data.governance, undefined, 'Response must NOT contain trace graph governance metadata');
      assert.equal(data.verification, undefined, 'Response must NOT contain internal verification metadata');
      assert.equal(data.explainability, undefined, 'Response must NOT contain internal explainability object');
    });
  });

  it('POST /api/chat/message invokes one grounded read-only generation with no financial tools', async () => {
    const originalGenerate = ProviderManager.gemini.generate;
    const originalNvidia = process.env.NVIDIA_API_KEY;
    const originalPrimary = process.env.LLM_PRIMARY_PROVIDER;
    let callCount = 0;
    let generationArgs;
    process.env.NVIDIA_API_KEY = '';
    process.env.LLM_PRIMARY_PROVIDER = 'GEMINI';
    ProviderManager.gemini.generate = async args => {
      callCount += 1;
      generationArgs = args;
      const text = 'The final suitability ceiling is Moderate [E_PROFILE_RISK].';
      return {
        provider: 'gemini', model: 'gemini-route-test', tokensUsed: 10,
        text: JSON.stringify({
          text,
          evidenceIdsUsed: ['E_PROFILE_RISK'],
          claims: [{ text, evidenceIds: ['E_PROFILE_RISK'] }],
          unavailableFacts: [],
        }),
      };
    };

    try {
      await withServer(buildApp(), async (baseUrl) => {
        const res = await rawRequest(`${baseUrl}/api/chat/message`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${validToken}`,
          },
          body: JSON.stringify({ message: 'Explain my suitability.' }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(callCount, 1);
        assert.equal(generationArgs.tools, null);
        assert.equal(generationArgs.jsonMode, true);
        assert.equal(data.provider, 'GEMINI');
        assert.match(data.response, /Moderate \[E_PROFILE_RISK\]/);
        assert.equal(data.tool_results, undefined, 'Tool results must not leak to client response');
        assert.equal(data.audit, undefined, 'Audit metadata must not leak to client response');
      });
    } finally {
      ProviderManager.gemini.generate = originalGenerate;
      if (originalNvidia === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalNvidia;
      if (originalPrimary === undefined) delete process.env.LLM_PRIMARY_PROVIDER; else process.env.LLM_PRIMARY_PROVIDER = originalPrimary;
    }
  });

  it('DELETE /api/chat/session/:sessionId clears session idempotently', async () => {
    const originalClose = defaultChatSessionStore.close;
    let closedSession;
    defaultChatSessionStore.close = async args => {
      closedSession = args;
      return { session_id: args.sessionId, is_active: false };
    };

    try {
      await withServer(buildApp(), async (baseUrl) => {
        const res = await rawRequest(`${baseUrl}/api/chat/session/sess-123`, {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${validToken}`,
          },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.message, 'Session cleared.');
        assert.deepEqual(closedSession, { userId: mockUserId, sessionId: 'sess-123' });
      });
    } finally {
      defaultChatSessionStore.close = originalClose;
    }
  });
});
