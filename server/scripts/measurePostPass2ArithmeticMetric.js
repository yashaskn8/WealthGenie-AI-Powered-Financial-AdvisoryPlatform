import express from 'express';
import jwt from 'jsonwebtoken';
import chatRouter from '../routes/chatRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import ConversationHistory from '../models/ConversationHistory.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-wealthgenie-2026';
process.env.JWT_SECRET = JWT_SECRET;

const mockUserId = '60d5ecb8b3b3a72d9c8e4a11';
const validToken = jwt.sign({ userId: mockUserId, email: 'investor@example.com' }, JWT_SECRET, { expiresIn: '1h' });

const mockUser = { _id: mockUserId, email: 'investor@example.com', name: 'Falsifiable Investor' };
const mockProfile = {
  _id: '60d5ecb8b3b3a72d9c8e4a33',
  userId: mockUserId,
  age: 32,
  monthlyTakeHome: 150000,
  monthlySavings: 35000,
  riskTolerance: 'Moderate',
  soldPropertyProceeds: 0,
  hasLumpSum: false,
  lumpSumAmount: 0,
  liquidSavings: 500000,
  emiBurdenPct: 10,
  financialDependents: 1,
  emergencyFundMonths: 6,
  investmentGoals: ['Wealth Growth'],
  investmentHorizonYears: 15,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
  app.use(errorHandler);
  return app;
}

// DB Mocks
FinancialProfile.findOne = () => ({ sort: () => ({ lean: async () => mockProfile }) });
Recommendation.findOne = () => ({ sort: () => ({ lean: async () => null }) });
Goal.find = () => ({ sort: () => ({ lean: async () => [] }) });
User.findById = () => ({ lean: async () => mockUser });
ConversationHistory.findOne = async (query) => ({
  userId: mockUserId,
  session_id: query?.session_id || 'test-session-falsifiable',
  messages: [],
  save: async () => true,
});

process.env.GEMINI_API_KEY = 'mock-gemini-key';
process.env.GROQ_API_KEY = 'mock-groq-key';

