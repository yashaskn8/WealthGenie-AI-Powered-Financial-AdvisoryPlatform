import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FinancialToolRegistry } from '../services/financialToolRegistry.js';

describe('Phase 2: Confused Deputy & Tool Boundary Red-Team Audit', () => {

  describe('1. Prototype Pollution & Object Boundary Probes', () => {
    it('Probe 1.1: Prototype Pollution via __proto__ in rebalance_calculator current_allocation', async () => {
      const maliciousPayload = JSON.parse('{"current_allocation": {"__proto__": 100, "Equity_MF": 50, "Debt_MF": 50}, "target_allocation": {"Equity_MF": 50, "Debt_MF": 50}}');
      
      const beforePollution = ({}).polluted;
      const res = await FinancialToolRegistry.executeTool('rebalance_calculator', maliciousPayload);
      const afterPollution = ({}).polluted;

      // Assert global prototype was not polluted
      assert.equal(beforePollution, undefined);
      assert.equal(afterPollution, undefined);

      // The strict tool boundary rejects polluted objects instead of accepting
      // and attempting to strip them.
      const assets = res.result?.assets || [];
      const hasProtoAsset = assets.some(a => a.asset_class === '__proto__' || a.asset_class === 'constructor');
      assert.equal(hasProtoAsset, false);
      assert.equal(res.success, false);
      assert.match(res.error, /Invalid tool arguments/);
    });

    it('Probe 1.2: Constructor/Prototype Injection in target_allocation is cleanly stripped/rejected', async () => {
      const maliciousPayload = {
        current_allocation: { Equity_MF: 100000 },
        target_allocation: { constructor: 50, prototype: 50 },
      };

      const res = await FinancialToolRegistry.executeTool('rebalance_calculator', maliciousPayload);
      // Sanitizer strips constructor & prototype from target_allocation, resulting in empty target allocation
      const assets = res.result?.assets || [];
      const hasDangerousAsset = assets.some(a => a.asset_class === 'constructor' || a.asset_class === 'prototype');
      assert.equal(hasDangerousAsset, false);
    });
  });

  describe('2. Cross-Tenant Isolation & Parameter Forgery Probes', () => {
    it('Probe 2.1: Attacker attempts to pass forged victim userId into calculation tools', async () => {
      const userAContext = {
        profile: { userId: 'user_A_legitimate_id', annualIncome: 1200000 },
        user: { userId: 'user_A_legitimate_id', email: 'userA@example.com' },
      };

      const forgedArgs = {
        income: 5000000,
        regime: 'new',
        userId: 'victim_user_B_id',
        user_id: 'victim_user_B_id',
        profile_override: { annualIncome: 99999999 },
      };

      const res = await FinancialToolRegistry.executeTool('tax_calculator', forgedArgs, userAContext);
      assert.equal(res.success, false);
      assert.match(res.error, /Invalid tool arguments/);
    });

    it('Probe 2.2: Attacker attempts to extract hidden system metadata via tool argument reflection', async () => {
      const injectionArgs = {
        monthlyInvestment: 10000,
        annualRate: 0.12,
        years: 10,
        __system_secret_probe: 'process.env.JWT_SECRET',
        debug: true,
      };

      const res = await FinancialToolRegistry.executeTool('sip_projection', injectionArgs);
      assert.equal(res.success, false);
      assert.match(res.error, /Invalid tool arguments/);
    });
  });

  describe('3. Adversarial Numeric Boundary & Coercion Probes', () => {
    it('Probe 3.1: Rejects NaN, Infinity, and extreme values in SIP projection', async () => {
      const nanRes = await FinancialToolRegistry.executeTool('sip_projection', {
        monthlyInvestment: NaN,
        annualRate: 0.12,
        years: 10,
      });
      assert.equal(nanRes.success, false);
      assert.match(nanRes.error, /must be a number/);

      const infRes = await FinancialToolRegistry.executeTool('sip_projection', {
        monthlyInvestment: Infinity,
        annualRate: 0.12,
        years: 10,
      });
      assert.equal(infRes.success, false);
    });

    it('Probe 3.2: Rejects XIRR calculation with empty or non-numeric cashflows', async () => {
      const res = await FinancialToolRegistry.executeTool('xirr_calculator', {
        cashflows: [{ amount: 'DROP TABLE', date: 'invalid-date' }],
      });
      assert.equal(res.success, false);
      assert.match(res.error, /Invalid tool arguments/);
    });

    it('Probe 3.3: Portfolio optimizer rejects invalid asset injection and proto keys', async () => {
      const res = await FinancialToolRegistry.executeTool('portfolio_optimizer', {
        strategy: 'min_variance',
        assets: ['Equity_MF', '__proto__', 'constructor'],
      });
      assert.equal(res.success, false);
      assert.match(res.error, /must be one of/);
    });
  });
});
