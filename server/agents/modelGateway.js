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
      const failures = [];
      for (const provider of providers) {
        if (!provider || typeof provider.generate !== 'function') continue;
        let response = null;
        try {
          response = await provider.generate({
            systemPrompt,
            recentHistory,
            maxTokens: Math.min(Number(maxTokens) || maxOutputTokens, maxOutputTokens),
            jsonMode,
            tools: null,
          });
        } catch (error) {
          // Providers are an untrusted availability boundary. Continue only
          // for explicitly retryable/provider failures; programming and
          // validation errors must surface to the caller.
          const code = String(error?.code || '');
          if (!code.startsWith('PROVIDER_') && !error?.retryable) throw error;
          failures.push(code || 'PROVIDER_REQUEST_FAILED');
          continue;
        }
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
              attemptedProviders: [...failures, provider.name].filter(Boolean),
              fallbackReason: failures[0] || null,
            },
          };
        }
        failures.push(provider.lastFailureReason || `${provider.name || 'provider'}_unavailable`);
      }
      return { text: null, routing: { role, provider: null, model: null, latencyMs: Date.now() - startedAt, tokensUsed: 0, fallback: true, attemptedProviders: failures, fallbackReason: failures[0] || 'NO_PROVIDER_RESPONSE' } };
    },
  };
}
