import axios from 'axios';
import { PrometheusMetrics } from './metricsCollector.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const NVIDIA_NIM_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_NIM_DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

const ABORT_CODES = new Set(['ERR_CANCELED', 'ABORT_ERR']);
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_SOCKET_TIMEOUT']);
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'ERR_NETWORK',
]);

/**
 * Provider errors are classified before they can affect shared provider health.
 * Request/configuration/quality failures never count as infrastructure outages.
 */
export function classifyProviderError(error, { signal } = {}) {
  if (signal?.aborted || error?.name === 'AbortError' || ABORT_CODES.has(error?.code)) {
    return { code: 'CALLER_ABORTED', retryable: false, breakerRelevant: false, fallbackEligible: false };
  }

  const status = Number(error?.response?.status);
  if (status === 408 || TIMEOUT_CODES.has(error?.code)) {
    return { code: 'PROVIDER_TIMEOUT', retryable: false, breakerRelevant: true, providerResponded: status === 408, fallbackEligible: true };
  }
  if (status === 429) {
    return { code: 'PROVIDER_RATE_LIMITED', retryable: false, breakerRelevant: false, providerResponded: true, fallbackEligible: true };
  }
  if (status === 401 || status === 403) {
    return { code: 'PROVIDER_AUTHENTICATION_FAILED', retryable: false, breakerRelevant: false, providerResponded: true, fallbackEligible: true };
  }
  if (status >= 500 && status <= 599) {
    return { code: 'PROVIDER_SERVER_ERROR', retryable: false, breakerRelevant: true, providerResponded: true, fallbackEligible: true };
  }
  if (status >= 400 && status <= 499) {
    return { code: 'PROVIDER_BAD_REQUEST', retryable: false, breakerRelevant: false, providerResponded: true, fallbackEligible: true };
  }
  if (NETWORK_CODES.has(error?.code) || (error?.isAxiosError && error?.request && !error?.response)) {
    return { code: 'PROVIDER_NETWORK_ERROR', retryable: false, breakerRelevant: true, providerResponded: false, fallbackEligible: true };
  }
  return { code: 'PROVIDER_INTERNAL_ERROR', retryable: false, breakerRelevant: false, providerResponded: false, fallbackEligible: true };
}

function recordProviderError(adapter, permit, error, signal) {
  const classification = classifyProviderError(error, { signal });
  adapter.lastFailureReason = classification.code;
  if (classification.code === 'CALLER_ABORTED') {
    adapter.recordCancellation(permit);
    throw error;
  }
  if (classification.breakerRelevant) adapter.recordFailure(permit);
  else if (classification.providerResponded) adapter.recordRequestFailure(permit, classification.code);
  else adapter.releasePermit(permit);
  if (classification.code === 'PROVIDER_TIMEOUT') PrometheusMetrics.inc('provider_timeout_total');
  if (classification.code === 'PROVIDER_RATE_LIMITED') PrometheusMetrics.inc('provider_rate_limit_total');
  if (classification.code === 'PROVIDER_AUTHENTICATION_FAILED') PrometheusMetrics.inc('provider_auth_failure_total');
  if (classification.code !== 'CALLER_ABORTED') PrometheusMetrics.inc(`${adapter.name}_failure_total`);
  if (!classification.fallbackEligible) throw error;
  return null;
}

/**
 * Strips JSON schema fields unsupported by Google Gemini FunctionDeclarations API (e.g. additionalProperties, patternProperties).
 */
function sanitizeGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeGeminiSchema);
  const clean = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === 'patternProperties') continue;
    clean[k] = sanitizeGeminiSchema(v);
  }
  return clean;
}

/**
 * Abstract Base Provider Adapter (Phase 9)
 */
export class BaseProviderAdapter {
  constructor(name, costPer1kTokens = 0.0005, {
    failureThreshold = 3,
    recoveryTimeoutMs = 60000,
    now = () => Date.now(),
  } = {}) {
    this.name = name;
    this.costPer1kTokens = costPer1kTokens;
    this.failureCount = 0;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.now = now;
    this.circuitState = 'CLOSED';
    this.circuitOpenUntil = 0;
    this.halfOpenProbeInFlight = false;
    this.generation = 0;
    this.permits = new WeakMap();
  }

  isHealthy() {
    this.#refreshState();
    return this.circuitState === 'CLOSED';
  }

