import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import FinancialProfile from '../models/FinancialProfile.js';
import { FinancialToolRegistry } from '../services/financialToolRegistry.js';
import { buildMcpResult } from '../mcp/toolPolicy.js';
import { mcpHttpBoundary } from '../mcp/mcpHttpBoundary.js';
import { loadOwnedProfile, validateMcpPayload, WealthGenieMcpServer } from '../mcp/wealthgenieMcpServer.js';

const root = path.resolve(process.cwd(), '..');
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const fixtures = {
  sip_projection: { monthlyInvestment: 10000, annualRate: 0.1, years: 5 },
  lump_sum_projection: { principal: 10000, annualRate: 0.1, years: 5 },
  reverse_sip: { targetAmount: 100000, annualRate: 0.1, years: 5, currentSavings: 0 },
  tax_calculator: {
    income: 1500000, incomeSource: 'salary', fiscalYear: 'FY2026-27', age: 35, regime: 'new',
    section80C: 0, nps80CCD1B: 0, section80D_self: 0, section80D_parents: 0, parentsSenior: false, hra: 0,
  },
  xirr_calculator: { cashflows: [{ amount: -1000, date: '2023-01-01' }, { amount: 1200, date: '2024-01-01' }] },
  portfolio_optimizer: { strategy: 'min_variance', assets: ['FD', 'PPF'] },
  rebalance_calculator: {
    current_allocation: { FD: 60, PPF: 40 }, target_allocation: { FD: 50, PPF: 50 },
    threshold: 5, partial_ratio: 1, holding_months: 12,
  },
};

