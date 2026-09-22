import { ProviderManager } from '../services/providerAbstraction.js';

export const MODEL_ROLES = Object.freeze(['PLANNER', 'EXPLAINER', 'VERIFIER', 'EVOLUTION_RESEARCH']);

function configuredOrder() {
  const primary = String(process.env.LLM_PRIMARY_PROVIDER || 'NVIDIA_NIM').trim().toUpperCase();
  const table = { NVIDIA_NIM: ProviderManager.nvidia, GEMINI: ProviderManager.gemini, GROQ: ProviderManager.groq };
  return [table[primary], ProviderManager.nvidia, ProviderManager.gemini, ProviderManager.groq].filter((item, index, list) => item && list.indexOf(item) === index);
}

export function createModelGateway({ providers = configuredOrder(), maxOutputTokens = 1200 } = {}) {
  return {
    async generate({ role, systemPrompt, recentHistory = [], maxTokens = maxOutputTokens, jsonMode = false } = {}) {
      if (!MODEL_ROLES.includes(role)) throw new Error('Unknown model gateway role.');
      const startedAt = Date.now();
      for (const provider of providers) {
        const response = await provider.generate({
          systemPrompt,
          recentHistory,
          maxTokens: Math.min(Number(maxTokens) || maxOutputTokens, maxOutputTokens),
          jsonMode,
          tools: null,
        });
        if (response) {
          return {
            ...response,
            routing: {
              role,
              provider: response.provider || provider.name,
              model: response.model || provider.configuredModel?.() || null,
              latencyMs: Date.now() - startedAt,
              tokensUsed: Number(response.tokensUsed) || 0,
              fallback: provider !== providers[0],
            },
          };
        }
      }
      return { text: null, routing: { role, provider: null, model: null, latencyMs: Date.now() - startedAt, tokensUsed: 0, fallback: true } };
    },
  };
}