  #refreshState() {
    if (this.circuitState === 'OPEN' && this.now() >= this.circuitOpenUntil) {
      this.circuitState = 'HALF_OPEN';
      this.halfOpenProbeInFlight = false;
    }
  }

  acquirePermit() {
    this.#refreshState();
    if (this.circuitState === 'OPEN') return null;
    const halfOpenProbe = this.circuitState === 'HALF_OPEN';
    if (halfOpenProbe && this.halfOpenProbeInFlight) return null;
    if (halfOpenProbe) {
      this.halfOpenProbeInFlight = true;
      PrometheusMetrics.inc('circuit_half_open_probe_total');
    }
    const permit = Object.freeze({});
    this.permits.set(permit, { generation: this.generation, halfOpenProbe });
    return permit;
  }

  #consumePermit(permit) {
    if (!permit || !this.permits.has(permit)) return null;
    const details = this.permits.get(permit);
    this.permits.delete(permit);
    return details.generation === this.generation ? details : null;
  }

  #closeRecoveredCircuit() {
    this.circuitState = 'CLOSED';
    this.circuitOpenUntil = 0;
    this.failureCount = 0;
    this.halfOpenProbeInFlight = false;
    this.generation += 1;
    PrometheusMetrics.inc('circuit_recovery_success_total');
  }

  recordSuccess(permit) {
    const details = this.#consumePermit(permit);
    if (!details) return false;
    if (details.halfOpenProbe) this.#closeRecoveredCircuit();
    else if (this.circuitState === 'CLOSED') this.failureCount = 0;
    PrometheusMetrics.inc('provider_success_total');
    return true;
  }

  recordRequestFailure(permit, reasonCode) {
    const details = this.#consumePermit(permit);
    if (!details) return false;
    PrometheusMetrics.inc('provider_request_failure_total');
    if (reasonCode === 'PROVIDER_SAFETY_REJECTION') PrometheusMetrics.inc('provider_safety_rejection_total');
    // Any completed HTTP response proves transport recovery; neutral outcomes
    // also release a half-open probe without poisoning provider-wide health.
    if (details.halfOpenProbe) this.#closeRecoveredCircuit();
    else if (this.circuitState === 'CLOSED') this.failureCount = 0;
    return true;
  }

  recordCancellation(permit) {
    this.releasePermit(permit);
  }

  releasePermit(permit) {
    const details = this.#consumePermit(permit);
    if (details?.halfOpenProbe && this.circuitState === 'HALF_OPEN') {
      this.halfOpenProbeInFlight = false;
    }
  }

  recordFailure(permit) {
    const details = this.#consumePermit(permit);
    if (!details) return false;
    PrometheusMetrics.inc('provider_health_failure_total');
    this.failureCount += 1;
    if (details.halfOpenProbe || (this.circuitState === 'CLOSED' && this.failureCount >= this.failureThreshold)) {
      this.circuitState = 'OPEN';
      this.circuitOpenUntil = this.now() + this.recoveryTimeoutMs;
      this.halfOpenProbeInFlight = false;
      this.generation += 1;
      PrometheusMetrics.inc('circuit_open_total');
      if (details.halfOpenProbe) PrometheusMetrics.inc('circuit_recovery_failure_total');
    }
    return true;
  }

  reset() {
    this.circuitState = 'CLOSED';
    this.circuitOpenUntil = 0;
    this.failureCount = 0;
    this.halfOpenProbeInFlight = false;
    this.generation += 1;
  }

  supportsTools() { return true; }
  supportsJSON() { return true; }
  supportsStreaming() { return false; }

  isConfigured() { return true; }

  configuredModel() { return null; }
}

function toOpenAiMessages(systemPrompt, recentHistory = []) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const item of recentHistory) {
    const text = Array.isArray(item.parts)
      ? item.parts.filter(part => typeof part.text === 'string').map(part => part.text).join('\n')
      : item.content;
    if (!text) continue;
    messages.push({ role: item.role === 'model' ? 'assistant' : item.role, content: text });
  }
  return messages;
}

export class NvidiaNimProviderAdapter extends BaseProviderAdapter {
  constructor(breakerOptions = {}) {
    super('nvidia_nim', 0, breakerOptions);
    this.lastFailureReason = null;
  }

  configuredModel() {
    return String(process.env.NVIDIA_NIM_MODEL || NVIDIA_NIM_DEFAULT_MODEL).trim();
  }

  isConfigured() { return Boolean(process.env.NVIDIA_API_KEY); }

