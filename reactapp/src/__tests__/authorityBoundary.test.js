/* global process */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const source = name => readFileSync(resolve(sourceRoot, name), 'utf8');

describe('frontend financial authority boundary', () => {
  it('does not generate personalized recommendations in the application shell', () => {
    const app = source('App.jsx');
    expect(app).not.toContain('generateRecommendations');
    expect(app).not.toContain('getEligibleInvestments');
    expect(app).toContain('if (!backendRecs) return []');
  });

  it('renders backend recommendation weights instead of computing allocation policy', () => {
    const planner = source('components/AllocationPlanner.jsx');
    expect(planner).not.toContain('computeAllocation');
    expect(planner).not.toContain('getEligibleInvestments');
    expect(planner).toContain('recommendations = []');
  });

  it('uses Express for tax decisions and has no client tax-liability fallback', () => {
    const taxScreen = source('components/TaxScreen.jsx');
    const chat = source('components/GenieChat.jsx');
    expect(taxScreen).toContain('api.compareTax');
    expect(taxScreen).not.toContain('calculateTaxesLocal');
    expect(chat).not.toContain('calculateTaxes(');
    expect(chat).toContain('api.sendChatMessage');
  });

  it('uses Express for personalized product suitability and ordering', () => {
    const whereToInvest = source('components/deepdive/WhereToInvestTab.jsx');
    expect(whereToInvest).toContain('api.rankInvestmentCandidates');
    expect(whereToInvest).not.toContain('rankWhereToInvest(');
    expect(whereToInvest).not.toContain('shouldRecommendETF(');
    expect(whereToInvest).toContain('No provider ranking is shown.');
  });
});
