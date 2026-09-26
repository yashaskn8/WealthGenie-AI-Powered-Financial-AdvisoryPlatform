import { ProviderManager } from '../services/providerAbstraction.js';

export const MODEL_ROLES = Object.freeze(['PLANNER', 'EXPLAINER', 'VERIFIER', 'EVOLUTION_RESEARCH']);

function configuredOrder() {
  // CI/local lifecycle runs use the deterministic explanation path. Treat the
  // explicit mock setting as "no external model providers", not as permission
  // to route to the default real provider.
  if (String(process.env.LLM_DEFAULT_PROVIDER || '').trim().toLowerCase() === 'mock') return [];
  const primary = String(process.env.LLM_PRIMARY_PROVIDER || 'NVIDIA_NIM').trim().toUpperCase();
  const table = { NVIDIA_NIM: ProviderManager.nvidia, GEMINI: ProviderManager.gemini, GROQ: ProviderManager.groq };
  return [table[primary], ProviderManager.nvidia, ProviderManager.gemini, ProviderManager.groq].filter((item, index, list) => item && list.indexOf(item) === index);
}

export function createModelGateway({ providers = configuredOrder(), maxOutputTokens = 1200 } = {}) {
  return {
    async generate({ role, systemPrompt, recentHistory = [], maxTokens = maxOutputTokens, jsonMode = false, requestBudget = null, signal } = {}) {
      if (!MODEL_ROLES.includes(role)) throw new Error('Unknown model gateway role.');
      const startedAt = Date.now();
      const failures = [];
      for (const provider of providers) {
        if (!provider || typeof provider.generate !== 'function') continue;
        // Do not reserve a model-call/token budget for adapters which have no
        // credentials. A missing key is a known configuration state, not an
        // attempted provider call. Injected providers without this method are
        // still treated as configured for deterministic test/custom adapters.
        if (typeof provider.isConfigured === 'function' && !provider.isConfigured()) {
          failures.push(`${provider.name || 'provider'}_not_configured`);
          continue;
        }
        let response = null;
        let reservation = null;
        try {
          const boundedMaxTokens = Math.min(Number(maxTokens) || maxOutputTokens, maxOutputTokens);
          reservation = requestBudget ? await requestBudget.reserve({ systemPrompt, recentHistory, maxTokens: boundedMaxTokens }) : null;
          response = await provider.generate({
            systemPrompt,
            recentHistory,
            maxTokens: boundedMaxTokens,
            jsonMode,
            tools: null,
            signal,
          });
          if (signal?.aborted) throw signal.reason || Object.assign(new Error('Provider request aborted.'), { name: 'AbortError' });
          const usage = response?.tokensUsed ?? response?.usage?.totalTokens ?? response?.usageMetadata?.totalTokenCount;
          if (response && reservation) requestBudget.settle(reservation, usage);
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') throw error;
          if (error?.code === 'AGENT_BUDGET_EXCEEDED') throw error;
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
              tokensUsed: Number(response.tokensUsed ?? response.usage?.totalTokens ?? response.usageMetadata?.totalTokenCount) || 0,
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
