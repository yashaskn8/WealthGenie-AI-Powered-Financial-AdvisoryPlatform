import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AIToolOrchestrator } from '../services/aiToolOrchestrator.js';
import { ToolTraceGraph } from '../services/toolTraceGraph.js';

describe('CLAIM 2 — Autonomous Agentic Tool Loops Hardened Verification Suite', () => {

  // ── Step 2: Differential Two-Scenario Causality Test ──────────────────────
  // Identical user query for both scenarios.
  // Differing Hop 1 tool outputs MUST produce DIFFERENT Hop 2 tool choices.
  it('1. Causal Observation: Hop 2 tool selection dynamically branches based on Hop 1 output', async () => {

    const userQuery = 'Optimize my portfolio allocation';

    // ── Scenario A Planner: Hop 1 returns high equity drift (needs rebalancing & tax check)
    const plannerScenarioA = async (history, hopIndex) => {
      if (hopIndex === 1) {
        return {
          responseText: 'Hop 1: Inspecting portfolio drift.',
          toolCalls: [{
            tool: 'rebalance_calculator',
            arguments: {
              current_allocation: { Equity_MF: 700000, Debt_MF: 300000 },
              target_allocation: { Equity_MF: 50, Debt_MF: 50 },
              threshold: 2,
              partial_ratio: 1,
              holding_months: 24,
            },
          }],
          isFinal: false,
        };
      }

      if (hopIndex === 2) {
        const hop1Result = history[0]?.toolResults[0]?.result;
        assert.ok(hop1Result, 'Scenario A: Hop 2 must receive Hop 1 output');

        const correction = Math.abs(hop1Result.assets?.[0]?.suggested_correction || 0);

        // Branch condition: If correction > 10000, calculate tax impact on rebalance
        if (correction > 10000) {
          return {
            responseText: `Hop 2: High drift (₹${correction}) detected. Calculating tax impact.`,
            toolCalls: [{
              tool: 'tax_calculator',
              arguments: {
                income: correction, incomeSource: 'salary', fiscalYear: 'FY2026-27', age: 35, regime: 'new',
                section80C: 0, nps80CCD1B: 0, section80D_self: 0,
                section80D_parents: 0, parentsSenior: false, hra: 0,
              },
            }],
            isFinal: false,
          };
        }

        return {
          responseText: 'Hop 2: No drift. Projecting SIP.',
          toolCalls: [{ tool: 'sip_projection', arguments: { monthlyInvestment: 10000, annualRate: 0.12, years: 10 } }],
          isFinal: false,
        };
      }

      return { responseText: 'Scenario A strategy finalized.', toolCalls: [], isFinal: true };
    };

    // ── Scenario B Planner: Hop 1 returns 0 drift (already balanced, no tax check needed)
    const plannerScenarioB = async (history, hopIndex) => {
      if (hopIndex === 1) {
        return {
          responseText: 'Hop 1: Inspecting portfolio drift.',
          toolCalls: [{
            tool: 'rebalance_calculator',
            arguments: {
              current_allocation: { Equity_MF: 500000, Debt_MF: 500000 }, // Exactly 50/50 target
              target_allocation: { Equity_MF: 50, Debt_MF: 50 },
              threshold: 2,
              partial_ratio: 1,
              holding_months: 24,
            },
          }],
          isFinal: false,
        };
      }

      if (hopIndex === 2) {
        const hop1Result = history[0]?.toolResults[0]?.result;
        assert.ok(hop1Result, 'Scenario B: Hop 2 must receive Hop 1 output');

        const correction = Math.abs(hop1Result.assets?.[0]?.suggested_correction || 0);

        // Same branch logic: If correction <= 10000, switch to sip_projection
        if (correction > 10000) {
          return {
            responseText: `Hop 2: High drift (₹${correction}). Calculating tax.`,
            toolCalls: [{ tool: 'tax_calculator', arguments: {
              income: correction, incomeSource: 'salary', fiscalYear: 'FY2026-27', age: 35, regime: 'new',
              section80C: 0, nps80CCD1B: 0, section80D_self: 0,
              section80D_parents: 0, parentsSenior: false, hra: 0,
            } }],
            isFinal: false,
          };
        }

        return {
          responseText: 'Hop 2: Portfolio is balanced (0 drift). Projecting long-term SIP growth.',
          toolCalls: [{ tool: 'sip_projection', arguments: { monthlyInvestment: 25000, annualRate: 0.12, years: 15 } }],
          isFinal: false,
        };
      }

      return { responseText: 'Scenario B strategy finalized.', toolCalls: [], isFinal: true };
    };

    // Execute Scenario A
    const resultA = await AIToolOrchestrator.orchestrateLoop(plannerScenarioA, {}, 4);
    const hop2ToolCallA = resultA.traceHops[1]?.toolCalls[0]?.tool;

    // Execute Scenario B
    const resultB = await AIToolOrchestrator.orchestrateLoop(plannerScenarioB, {}, 4);
    const hop2ToolCallB = resultB.traceHops[1]?.toolCalls[0]?.tool;

    // DIFFERENTIAL CAUSAL ASSERTION:
    // Hop 2 tool call MUST be different between Scenario A and Scenario B under the identical query!
    assert.equal(hop2ToolCallA, 'tax_calculator', 'Scenario A (high drift) must branch to tax_calculator');
    assert.equal(hop2ToolCallB, 'sip_projection', 'Scenario B (zero drift) must branch to sip_projection');
    assert.notEqual(hop2ToolCallA, hop2ToolCallB,
      `Hop 2 tool choices must differ based on Hop 1 tool results (got ${hop2ToolCallA} vs ${hop2ToolCallB})`);
  });

  // ── Step 3a: Hard Termination Guarantee ───────────────────────────────
  it('2. Enforces hard 4-hop termination guarantee when LLM never signals completion', async () => {
    let attemptedHops = 0;

    const neverEndingPlanner = async (history, hopIndex) => {
      attemptedHops++;
      return {
        responseText: `Hop ${hopIndex}: Requesting more analysis.`,
        toolCalls: [{ tool: 'sip_projection', arguments: { monthlyInvestment: 5000, annualRate: 0.12, years: 5 } }],
        isFinal: false,
      };
    };

    const result = await AIToolOrchestrator.orchestrateLoop(neverEndingPlanner, {}, 4);

    // Attempted hops from planner must be exactly 4 (no 5th call)
    assert.equal(attemptedHops, 4, 'Planner must be invoked exactly 4 times (hard cap)');

    // traceHops contains 4 execution hops + 1 termination step
    assert.equal(result.traceHops.length, 5);

    const lastTrace = result.traceHops[result.traceHops.length - 1];
    assert.equal(lastTrace.decision, 'TERMINATE_MAX_HOPS_FORCED_FINAL');
    assert.ok(result.finalResponse.includes('Completed multi-hop agent execution after 4 hops'));
  });

  // ── Step 3b: Early Termination on Resolution ───────────────────────────
  it('3. Terminates early when resolution is reached on Hop 1 without burning remaining hops', async () => {
    let attemptedHops = 0;

    const earlyPlanner = async (history, hopIndex) => {
      attemptedHops++;
      return {
        responseText: 'Hop 1: Query answered directly from profile context. No tools required.',
        toolCalls: [],
        isFinal: true,
      };
    };

    const result = await AIToolOrchestrator.orchestrateLoop(earlyPlanner, {}, 4);

    assert.equal(attemptedHops, 1, 'Planner must be invoked only 1 time when early resolution occurs');
    assert.equal(result.traceHops.length, 1, 'Trace must contain exactly 1 hop');
    assert.equal(result.traceHops[0].decision, 'FINALIZE');
    assert.equal(result.finalResponse, 'Hop 1: Query answered directly from profile context. No tools required.');
  });

  // ── Step 4: Fully Inspectable Trace Graph ──────────────────────────────
  it('4. Captures structured, inspectable trace graph with per-hop state snapshots', async () => {
    const planner = async (history, hopIndex) => {
      if (hopIndex === 1) {
        return {
          responseText: 'Hop 1: Requesting rebalance.',
          toolCalls: [{
            tool: 'rebalance_calculator',
            arguments: {
              current_allocation: { Equity_MF: 600000, Debt_MF: 400000 },
              target_allocation: { Equity_MF: 50, Debt_MF: 50 },
              threshold: 2,
              partial_ratio: 1,
              holding_months: 24,
            },
          }],
          isFinal: false,
        };
      }
      return { responseText: 'Strategy complete.', toolCalls: [], isFinal: true };
    };

    const loopResult = await AIToolOrchestrator.orchestrateLoop(planner, {}, 4);

    const trace = ToolTraceGraph.buildTraceGraph({
      sessionId: 'sess-inspectable-trace-999',
      userId: 'user-trace-inspect',
      userMessage: 'Rebalance portfolio',
      executionGraph: loopResult.executionGraph,
      responseText: loopResult.finalResponse,
    });

    assert.ok(trace.traceId.startsWith('trace-'));
    assert.match(trace.governance.governanceHash, /^[0-9a-f]{64}$/);
    assert.equal(trace.executionFlow.userQuery, 'Rebalance portfolio');
    assert.ok(Array.isArray(trace.executionFlow.nodes));
    assert.ok(trace.executionFlow.nodeCount > 0);
  });

  // ── Step 5: Adversarial Ping-Pong Pattern Prevention ────────────────────
  it('5. Adversarial Ping-Pong: Prevents infinite loop when planner alternates tool calls', async () => {
    let callCount = 0;

    const pingPongPlanner = async (history, hopIndex) => {
      callCount++;
      const toolToCall = (hopIndex % 2 === 1) ? 'sip_projection' : 'tax_calculator';
      const args = (hopIndex % 2 === 1)
        ? { monthlyInvestment: 10000, annualRate: 0.12, years: 10 }
        : {
          income: 500000, incomeSource: 'salary', fiscalYear: 'FY2026-27', age: 35, regime: 'new',
          section80C: 0, nps80CCD1B: 0, section80D_self: 0,
          section80D_parents: 0, parentsSenior: false, hra: 0,
        };

      return {
        responseText: `Hop ${hopIndex}: Invoking ${toolToCall}`,
        toolCalls: [{ tool: toolToCall, arguments: args }],
        isFinal: false,
      };
    };

    const result = await AIToolOrchestrator.orchestrateLoop(pingPongPlanner, {}, 4);

    assert.equal(callCount, 4, 'Ping-pong loop must be forcibly capped at 4 planner calls');
    assert.equal(result.traceHops.length, 5, '4 execution hops + 1 termination step');
    assert.equal(result.traceHops[4].decision, 'TERMINATE_MAX_HOPS_FORCED_FINAL');
    assert.ok(result.finalResponse.includes('Completed multi-hop agent execution after 4 hops'));
  });
});