async function runFalsifiableMetricMeasurement() {
  console.log('================================================================');
  console.log('FALSIFIABLE POST-PASS-2 ARITHMETIC METRIC MEASUREMENT (HTTP Route)');
  console.log('================================================================\n');

  // Reset Prometheus counters before test
  PrometheusMetrics.counters.arithmetic_corrections_post_pass2_total = 0;
  PrometheusMetrics.counters.tool_execution_total = 0;
  PrometheusMetrics.counters.tool_execution_success_total = 0;
  PrometheusMetrics.counters.tool_execution_failure_total = 0;
  PrometheusMetrics.toolUsage = {};

  ProviderManager.gemini.recordSuccess();
  ProviderManager.groq.recordSuccess();

  const originalPost = (await import('axios')).default.post;

  let requestIndex = 0;
  let matchingTurnsCount = 0;
  let mismatchedTurnsCount = 0;

  await withServer(buildApp(), async (baseUrl) => {
    // We will make 30 requests total over HTTP POST /api/chat/message
    // Turns 1-20: LLM Pass 2 emits ACCURATE numbers matching tool results.
    // Turns 21-30: LLM Pass 2 emits INTENTIONALLY MISMATCHED numbers to test metric increment on divergence!

    for (let i = 1; i <= 30; i++) {
      requestIndex = i;
      const isMismatched = i > 20; // Turns 21-30 emit mismatched numbers to test metric falsifiability!
      let callCount = 0;

      if (isMismatched) {
        mismatchedTurnsCount++;
      } else {
        matchingTurnsCount++;
      }

      (await import('axios')).default.post = async (url) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          callCount++;
          if (callCount === 1) {
            // Pass 1: Emit native function calls based on request type
            if (requestIndex % 3 === 1) {
              return {
                data: {
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            functionCall: {
                              name: 'sip_projection',
                              args: { monthlyInvestment: 25000, annualRate: 0.12, years: 15 },
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
            } else if (requestIndex % 3 === 2) {
              return {
                data: {
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            functionCall: {
                              name: 'tax_calculator',
                              args: {
                                income: 1800000,
                                incomeSource: 'salary',
                                age: 32,
                                regime: 'new',
                                section80C: 0,
                                nps80CCD1B: 0,
                                section80D_self: 0,
                                section80D_parents: 0,
                                parentsSenior: false,
                                hra: 0,
                              },
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
              return {
                data: {
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            functionCall: {
                              name: 'rebalance_calculator',
                              args: {
                                current_allocation: { Equity_MF: 70, Debt_MF: 30 },
                                target_allocation: { Equity_MF: 50, Debt_MF: 50 },
                                threshold: 5,
                                partial_ratio: 1,
                                holding_months: 12,
                              },
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
            }
          } else {
            // Pass 2: Emit grounded text response
            if (!isMismatched) {
              // Accurate numbers matching tool calculation outputs
              if (requestIndex % 3 === 1) {
                return {
                  data: {
                    candidates: [
                      {
                        content: {
                          parts: [{ text: 'Based on exact calculation, your monthly SIP of ₹25,000 for 15 years at 12% annual return will accumulate to ₹12,614,400.' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                    usageMetadata: { totalTokenCount: 140 },
                  },
                };
              } else if (requestIndex % 3 === 2) {
                return {
                  data: {
                    candidates: [
                      {
                        content: {
                          parts: [{ text: 'Your calculated tax payable under the new regime is ₹150,800 on a taxable income of ₹1,725,000.' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                    usageMetadata: { totalTokenCount: 140 },
                  },
                };
              } else {
                return {
                  data: {
                    candidates: [
                      {
                        content: {
                          parts: [{ text: 'Rebalance recommended: reduce Equity_MF by 20% to reach 50% target allocation.' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                    usageMetadata: { totalTokenCount: 140 },
                  },
                };
              }
            } else {
              // Intentionally Mismatched Numbers to verify metric falsifiability!
              if (requestIndex % 3 === 1) {
                return {
                  data: {
                    candidates: [
                      {
                        content: {
                          parts: [{ text: 'Based on exact calculation, your monthly SIP of ₹25,000 for 15 years at 12% annual return will accumulate to ₹99,999,999.' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                    usageMetadata: { totalTokenCount: 140 },
                  },
                };
              } else if (requestIndex % 3 === 2) {
                return {
                  data: {
                    candidates: [
                      {
                        content: {
                          parts: [{ text: 'Your calculated tax payable under the new regime is ₹50,000.' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                    usageMetadata: { totalTokenCount: 140 },
                  },
                };
              } else {
                return {
                  data: {
                    candidates: [
                      {
                        content: {
                          parts: [{ text: 'Rebalance recommended: reduce Equity_MF by 99% to reach target allocation.' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                    usageMetadata: { totalTokenCount: 140 },
                  },
                };
              }
            }
          }
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      // Execute request over HTTP wire
      const messageText = requestIndex % 3 === 1
        ? `Calculate SIP projection ${i}`
        : requestIndex % 3 === 2
        ? `Compute tax for income ${i}`
        : `Optimize portfolio strategy ${i}`;

      const res = await rawRequest(`${baseUrl}/api/chat/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ message: messageText, session_id: `http-session-${i}` }),
      });

      if (res.status !== 200) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
    }
  });

  (await import('axios')).default.post = originalPost;

  const snapshot = PrometheusMetrics.getSnapshotJSON();
  const postPass2Metric = snapshot.counters.arithmetic_corrections_post_pass2_total;
  const toolExecTotal = snapshot.counters.tool_execution_total;

  console.log('----------------------------------------------------------------');
  console.log('FALSIFIABLE METRIC MEASUREMENT RESULTS');
  console.log('----------------------------------------------------------------');
  console.log(`Total HTTP Chat Requests        : 30`);
  console.log(`Matching Output Turns           : ${matchingTurnsCount}`);
  console.log(`Mismatched Output Turns         : ${mismatchedTurnsCount}`);
  console.log(`tool_execution_total Counter    : ${toolExecTotal}`);
  console.log(`arithmetic_corrections_post_pass2_total: ${postPass2Metric}`);
  console.log('----------------------------------------------------------------');
  console.log('PROMETHEUS METRICS SNAPSHOT JSON:');
  console.log(JSON.stringify(snapshot, null, 2));
  console.log('================================================================');
}

runFalsifiableMetricMeasurement().catch(err => {
  console.error('[Falsifiable Measurement Failed]:', err);
  process.exit(1);
});