  configuredBaseUrl() {
    return String(process.env.NVIDIA_NIM_BASE_URL || NVIDIA_NIM_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  }

  supportsTools() { return false; }

  async generate({ systemPrompt, recentHistory, maxTokens = 1200, jsonMode = false, signal }) {
    this.lastFailureReason = null;
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('Provider request aborted.'), { name: 'AbortError' });
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      this.lastFailureReason = 'PROVIDER_NOT_CONFIGURED';
      return null;
    }
    const model = this.configuredModel();
    const endpoint = `${this.configuredBaseUrl()}/chat/completions`;
    const body = {
      model,
      messages: toOpenAiMessages(systemPrompt, recentHistory),
      temperature: 0,
      top_p: 1,
      max_tokens: Math.min(Math.max(Number(maxTokens) || 1200, 128), 2048),
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    const permit = this.acquirePermit();
    if (!permit) {
      this.lastFailureReason = 'PROVIDER_CIRCUIT_OPEN';
      return null;
    }
    try {
      const response = await axios.post(endpoint, body, {
        timeout: 20000,
        signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      const choice = response.data?.choices?.[0];
      const text = choice?.message?.content;
      const responseModel = response.data?.model;
      if (!text || typeof text !== 'string') {
        this.lastFailureReason = 'EMPTY_COMPLETION';
        this.recordRequestFailure(permit, this.lastFailureReason);
        PrometheusMetrics.inc('nvidia_nim_failure_total');
        return null;
      }
      if (responseModel !== model) {
        this.lastFailureReason = 'PROVIDER_MODEL_METADATA_MISMATCH';
        this.recordRequestFailure(permit, this.lastFailureReason);
        PrometheusMetrics.inc('nvidia_nim_failure_total');
        return null;
      }
      this.recordSuccess(permit);
      PrometheusMetrics.inc('nvidia_nim_success_total');
      return {
        text,
        tool_calls: [],
        tokensUsed: Number(response.data?.usage?.total_tokens) || 0,
        provider: this.name,
        model: responseModel,
        wasCompleted: choice.finish_reason === 'stop',
        estimatedCostUSD: null,
      };
    } catch (error) {
      return recordProviderError(this, permit, error, signal);
    }
  }
}

export class GeminiProviderAdapter extends BaseProviderAdapter {
  constructor(breakerOptions = {}) {
    super('gemini', 0.0004, breakerOptions);
    this.lastFailureReason = null;
  }

  configuredModel() { return 'gemini-3.6-flash'; }

  isConfigured() { return Boolean(process.env.GEMINI_API_KEY); }

  async generate({ systemPrompt, recentHistory, maxTokens = 4096, tools = null, jsonMode = false, signal }) {
    this.lastFailureReason = null;
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('Provider request aborted.'), { name: 'AbortError' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.lastFailureReason = 'PROVIDER_NOT_CONFIGURED';
      return null;
    }

    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: recentHistory,
      generationConfig: { maxOutputTokens: maxTokens, temperature: jsonMode ? 0 : 0.4 },
    };
    if (jsonMode) payload.generationConfig.responseMimeType = 'application/json';

    if (tools && Array.isArray(tools) && tools.length > 0) {
      payload.tools = [
        {
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeGeminiSchema(t.parameters),
          })),
        },
      ];
    }

    const permit = this.acquirePermit();
    if (!permit) {
      this.lastFailureReason = 'PROVIDER_CIRCUIT_OPEN';
      return null;
    }
    try {
      const res = await axios.post(GEMINI_API_URL, payload, {
        timeout: 30000,
        signal,
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      });

      const candidate = res.data?.candidates?.[0];
      if (!candidate || candidate.finishReason === 'SAFETY') {
        this.lastFailureReason = candidate?.finishReason === 'SAFETY' ? 'PROVIDER_SAFETY_REJECTION' : 'EMPTY_COMPLETION';
        this.recordRequestFailure(permit, this.lastFailureReason);
        PrometheusMetrics.inc('gemini_failure_total');
        return null;
      }

      const parts = candidate.content?.parts || [];
      const textParts = parts.filter(p => p.text).map(p => p.text);
      const text = textParts.join('');

      const toolCalls = [];
      for (const part of parts) {
        if (part.functionCall) {
          toolCalls.push({
            tool: part.functionCall.name,
            arguments: part.functionCall.args || {},
            raw_part: part,
          });
        }
      }

      if (text.trim().length === 0 && toolCalls.length === 0) {
        this.lastFailureReason = 'EMPTY_COMPLETION';
        this.recordRequestFailure(permit, this.lastFailureReason);
        PrometheusMetrics.inc('gemini_failure_total');
        return null;
      }

      const tokensUsed = res.data?.usageMetadata?.totalTokenCount || 0;
      this.recordSuccess(permit);
      PrometheusMetrics.inc('gemini_success_total');
      return {
        text,
        tool_calls: toolCalls,
        tokensUsed,
        provider: this.name,
        model: res.data?.modelVersion || this.configuredModel(),
        wasCompleted: candidate.finishReason === 'STOP' || toolCalls.length > 0,
        estimatedCostUSD: (tokensUsed / 1000) * this.costPer1kTokens,
      };
    } catch (error) {
      return recordProviderError(this, permit, error, signal);
    }
  }
}