describe('MCP schema and payload red-team', () => {
  it('fails closed when Host is missing or malformed', () => {
    const boundary = mcpHttpBoundary({ config: {
      isProduction: false,
      allowedHosts: ['localhost'],
      allowedOrigins: [],
    } });
    for (const headers of [{}, { host: 'http://attacker.invalid/path' }]) {
      let statusCode = null;
      let body = null;
      const res = {
        status(code) { statusCode = code; return this; },
        json(value) { body = value; return this; },
      };
      let nextCalled = false;
      boundary({ headers, protocol: 'http' }, res, () => { nextCalled = true; });
      assert.equal(statusCode, 403);
      assert.equal(body.code, 'MCP_HOST_REJECTED');
      assert.equal(nextCalled, false);
    }
  });

  it('publishes Joi-equivalent strict JSON schemas for each explicitly allowed tool', () => {
    const definitions = WealthGenieMcpServer.getToolDefinitions();
    assert.equal(definitions.length, 7);
    for (const { name, parameters } of definitions) {
      const validate = ajv.compile(parameters);
      assert.equal(validate(fixtures[name]), true, `${name} valid fixture: ${JSON.stringify(validate.errors)}`);
      assert.equal(validate({ ...fixtures[name], profileId: 'attacker-selected' }), false, `${name} rejects unlisted fields`);
      const { error } = FinancialToolRegistry.getTool(name).schema.validate({ ...fixtures[name], profileId: 'attacker-selected' });
      assert.ok(error, `${name} Joi contract rejects identity injection`);
    }
    const rebalance = definitions.find(tool => tool.name === 'rebalance_calculator').parameters;
    assert.ok(rebalance.properties.current_allocation.propertyNames.pattern);
    assert.equal(Object.keys(rebalance.properties.current_allocation.properties).length, 0,
      'converter must remove Joi regex placeholder properties');
  });

  it('rejects XIRR cashflows beyond the published count and amount bounds', async () => {
    const tool = FinancialToolRegistry.getTool('xirr_calculator');
    const maximumValid = Array.from({ length: 600 }, (_, index) => ({ amount: index ? 1 : -1, date: `2024-01-${String((index % 28) + 1).padStart(2, '0')}` }));
    assert.equal(Boolean(tool.schema.validate({ cashflows: maximumValid }).error), false);
    const excessiveCount = Array.from({ length: 601 }, (_, index) => ({ amount: index ? 1 : -1, date: `2024-01-${String((index % 28) + 1).padStart(2, '0')}` }));
    assert.ok(tool.schema.validate({ cashflows: excessiveCount }).error);
    assert.ok(tool.schema.validate({ cashflows: [{ amount: -1e13, date: '2023-01-01' }, { amount: 1, date: '2024-01-01' }] }).error);
    for (const date of ['2024-02-30', '2024-01-01T00:00:00Z', 'x'.repeat(10000)]) {
      assert.ok(tool.schema.validate({ cashflows: [{ amount: -1, date: '2023-01-01' }, { amount: 1, date }] }).error, `rejects ${date.slice(0, 20)}`);
    }
    const advertised = WealthGenieMcpServer.getToolDefinitions().find(definition => definition.name === 'xirr_calculator').parameters;
    const validate = ajv.compile(advertised);
    assert.equal(validate({ cashflows: [{ amount: -1, date: '2023-01-01' }, { amount: 1, date: '2024-02-30' }] }), false);
  });

  it('rejects prototype keys, non-finite JSON values, excessive nesting, and oversized strings', () => {
    assert.throws(() => validateMcpPayload(JSON.parse('{"__proto__":{"admin":true}}')), { code: 'MCP_UNSAFE_PROPERTY' });
    assert.throws(() => validateMcpPayload(JSON.parse('{"constructor":{"prototype":{"admin":true}}}')), { code: 'MCP_UNSAFE_PROPERTY' });
    assert.throws(() => validateMcpPayload(JSON.parse('{"value":1e309}')), { code: 'MCP_NON_FINITE_NUMBER' });
    let nested = {};
    for (let i = 0; i < 20; i += 1) nested = { nested };
    assert.throws(() => validateMcpPayload(nested), { code: 'MCP_PAYLOAD_COMPLEXITY_LIMIT' });
    assert.throws(() => validateMcpPayload({ value: 'x'.repeat(8193) }), { code: 'MCP_STRING_LIMIT' });
  });

  it('binds profile-grounded calculations to an owner-scoped canonical snapshot and hash', async () => {
    const profileId = '60d5ecb8b3b3a72d9c8e4a11';
    const ownerId = '60d5ecb8b3b3a72d9c8e4a12';
    const rawProfile = {
      _id: profileId, userId: ownerId, version: 7,
      monthlyTakeHome: 100000, monthlySavings: 20000, age: 35, riskTolerance: 'Moderate',
      hasLumpSum: false, lumpSumAmount: 0, investmentGoals: ['Wealth Growth'], investmentHorizonYears: 12,
    };
    let query;
    const profileModel = {
      findOne(filter) {
        query = filter;
        return { lean: async () => (filter.userId === ownerId ? rawProfile : null) };
      },
    };
    const snapshot = await loadOwnedProfile({ profileId, userId: ownerId, profileModel });
    assert.deepEqual(query, { _id: profileId, userId: ownerId });
    assert.equal(snapshot.version, 7);
    assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.profile.riskTolerance, 'Moderate');
    await assert.rejects(loadOwnedProfile({ profileId, userId: '60d5ecb8b3b3a72d9c8e4a13', profileModel }), {
      code: 'MCP_PROFILE_CONTEXT_NOT_FOUND',
    });
    const missingVersionModel = {
      findOne() { return { lean: async () => ({ ...rawProfile, version: undefined }) }; },
    };
    await assert.rejects(loadOwnedProfile({ profileId, userId: ownerId, profileModel: missingVersionModel }), {
      code: 'MCP_PROFILE_CONTEXT_INVALID',
    });
  });

  it('marks every structured calculator result explicitly non-authoritative', () => {
    const tool = FinancialToolRegistry.getTool('sip_projection');
    const result = buildMcpResult({ toolName: tool.name, tool, result: { classification: 'NON_RECOMMENDATION_WHAT_IF' } });
    const outputSchema = WealthGenieMcpServer.getToolDefinitions()[0].outputSchema;
    assert.equal(ajv.validate(outputSchema, result), true);
    assert.equal(result.authority, 'NON_AUTHORITATIVE');
  });

  it('contains no financial mutation, authority, shell or filesystem interface in the MCP server boundary', () => {
    const source = fs.readFileSync(path.join(root, 'server/mcp/wealthgenieMcpServer.js'), 'utf8');
    for (const forbidden of [
      'Recommendation.create', 'RecommendationState', 'computeCoreRecommendation',
      'persistAdvisoryAtomically', 'FinancialProfile.update', 'Goal.update', 'WebAuthn',
      'child_process', 'exec(', 'spawn(', 'writeFile(', 'mongoose.connection.db',
    ]) assert.equal(source.includes(forbidden), false, `unexpected privileged surface: ${forbidden}`);
    assert.equal(source.includes('profileModel.findOne({ _id: profileId, userId })'), true,
      'the only data access is an owner-scoped profile snapshot read');
    assert.equal(FinancialProfile.modelName, 'FinancialProfile');
  });
});
