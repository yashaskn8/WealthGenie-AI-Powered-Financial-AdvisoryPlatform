import axios from 'axios';
import {
  buildRagQueryRequest,
  buildTracingHeaders,
  normalizeRagResponse,
} from './mlServiceContract.js';

const getMlServiceUrl = () => (process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const getMlApiKey = () => process.env.ML_SERVICE_API_KEY || '';
const RAG_TIMEOUT_MS = 8000;

let failureCount = 0;
let circuitOpenUntil = 0;

function isCircuitHealthy() {
  if (Date.now() < circuitOpenUntil) {
    return false;
  }
  return true;
}

function recordSuccess() {
  failureCount = 0;
  circuitOpenUntil = 0;
}

function recordFailure() {
  failureCount++;
  if (failureCount >= 3) {
    circuitOpenUntil = Date.now() + 60000;
    console.warn(`[RAGClient] Circuit breaker OPENED due to ${failureCount} consecutive failures.`);
  }
}


/**
 * Executes grounded RAG retrieval & answer synthesis against FastAPI /rag/query.
 * 
 * @param {Object} params - { query, top_k, userId, userRole }
 * @param {string|null} correlationId - Optional correlation ID for tracing
 * @returns {Promise<Object|null>} Grounded RAG query response or null on failure
 */
export async function queryRAG({ query, top_k = 4, jurisdiction = "IN", userId = null, userRole = null }, correlationId = null) {
  const request = buildRagQueryRequest({ query, top_k, jurisdiction });
  if (!request) {
    return null;
  }

  if (!isCircuitHealthy()) {
    console.warn('[RAGClient] Circuit breaker OPEN — fast-failing query.');
    return null;
  }

  try {
    const mlUrl = getMlServiceUrl();
    const apiKey = getMlApiKey();
    const res = await axios.post(
      `${mlUrl}/rag/query`,
      request,
      {
        timeout: RAG_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
          ...(userId ? { 'X-Verified-User-Id': String(userId) } : {}),
          ...(userRole ? { 'X-Verified-User-Role': String(userRole) } : {}),
          ...buildTracingHeaders(correlationId),
        },
      }
    );

    const result = res.status === 200 ? normalizeRagResponse(res.data) : null;
    if (result) {
      recordSuccess();
      return result;
    }
    recordFailure();
    return null;
  } catch (err) {
    recordFailure();
    console.warn('[RAGClient] RAG service query failed:', err.response?.data?.detail || err.message);
    return null;
  }
}

/**
 * Health check endpoint for RAG subsystem.
 */
export async function checkRAGHealth(correlationId = null) {
  try {
    const mlUrl = getMlServiceUrl();
    const apiKey = getMlApiKey();
    const res = await axios.get(`${mlUrl}/health`, {
      timeout: 3000,
      headers: {
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        ...buildTracingHeaders(correlationId),
      },
    });
    return res.data;
  } catch {
    return null;
  }
}
