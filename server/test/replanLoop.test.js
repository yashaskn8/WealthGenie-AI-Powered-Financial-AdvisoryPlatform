import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { processChat } from '../services/geminiChatService.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import FinancialProfile from '../models/FinancialProfile.js';
import User from '../models/User.js';
import ConversationHistory from '../models/ConversationHistory.js';
import Goal from '../models/Goal.js';
import Recommendation from '../models/Recommendation.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

describe('Phase 1: Agentic AI Self-Correction & Replanning Loop Tests', () => {
  const testUserId = '64b0f0000000000000000001';
  const testSessionId = 'replan-test-session-001';

  beforeEach(() => {
    // Mock database models
    FinancialProfile.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          _id: '64b0f0000000000000000002',
          userId: testUserId,
          ...canonicalProfile({
            age: 32,
            monthlyTakeHome: 150000,
            monthlySavings: 45000,
            liquidSavings: 450000,
            investmentHorizonYears: 15,
          }),
        }),
      }),
    });

    User.findById = () => ({
      lean: async () => ({
        _id: testUserId,
        name: 'Rohan Sharma',
        email: 'rohan@example.com',
      }),
    });

    Recommendation.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          recommendedRegime: 'new',
          allocation: { equity: 60, debt: 40 },
          generatedAt: new Date(),
        }),
      }),
    });

    Goal.find = () => ({
      sort: () => ({
        lean: async () => [
          { goal_name: 'Retirement Fund', target_amount: 20000000, target_year: 2040 },
        ],
      }),
    });

    savedMessages = [];
    ConversationHistory.findOne = async () => ({
      userId: testUserId,
      profileId: '64b0f0000000000000000002',
      session_id: testSessionId,
      messages: savedMessages,
      save: async function () { return this; },
    });
  });

  let savedMessages = [];

  it('1. Tool Validation Error Self-Correction: Pass 1 has invalid args, Replan #1 corrects args and succeeds', async () => {
    let passCount = 0;

    ProviderManager.gemini.generate = async ({ recentHistory }) => {
      passCount++;

      if (passCount === 1) {
        // Pass 1: LLM mistakenly sends negative investment or invalid param to sip_projection
        return {
          text: '',
          tool_calls: [
            {
              tool: 'sip_projection',
              arguments: { monthlyInvestment: 50, annualRate: 0.12, years: 10 }, // 50 < min 100
            },
          ],
          tokensUsed: 150,
          provider: 'gemini',
          wasCompleted: true,
        };
      } else if (passCount === 2) {
        // Replan 1: LLM inspects the error in functionResponse and corrects monthlyInvestment to 5000
        const lastTurn = recentHistory[recentHistory.length - 1];
        const errorText = lastTurn.parts?.[0]?.functionResponse?.response?.error || '';
        assert.match(errorText, /monthlyInvestment/);

        return {
          text: '',
          tool_calls: [
            {
              tool: 'sip_projection',
              arguments: { monthlyInvestment: 5000, annualRate: 0.12, years: 10 },
            },
          ],
          tokensUsed: 180,
          provider: 'gemini',
          wasCompleted: true,
        };
      } else {
        // Grounding pass: LLM produces final text
        return {
          text: 'Based on your corrected SIP calculation of ₹5,000/month at 12% for 10 years, your future value will be ₹11.62 Lakhs.',
          tool_calls: [],
          tokensUsed: 220,
          provider: 'gemini',
          wasCompleted: true,
        };
      }
    };

    const res = await processChat({
      userId: testUserId,
      user: { userId: testUserId, email: 'rohan@example.com' },
      message: 'Calculate my SIP growth for ₹5000/month',
      sessionId: testSessionId,
    });

    assert.equal(res.grounded, true);
    assert.equal(res.audit, undefined, 'Client DTO must not leak internal audit metadata');
    const lastModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    const auditMeta = lastModelMsg.metadata;
    assert.equal(auditMeta.replan_count, 1);
    assert.equal(auditMeta.replans.length, 1);
    assert.equal(auditMeta.replans[0].trigger, 'TOOL_FAILURE_CORRECTION');
    assert.equal(auditMeta.tool_outputs.length, 2); // 1 failed + 1 corrected
    assert.equal(auditMeta.tool_outputs[1].success, true);
    assert.match(res.response, /₹11.62 Lakhs|11,61,695/);
  });

  it('2. Reasoning-Driven Replanning: Initial tool succeeds but LLM realizes alternative tool is needed for ambiguous query', async () => {
    let passCount = 0;

    ProviderManager.gemini.generate = async () => {
      passCount++;

      if (passCount === 1) {
        // User asks "I need 1 Crore in 15 years, what SIP is needed?".
        // Pass 1: LLM uses a valid forward projection, then recognizes that
        // reverse_sip is the correct operation for a target-corpus question.
        return {
          text: '',
          tool_calls: [
            {
              tool: 'sip_projection',
              arguments: { monthlyInvestment: 40000, annualRate: 0.12, years: 15 },
            },
          ],
          tokensUsed: 140,
          provider: 'gemini',
          wasCompleted: true,
        };
      } else if (passCount === 2) {
        // Replan 1: Tool succeeded, but LLM reasons: "To find the monthly SIP needed for a 1 Crore goal, I should call reverse_sip instead."
        return {
          text: '',
          tool_calls: [
            {
              tool: 'reverse_sip',
              arguments: { targetAmount: 10000000, annualRate: 0.12, years: 15, currentSavings: 0 },
            },
          ],
          tokensUsed: 190,
          provider: 'gemini',
          wasCompleted: true,
        };
      } else {
        // Grounding pass with reverse_sip calculation
        return {
          text: 'To reach your target corpus of ₹1.00 Crore in 15 years at 12% expected annual return, your required monthly SIP is ₹19,819/month.',
          tool_calls: [],
          tokensUsed: 210,
          provider: 'gemini',
          wasCompleted: true,
        };
      }
    };

    const res = await processChat({
      userId: testUserId,
      user: { userId: testUserId, email: 'rohan@example.com' },
      message: 'I want to accumulate 1 Crore in 15 years. How much monthly SIP do I need?',
      sessionId: testSessionId,
    });

    assert.equal(res.grounded, true);
    assert.equal(res.audit, undefined);
    const lastModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    const auditMeta = lastModelMsg.metadata;
    assert.equal(auditMeta.replan_count, 1);
    assert.equal(auditMeta.replans[0].trigger, 'REASONING_DRIVEN_TOOL_ADJUSTMENT');
    assert.equal(auditMeta.tool_outputs.some(t => t.tool === 'reverse_sip' && t.success), true);
    assert.match(res.response, /₹19,819/);
  });

  it('3. Runaway Prevention: Max replans (MAX_REPLANS=2) caps loop when errors persist', async () => {
    let passCount = 0;

    ProviderManager.gemini.generate = async () => {
      passCount++;
      // Continuously request invalid tools/args
      return {
        text: passCount > 2 ? 'I attempted to calculate this multiple times but encountered repeated parameter errors.' : '',
        tool_calls: [
          {
            tool: 'sip_projection',
            arguments: { monthlyInvestment: -100, annualRate: 2.5, years: 0 }, // invalid
          },
        ],
        tokensUsed: 100,
        provider: 'gemini',
        wasCompleted: true,
      };
    };

    const res = await processChat({
      userId: testUserId,
      user: { userId: testUserId, email: 'rohan@example.com' },
      message: 'Bad calculation request',
      sessionId: testSessionId,
    });

    assert.equal(res.audit, undefined);
    const lastModelMsg = savedMessages.filter(m => m.role === 'model').slice(-1)[0];
    const auditMeta = lastModelMsg.metadata;
    assert.equal(auditMeta.replan_count, 2);
    assert.equal(auditMeta.safety_limit_triggered, true);
    assert.equal(auditMeta.safety_limit_reason, 'MAX_REPLANS_EXHAUSTED_WITH_FAILURES');
    assert.match(res.response, /Session Safety Limit Notice/);
  });
});
