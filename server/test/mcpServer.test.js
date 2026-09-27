import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WealthGenieMcpServer } from '../mcp/wealthgenieMcpServer.js';
import { FinancialToolRegistry } from '../services/financialToolRegistry.js';

describe('Phase 1: WealthGenie MCP Server Core & Schema Parity Tests', () => {
  it('tools/list: all 7 core tools are present with valid JSON Schema shape', () => {
    const definitions = WealthGenieMcpServer.getToolDefinitions();
    assert.equal(definitions.length, 7);

    const toolNames = definitions.map(d => d.name);
    const expectedTools = [
      'sip_projection',
      'lump_sum_projection',
      'reverse_sip',
      'tax_calculator',
      'xirr_calculator',
      'portfolio_optimizer',
      'rebalance_calculator',
    ];

    for (const expected of expectedTools) {
      assert.ok(toolNames.includes(expected), `Missing expected tool '${expected}' in MCP server list`);
      const def = definitions.find(d => d.name === expected);
      assert.ok(def.description, `Tool '${expected}' must have a description`);
      assert.equal(def.parameters.type, 'object', `Tool '${expected}' JSON schema type must be 'object'`);
      assert.ok(def.parameters.properties, `Tool '${expected}' must define schema properties`);
    }
  });

  it('tools/call: sip_projection execution parity with FinancialToolRegistry', async () => {
    const payload = { monthlyInvestment: 10000, annualRate: 0.12, years: 10 };
    const directResult = await FinancialToolRegistry.executeTool('sip_projection', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('sip_projection', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.equal(mcpResult.result.futureValue, 2323391);
  });

  it('tools/call: lump_sum_projection execution parity with FinancialToolRegistry', async () => {
    const payload = { principal: 500000, annualRate: 0.10, years: 5 };
    const directResult = await FinancialToolRegistry.executeTool('lump_sum_projection', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('lump_sum_projection', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.equal(mcpResult.result.futureValue, 805255);
  });

  it('tools/call: reverse_sip execution parity with FinancialToolRegistry', async () => {
    const payload = { targetAmount: 10000000, annualRate: 0.12, years: 15, currentSavings: 0 };
    const directResult = await FinancialToolRegistry.executeTool('reverse_sip', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('reverse_sip', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.equal(mcpResult.result.requiredMonthlySip, 19705);
  });

  it('tools/call: tax_calculator execution parity with FinancialToolRegistry', async () => {
    const payload = {
      income: 1500000,
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
    };
    const directResult = await FinancialToolRegistry.executeTool('tax_calculator', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('tax_calculator', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.equal(mcpResult.result.regime, 'new');
  });

  it('tools/call: xirr_calculator execution parity with FinancialToolRegistry', async () => {
    const payload = {
      cashflows: [
        { amount: -100000, date: '2023-01-01' },
        { amount: 120000, date: '2024-01-01' },
      ],
    };
    const directResult = await FinancialToolRegistry.executeTool('xirr_calculator', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('xirr_calculator', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.ok(mcpResult.result.rate > 0);
  });

  it('tools/call: portfolio_optimizer execution parity with FinancialToolRegistry', async () => {
    const payload = { strategy: 'min_variance', assets: ['Equity_MF', 'Debt_MF', 'Gold'] };
    const directResult = await FinancialToolRegistry.executeTool('portfolio_optimizer', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('portfolio_optimizer', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.equal(mcpResult.result.strategy, 'min_variance');
  });

  it('tools/call: rebalance_calculator execution parity with FinancialToolRegistry', async () => {
    const payload = {
      current_allocation: { Equity_MF: 70, Debt_MF: 30 },
      target_allocation: { Equity_MF: 50, Debt_MF: 50 },
      threshold: 5.0,
      partial_ratio: 1,
      holding_months: 12,
    };
    const directResult = await FinancialToolRegistry.executeTool('rebalance_calculator', payload);
    const mcpResult = await WealthGenieMcpServer.executeTool('rebalance_calculator', payload);

    assert.equal(mcpResult.success, directResult.success);
    assert.deepEqual(mcpResult.result, directResult.result);
    assert.equal(mcpResult.result.rebalance_recommended, true);
  });

  it('tools/call: unknown tool execution returns error result gracefully without throwing', async () => {
    const mcpResult = await WealthGenieMcpServer.executeTool('non_existent_tool', {});
    assert.equal(mcpResult.success, false);
    assert.match(mcpResult.error, /Unknown tool/i);
  });
});

describe('MCP explicit exposure policy', () => {
  it('does not expose a registry tool that lacks an explicit MCP policy', () => {
    const name = 'private_internal_probe';
    FinancialToolRegistry.registerTool(name, {
      description: 'internal test only',
      schema: FinancialToolRegistry.getTool('sip_projection').schema,
      executor: async () => ({ ok: true }),
    });
    try {
      assert.equal(FinancialToolRegistry.hasTool(name), true);
      assert.equal(FinancialToolRegistry.listMcpTools().some(tool => tool.name === name), false);
      assert.equal(WealthGenieMcpServer.getToolDefinitions().some(tool => tool.name === name), false);
    } finally {
      FinancialToolRegistry.tools.delete(name);
    }
  });

  it('requires explicit read-only, non-mutating policy metadata even for an exposed tool', () => {
    const name = 'unsafe_policy_probe';
    FinancialToolRegistry.registerTool(name, {
      description: 'test-only unsafe metadata',
      schema: FinancialToolRegistry.getTool('sip_projection').schema,
      executor: async () => ({ ok: true }),
      mcpPolicy: {
        exposed: true, authority: 'NON_AUTHORITATIVE', profileContext: 'none',
        costClass: 'LOW', remoteAllowed: true, stdioAllowed: true,
      },
    });
    try {
      assert.equal(FinancialToolRegistry.listMcpTools().some(tool => tool.name === name), false);
    } finally {
      FinancialToolRegistry.tools.delete(name);
    }
  });

  it('does not let an ad-hoc policy bypass the central MCP tool allowlist', () => {
    const name = 'unlisted_but_fully_annotated_probe';
    FinancialToolRegistry.registerTool(name, {
      description: 'test-only rogue MCP registration',
      schema: FinancialToolRegistry.getTool('sip_projection').schema,
      executor: async () => ({ ok: true }),
      mcpPolicy: {
        exposed: true, authority: 'NON_AUTHORITATIVE', readOnly: true, nonMutating: true,
        profileContext: 'none', costClass: 'LOW', remoteAllowed: true, stdioAllowed: true,
      },
    });
    try {
      assert.equal(FinancialToolRegistry.listMcpTools().some(tool => tool.name === name), false);
      assert.equal(WealthGenieMcpServer.getToolDefinitions().some(tool => tool.name === name), false);
    } finally {
      FinancialToolRegistry.tools.delete(name);
    }
  });

  it('marks portfolio-sensitive calculators profile-required and excludes them from stdio', () => {
    const remote = WealthGenieMcpServer.getToolDefinitions();
    assert.equal(remote.find(tool => tool.name === 'portfolio_optimizer').version, '2.1.0');
    assert.equal(FinancialToolRegistry.listMcpTools({ transport: 'stdio' }).some(tool => tool.name === 'portfolio_optimizer'), false);
    assert.equal(FinancialToolRegistry.listMcpTools({ transport: 'stdio' }).some(tool => tool.name === 'rebalance_calculator'), false);
  });
});