export class GroqProviderAdapter extends BaseProviderAdapter {
  constructor(breakerOptions = {}) {
    super('groq', 0.0006, breakerOptions);
    this.lastFailureReason = null;
  }

  configuredModel() { return String(process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL).trim(); }

  isConfigured() { return Boolean(process.env.GROQ_API_KEY); }

  async generate({ systemPrompt, recentHistory, maxTokens = 4096, tools = null, jsonMode = false, signal }) {
    this.lastFailureReason = null;
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('Provider request aborted.'), { name: 'AbortError' });
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      this.lastFailureReason = 'PROVIDER_NOT_CONFIGURED';
      return null;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    for (const m of recentHistory) {
      if (m.parts && Array.isArray(m.parts)) {
        const functionCallParts = m.parts.filter(p => p.functionCall);
        const functionResponseParts = m.parts.filter(p => p.functionResponse);
        const textParts = m.parts.filter(p => p.text).map(p => p.text).join('\n');

        if (functionCallParts.length > 0) {
          messages.push({
            role: 'assistant',
            content: textParts || null,
            tool_calls: functionCallParts.map((p, idx) => ({
              id: `call_${idx}_${p.functionCall.name}`,
              type: 'function',
              function: {
                name: p.functionCall.name,
                arguments: typeof p.functionCall.args === 'string' ? p.functionCall.args : JSON.stringify(p.functionCall.args || {}),
              },
            })),
          });
        } else if (functionResponseParts.length > 0) {
          for (let idx = 0; idx < functionResponseParts.length; idx++) {
            const p = functionResponseParts[idx];
            messages.push({
              role: 'tool',
              tool_call_id: `call_${idx}_${p.functionResponse.name}`,
              name: p.functionResponse.name,
              content: typeof p.functionResponse.response === 'string'
                ? p.functionResponse.response
                : JSON.stringify(p.functionResponse.response || {}),
            });
          }
        } else {
          messages.push({
            role: m.role === 'model' ? 'assistant' : m.role,
            content: textParts || m.content || '',
          });
        }
      } else {
        messages.push({
          role: m.role === 'model' ? 'assistant' : m.role,
          content: m.content || '',
        });
      }
    }

    const body = {
      model: this.configuredModel(),
      messages,
      max_tokens: maxTokens,
      temperature: 0.4,
    };
    if (jsonMode) {
      body.temperature = 0;
      body.response_format = { type: 'json_object' };
    }

    if (tools && Array.isArray(tools) && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const permit = this.acquirePermit();
    if (!permit) {
      this.lastFailureReason = 'PROVIDER_CIRCUIT_OPEN';
      return null;
    }
    try {
      const res = await axios.post(GROQ_API_URL, body, {
        timeout: 30000,
        signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const choice = res.data?.choices?.[0];
      const message = choice?.message;
      if (!message || (!message.content && !message.tool_calls?.length)) {
        this.lastFailureReason = 'EMPTY_COMPLETION';
        this.recordRequestFailure(permit, this.lastFailureReason);
        PrometheusMetrics.inc('groq_failure_total');
        return null;
      }

      const text = message?.content || '';
      const toolCalls = [];
      if (message?.tool_calls && Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          if (tc.function) {
            let parsedArgs = {};
            try {
              parsedArgs = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            } catch { /* default empty object */ }
            toolCalls.push({
              tool: tc.function.name,
              arguments: parsedArgs,
            });
          }
        }
      }

      const tokensUsed = res.data?.usage?.total_tokens || 0;
      this.recordSuccess(permit);
      PrometheusMetrics.inc('groq_success_total');
      return {
        text,
        tool_calls: toolCalls,
        tokensUsed,
        provider: this.name,
        model: res.data?.model || this.configuredModel(),
        wasCompleted: choice?.finish_reason === 'stop' || toolCalls.length > 0,
        estimatedCostUSD: (tokensUsed / 1000) * this.costPer1kTokens,
      };
    } catch (error) {
      return recordProviderError(this, permit, error, signal);
    }
  }
}

export const ProviderManager = {
  nvidia: new NvidiaNimProviderAdapter(),
  gemini: new GeminiProviderAdapter(),
  groq: new GroqProviderAdapter(),
};
