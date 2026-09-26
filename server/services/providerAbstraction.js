import axios from 'axios';
import { PrometheusMetrics } from './metricsCollector.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const NVIDIA_NIM_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_NIM_DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

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
  constructor(name, costPer1kTokens = 0.0005) {
    this.name = name;
    this.costPer1kTokens = costPer1kTokens;
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
  }

  isHealthy() {
    if (Date.now() < this.circuitOpenUntil) {
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
  }

  recordFailure() {
    this.failureCount++;
    if (this.failureCount >= 3) {
      this.circuitOpenUntil = Date.now() + 60000; // Open circuit for 60 seconds
      console.warn(`[ProviderAdapter:${this.name}] Circuit breaker OPENED due to ${this.failureCount} consecutive failures.`);
    }
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
  constructor() {
    super('nvidia_nim', 0);
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
    if (!this.isHealthy()) {
      this.lastFailureReason = 'PROVIDER_CIRCUIT_OPEN';
      return null;
    }
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

    for (let attempt = 0; attempt < 2; attempt += 1) {
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
          break;
        }
        if (responseModel !== model) {
          this.lastFailureReason = 'PROVIDER_MODEL_METADATA_MISMATCH';
          break;
        }
        this.recordSuccess();
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
        if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') throw error;
        const status = Number(error?.response?.status);
        this.lastFailureReason = error?.code === 'ECONNABORTED'
          ? 'PROVIDER_TIMEOUT'
          : status === 401 || status === 403
            ? 'PROVIDER_AUTHENTICATION_FAILED'
            : status === 429
              ? 'PROVIDER_RATE_LIMITED'
              : status >= 500
                ? 'PROVIDER_SERVER_ERROR'
                : 'PROVIDER_REQUEST_FAILED';
        if (attempt === 0 && (status === 429 || status >= 500)) continue;
        break;
      }
    }
    this.recordFailure();
    PrometheusMetrics.inc('nvidia_nim_failure_total');
    return null;
  }
}

export class GeminiProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super('gemini', 0.0004);
    this.lastFailureReason = null;
  }

  configuredModel() { return 'gemini-3.6-flash'; }

  isConfigured() { return Boolean(process.env.GEMINI_API_KEY); }

  async generate({ systemPrompt, recentHistory, maxTokens = 4096, tools = null, jsonMode = false, signal }) {
    this.lastFailureReason = null;
    if (!this.isHealthy()) {
      this.lastFailureReason = 'PROVIDER_CIRCUIT_OPEN';
      return null;
    }
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

    try {
      const res = await axios.post(GEMINI_API_URL, payload, {
        timeout: 30000,
        signal,
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      });

      const candidate = res.data?.candidates?.[0];
      if (!candidate || candidate.finishReason === 'SAFETY') {
        this.lastFailureReason = candidate?.finishReason === 'SAFETY' ? 'PROVIDER_SAFETY_REJECTION' : 'EMPTY_COMPLETION';
        this.recordFailure();
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

      const tokensUsed = res.data?.usageMetadata?.totalTokenCount || 0;
      this.recordSuccess();
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
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') throw error;
      this.lastFailureReason = 'PROVIDER_REQUEST_FAILED';
      this.recordFailure();
      PrometheusMetrics.inc('gemini_failure_total');
      return null;
    }
  }
}

export class GroqProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super('groq', 0.0006);
    this.lastFailureReason = null;
  }

  configuredModel() { return String(process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL).trim(); }

  isConfigured() { return Boolean(process.env.GROQ_API_KEY); }

  async generate({ systemPrompt, recentHistory, maxTokens = 4096, tools = null, jsonMode = false, signal }) {
    this.lastFailureReason = null;
    if (!this.isHealthy()) {
      this.lastFailureReason = 'PROVIDER_CIRCUIT_OPEN';
      return null;
    }
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
      if (!message && !choice) {
        this.lastFailureReason = 'EMPTY_COMPLETION';
        this.recordFailure();
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
      this.recordSuccess();
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
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') throw error;
      this.lastFailureReason = 'PROVIDER_REQUEST_FAILED';
      this.recordFailure();
      PrometheusMetrics.inc('groq_failure_total');
      return null;
    }
  }
}

export const ProviderManager = {
  nvidia: new NvidiaNimProviderAdapter(),
  gemini: new GeminiProviderAdapter(),
  groq: new GroqProviderAdapter(),
};
