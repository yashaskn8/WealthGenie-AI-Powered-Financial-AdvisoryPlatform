export const EVOLUTION_HARD_BUDGETS = Object.freeze({
  maxGenerations: 3,
  maxCandidates: 12,
  maxReflectionCalls: 12,
  maxMetricCalls: 1000,
  maxSandboxRuns: 20,
  maxSandboxMinutes: 60,
  maxTotalTokens: 15000,
});

export function createEvolutionBudget(requested = {}) {
  const budget = {};
  for (const [key, hardMaximum] of Object.entries(EVOLUTION_HARD_BUDGETS)) {
    const value = requested[key] === undefined ? hardMaximum : Number(requested[key]);
    if (!Number.isInteger(value) || value < 0 || value > hardMaximum) {
      const error = new Error(`Evolution budget ${key} exceeds its immutable maximum.`);
      error.code = 'EVOLUTION_BUDGET_REJECTED';
      throw error;
    }
    budget[key] = value;
  }
  return Object.freeze(budget);
}
