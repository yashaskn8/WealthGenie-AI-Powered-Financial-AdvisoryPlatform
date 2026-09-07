import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SENSITIVE_MODULES = [
  '../services/RecommendationPipeline.js',
  '../services/riskProfiler.js',
  '../services/explainabilityEngine.js',
  '../services/geminiService.js',
  '../services/geminiChatService.js',
  '../services/genieChatSystemPrompt.js',
  '../services/layeredMemoryManager.js',
  '../services/financialToolRegistry.js',
  '../services/aiToolOrchestrator.js',
  '../services/mlClient.js',
  '../services/mlServiceContract.js',
  '../services/portfolioEngine.js',
  '../mcp/wealthgenieMcpServer.js',
  '../routes/chatRoutes.js',
  '../routes/mcpRouter.js',
  '../routes/recommend.js',
  '../routes/instruments.js',
  '../routes/portfolio.js',
  '../routes/projection.js',
  '../routes/montecarlo.js',
  '../routes/goals.js',
];

const FORBIDDEN_MEMBERS = [
  'income', 'annualIncome', 'annual_income', 'totalCTC', 'total_ctc',
  'basicComponent', 'basic_component', 'taxRegime', 'tax_regime', 'regime',
  'section80C', 'section_80c', 'section80CCD1B', 'section_80ccd1b',
  'section80D_self', 'section80D_parents', 'parentsSenior', 'hra',
  'homeLoanInterest', 'home_loan_interest', 'section80EEA',
  'incomeSource', 'income_source', 'existingDebt', 'existing_debt',
  'goal_type', 'hasGirlChild', 'has_daughter_under_10',
];

const PROFILE_OBJECT_NAMES = [
  'profile', 'canonical', 'profileInput', 'rawProfile', 'storedProfile',
  'userProfile', 'context',
];

test('recommendation-sensitive modules cannot directly consume forbidden profile members', () => {
  const violations = [];
  for (const relativePath of SENSITIVE_MODULES) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    for (const objectName of PROFILE_OBJECT_NAMES) {
      for (const field of FORBIDDEN_MEMBERS) {
        const dotAccess = new RegExp(`\\b${objectName}\\s*(?:\\?\\.)?\\.\\s*${field}\\b`);
        const bracketAccess = new RegExp(`\\b${objectName}\\s*\\[\\s*['\"]${field}['\"]\\s*\\]`);
        if (dotAccess.test(source) || bracketAccess.test(source)) {
          violations.push(`${relativePath}: ${objectName}.${field}`);
        }
      }
    }
    const rawSpread = /\{\s*\.\.\.(?:profile|profileInput|rawProfile|storedProfile|userProfile)\b/;
    if (rawSpread.test(source)) violations.push(`${relativePath}: raw profile spread`);
    for (const objectName of PROFILE_OBJECT_NAMES) {
      const destructuring = new RegExp(
        `\\{[^}]*\\b(?:${FORBIDDEN_MEMBERS.join('|')})\\b[^}]*\\}\\s*=\\s*${objectName}\\b`,
      );
      if (destructuring.test(source)) violations.push(`${relativePath}: forbidden profile destructuring from ${objectName}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('every profile-loading personalized route invokes the canonical boundary', () => {
  const routeModules = [
    '../routes/recommend.js', '../routes/instruments.js', '../routes/portfolio.js',
    '../routes/projection.js', '../routes/montecarlo.js', '../routes/goals.js',
  ];
  for (const relativePath of routeModules) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /buildRecommendationProfile\(/, relativePath);
  }
});
