export function createLiveCandidatePlanner({ modelGateway, maxCalls = 32, maxOutputTokens = 256 } = {}) {
  if (!modelGateway || typeof modelGateway.generate !== 'function') {
    throw new TypeError('A live candidate planner model gateway is required.');
  }
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 64
      || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 256) {
    throw new RangeError('Live candidate planner budgets exceed the allowed experiment bounds.');
  }

  let calls = 0;
  return Object.freeze({
    name: 'bounded-live-candidate-planner',
    configuredModel: () => 'configured-nvidia-plan-review',
    get calls() { return calls; },
    async generate(args = {}) {
      if (calls >= maxCalls) {
        const error = new Error('The live candidate planner call budget was exhausted.');
        error.code = 'EVOLUTION_PLANNER_REQUIRED';
        throw error;
      }
      calls += 1;
      const response = await modelGateway.generate({
        role: 'PLANNER',
        systemPrompt: args.systemPrompt,
        recentHistory: args.recentHistory,
        maxTokens: Math.min(maxOutputTokens, Number(args.maxTokens) || maxOutputTokens),
        jsonMode: args.jsonMode,
        signal: args.signal,
      });
      if (typeof response?.text !== 'string' || !response.text.trim()
          || response.routing?.fallback === true) {
        const error = new Error('The configured live candidate planner did not return a model response.');
        error.code = 'EVOLUTION_PLANNER_REQUIRED';
        throw error;
      }
      return response;
    },
  });
}
