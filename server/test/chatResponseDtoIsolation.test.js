import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { processChat } from '../services/geminiChatService.js';
import chatRouter from '../routes/chatRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import ConversationHistory from '../models/ConversationHistory.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
  app.use(errorHandler);
  return app;
}

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-wealthgenie-2026';
process.env.JWT_SECRET = JWT_SECRET;

describe('Chat Response DTO vs Audit Persistence Isolation (P0 #4 Bug Fix)', () => {
  const mockUserId = '64b0f0000000000000000001';
  const mockSessionId = 'sess-isolation-001';
  const mockUser = { _id: mockUserId, email: 'isolation@example.com', name: 'Isolation Tester' };
  const mockProfile = {
    _id: '64b0f0000000000000000002',
    userId: mockUserId,
    ...canonicalProfile({
      age: 32,
      monthlyTakeHome: 150000,
      monthlySavings: 50000,
      liquidSavings: 500000,
      investmentHorizonYears: 15,
    }),
  };

  const validToken = jwt.sign({ userId: mockUserId, email: 'isolation@example.com' }, JWT_SECRET, { expiresIn: '1h' });

  let originalPost;
  let originalProfileFindOne;
  let originalRecFindOne;
  let originalGoalFind;
  let originalUserFindById;
  let originalConvFindOne;
  let savedHistoryDocs = [];

  beforeEach(() => {
    originalPost = axios.post;
    originalProfileFindOne = FinancialProfile.findOne;
    originalRecFindOne = Recommendation.findOne;
    originalGoalFind = Goal.find;
    originalUserFindById = User.findById;
    originalConvFindOne = ConversationHistory.findOne;
    savedMessages = [];
    savedHistoryDocs = [];

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
      profileId: mockProfile._id,
      session_id: mockSessionId,
      messages: savedMessages,
      save: async function () {
        savedHistoryDocs.push(this);
        return this;
      },
    });
  });

  let savedMessages = [];

  afterEach(() => {
    axios.post = originalPost;
    FinancialProfile.findOne = originalProfileFindOne;
    Recommendation.findOne = originalRecFindOne;
    Goal.find = originalGoalFind;
    User.findById = originalUserFindById;
    ConversationHistory.findOne = originalConvFindOne;
  });

  it('1. HTTP POST /api/chat/message (Tool Turn): Client DTO strictly omits internal audit fields while MongoDB persists full auditMetadata verbatim', async () => {
    let callCount = 0;
    const rawPreComplianceOutput = 'Pass 2 Raw Output: With a ₹10,000 monthly SIP at 12% for 10 years, your future value will be ₹23,23,391. Guaranteed profit with zero risk.';

    axios.post = async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        callCount++;
        if (callCount === 1) {
          return {
            status: 200,
            data: {
              candidates: [{
                content: {
                  parts: [{
                    functionCall: {
                      name: 'sip_projection',
                      args: { monthlyInvestment: 10000, annualRate: 0.12, years: 10 },
                    },
                  }],
                },
                finishReason: 'STOP',
              }],
              usageMetadata: { totalTokenCount: 110 },
            },
          };
        } else {
          return {
            status: 200,
            data: {
              candidates: [{
                content: {
                  parts: [{ text: rawPreComplianceOutput }],
                },
                finishReason: 'STOP',
              }],
              usageMetadata: { totalTokenCount: 150 },
            },
          };
        }
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    await withServer(buildApp(), async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ message: 'Calculate my 10000 monthly SIP for 10 years at 12%' }),
      });

      assert.equal(res.status, 200);
      const clientBody = await res.json();

      // Explicit Positive Assertions on Client Response Contract
      assert.equal(clientBody.version, '3.0');
      assert.equal(typeof clientBody.response, 'string');
      assert.equal(typeof clientBody.session_id, 'string');
      assert.equal(typeof clientBody.latency_ms, 'number');
      assert.equal(clientBody.grounded, true);
      assert.equal(clientBody.provider, 'gemini');
      assert.equal(typeof clientBody.messages_this_hour, 'number');
      assert.equal(typeof clientBody.rate_limit_remaining, 'number');
      assert.ok(Array.isArray(clientBody.citations));
      assert.ok(Array.isArray(clientBody.action_cards));

      // Explicit Negative Security Assertions: NO internal execution/governance/pre-filtered strings in HTTP response
      assert.equal(clientBody.original_llm_response, undefined, 'Client DTO must NEVER contain raw pre-compliance LLM output');
      assert.equal(clientBody.execution_graph, undefined, 'Client DTO must NOT leak orchestration execution graphs');
      assert.equal(clientBody.tool_outputs, undefined, 'Client DTO must NOT contain raw internal tool outputs');
      assert.equal(clientBody.tool_requests, undefined, 'Client DTO must NOT contain raw tool requests');
      assert.equal(clientBody.tool_calls, undefined, 'Client DTO must NOT contain tool_calls');
      assert.equal(clientBody.tool_results, undefined, 'Client DTO must NOT contain tool_results');
      assert.equal(clientBody.replans, undefined, 'Client DTO must NOT contain replan trace');
      assert.equal(clientBody.replan_count, undefined, 'Client DTO must NOT contain replan count');
      assert.equal(clientBody.governance, undefined, 'Client DTO must NOT contain governance metadata');
      assert.equal(clientBody.verification, undefined, 'Client DTO must NOT contain arithmetic verification metadata');
      assert.equal(clientBody.explainability, undefined, 'Client DTO must NOT contain internal explainability metadata');
      assert.equal(clientBody.audit, undefined, 'Client DTO must NOT contain audit object');
      assert.equal(clientBody.state, undefined, 'Client DTO must NOT contain state machine state');
      assert.equal(clientBody.cumulative_session_tokens, undefined, 'Client DTO must NOT contain cumulative tokens');

      // Persistence Verification: MongoDB conversation history MUST retain the complete audit trail
      assert.equal(savedHistoryDocs.length, 1, 'Exactly one conversation document must be saved to Mongo');
      const savedConv = savedHistoryDocs[0];
      const modelMessage = savedConv.messages.find(m => m.role === 'model');
      assert.ok(modelMessage, 'Model message must be persisted in conversation');

      const savedAudit = modelMessage.metadata;
      assert.ok(savedAudit, 'Persisted model message must retain metadata object');
      assert.equal(savedAudit.original_llm_response, rawPreComplianceOutput, 'Audit record MUST retain raw pre-compliance LLM output for regulatory compliance');
      assert.ok(savedAudit.execution_graph, 'Audit record must retain execution graph');
      assert.ok(Array.isArray(savedAudit.tool_outputs), 'Audit record must retain tool outputs');
      assert.equal(savedAudit.tool_outputs.length, 1);
      assert.equal(savedAudit.tool_outputs[0].result.futureValue, 2323391);
      assert.ok(Array.isArray(savedAudit.tool_requests), 'Audit record must retain tool requests');
      assert.ok(Array.isArray(savedAudit.replans), 'Audit record must retain replan trace array');
      assert.equal(typeof savedAudit.replan_count, 'number');
      assert.ok(savedAudit.governance, 'Audit record must retain governance');
      assert.ok(savedAudit.arithmetic_verification, 'Audit record must retain arithmetic verification');
      assert.ok(savedAudit.timestamp, 'Audit record must retain ISO timestamp');
    });
  });

  it('2. Grounded RAG Return Path: Client receives clean DTO with sanitized citations while Mongo persists full retrieved_chunks and metrics', async () => {
    const rawRagAnswer = 'Under SEBI regulations, mutual funds cannot guarantee returns. Guaranteed returns are strictly non-compliant.';
    const mockRetrievedChunks = [
      { id: 'chunk_101', text: 'SEBI (Mutual Funds) Regulations, 1996 - Section 24', score: 0.94, internal_hash: 'abc123secret' },
    ];
    const mockCitations = [
      { citation_id: 1, document_title: 'SEBI Regulations', source: 'SEBI Circular 2023', chunk_id: 'chunk_101', relevance_score: 0.94, excerpt: 'No guaranteed returns.' },
    ];

    axios.post = async (url) => {
      if (url.includes('/rag/query')) {
        return {
          status: 200,
          data: {
            answer: rawRagAnswer,
            citations: mockCitations,
            retrieved_chunks: mockRetrievedChunks,
            metrics: { total_latency_ms: 120, similarity_threshold: 0.85 },
            grounded: true,
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const res = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'What are the SEBI regulations on guaranteed returns for mutual funds?',
      sessionId: mockSessionId,
    });

    // Client DTO assertions
    assert.equal(res.version, '3.0');
    assert.equal(res.provider, 'rag');
    assert.equal(res.grounded, true);
    assert.match(res.response, /SEBI regulations/i);
    assert.equal(res.citations.length, 1);
    assert.equal(res.citations[0].document_title, 'SEBI Regulations');

    // Negative assertions on RAG Client DTO
    assert.equal(res.original_llm_response, undefined);
    assert.equal(res.execution_graph, undefined);
    assert.equal(res.tool_outputs, undefined);
    assert.equal(res.retrieved_chunks, undefined, 'Client DTO must NOT contain raw retrieved_chunks');
    assert.equal(res.metrics, undefined, 'Client DTO must NOT contain internal RAG metrics');
    assert.equal(res.audit, undefined);
    assert.equal(res.governance, undefined);
    assert.equal(res.verification, undefined);

    // Mongo Persistence assertions
    assert.equal(savedHistoryDocs.length, 1);
    const savedConv = savedHistoryDocs[0];
    const modelMsg = savedConv.messages.find(m => m.role === 'model');
    assert.ok(modelMsg);
    assert.equal(modelMsg.metadata.strategy, 'rag_retrieval');
    assert.equal(modelMsg.metadata.retrieved_chunks.length, 1);
    assert.equal(modelMsg.metadata.retrieved_chunks[0].internal_hash, 'abc123secret');
    assert.equal(modelMsg.metadata.metrics.similarity_threshold, 0.85);
  });

  it('3. Safety Circuit Breaker Return Path: Client receives graceful notice while Mongo logs safety budget termination reason', async () => {
    const exhaustedSession = {
      userId: mockUserId,
      profileId: mockProfile._id,
      session_id: 'exhausted-sess-123',
      messages: [{ role: 'user', content: 'previous turn' }],
      cumulative_tokens: 55000, // Exceeds 50,000 token limit
      save: async function () {
        savedHistoryDocs.push(this);
        return this;
      },
    };

    ConversationHistory.findOne = async () => exhaustedSession;

    const res = await processChat({
      userId: mockUserId,
      user: mockUser,
      message: 'Calculate new complex portfolio advice',
      sessionId: 'exhausted-sess-123',
    });

    // Client DTO assertions
    assert.equal(res.version, '3.0');
    assert.equal(res.provider, 'safety_circuit_breaker');
    assert.match(res.response, /Session Safety Limit Reached/i);

    // Negative assertions on Safety Circuit Breaker DTO
    assert.equal(res.audit, undefined);
    assert.equal(res.safety_limit_reason, undefined, 'Internal safety reason code must not leak in client top-level DTO');
    assert.equal(res.tool_outputs, undefined);
    assert.equal(res.execution_graph, undefined);
    assert.equal(res.cumulative_session_tokens, undefined);

    // Mongo Persistence assertions
    const lastSavedMsg = exhaustedSession.messages[exhaustedSession.messages.length - 1];
    assert.equal(lastSavedMsg.role, 'model');
    assert.equal(lastSavedMsg.metadata.safety_limit_triggered, true);
    assert.equal(lastSavedMsg.metadata.safety_limit_reason, 'SESSION_CUMULATIVE_TOKEN_CAP_EXCEEDED');
    assert.equal(lastSavedMsg.metadata.cumulative_session_tokens, 55000);
  });

  it('4. No Financial Profile Early Return Path: Returns minimal clean response', async () => {
    FinancialProfile.findOne = () => ({ sort: () => ({ lean: async () => null }) });

    const res = await processChat({
      userId: 'user-with-no-profile',
      user: { _id: 'user-with-no-profile', email: 'noprofile@example.com' },
      message: 'Hello',
      sessionId: 'sess-no-profile',
    });

    assert.equal(res.version, '3.0');
    assert.equal(res.grounded, false);
    assert.equal(res.provider, 'system');
    assert.match(res.response, /complete the profile setup/i);
    assert.equal(res.audit, undefined);
    assert.equal(res.execution_graph, undefined);
    assert.equal(res.tool_outputs, undefined);
  });
});
