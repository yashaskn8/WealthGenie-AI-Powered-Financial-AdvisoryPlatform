import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildPredictionRequest,
  buildRagQueryRequest,
  buildTracingHeaders,
  normalizePredictionResponse,
  normalizeRagResponse,
} from '../services/mlServiceContract.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(serverRoot, 'contracts', 'ml-service-contract.fixtures.json'), 'utf8'));

test('Node prediction payload is exactly accepted by the Pydantic consumer fixture', () => {
  const request = buildPredictionRequest({
    ...fixtures.prediction_request,
    annual_income: 1800000,
    existing_debt_emi_ratio_pct: 12,
    goal_type: 'wealth-building',
  });
  assert.deepEqual(request, fixtures.prediction_request);
  assert.equal('annual_income' in request, false);
  assert.equal('existing_debt_emi_ratio_pct' in request, false, 'do not send fields FastAPI silently ignores');
  assert.equal(buildPredictionRequest({ ...fixtures.prediction_request, liquid_savings: null }), null);
  assert.equal(buildPredictionRequest({ ...fixtures.prediction_request, monthly_savings: '20000' }), null);
});

test('Node normalizes complete prediction responses and marks service results non-fallback', () => {
  const result = normalizePredictionResponse(fixtures.prediction_response);
  assert.equal(result.primary, 'ETF');
  assert.equal(result.secondary, 'Debt_MF');
  assert.equal(result.tertiary, 'ELSS');
  assert.equal(result.model_version, '4.0.0');
  assert.equal(result.dataset_version, '4.0.0');
  assert.equal(result.fallback, false);
  assert.equal(result.explanation.predicted_class, 'ETF');
});

test('Node rejects incomplete or type-drifted prediction responses safely', () => {
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, tertiary: null }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, model_version: null }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, dataset_version: null }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, tertiary: 'SGB' }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, confidence_scores: { ...fixtures.prediction_response.confidence_scores, SGB: 0 } }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, confidence_scores: { ETF: 'unknown' } }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, confidence_scores: { ETF: 2 } }), null);
  assert.equal(normalizePredictionResponse({ ...fixtures.prediction_response, confidence_scores: { ETF: null } }), null);
});

test('RAG request carries query only in the body and identity in verified headers', () => {
  assert.deepEqual(buildRagQueryRequest({ query: `  ${fixtures.rag_request.question}  `, top_k: 4 }), fixtures.rag_request);
  assert.equal(buildRagQueryRequest({ query: 'no', top_k: 4 }), null);
  assert.equal(buildRagQueryRequest({ query: fixtures.rag_request.question, top_k: 21 }), null);
  assert.equal('tenant_id' in fixtures.rag_request, false);
  assert.equal('user_id' in fixtures.rag_request, false);
});

test('Node distinguishes grounded RAG evidence from explicit abstention', () => {
  const grounded = normalizeRagResponse(fixtures.rag_grounded_response);
  assert.equal(grounded.grounded, true);
  assert.equal(grounded.citations[0].chunk_id, 'tax-80c#1');

  const abstention = normalizeRagResponse(fixtures.rag_abstention_response);
  assert.equal(abstention.grounded, false);
  assert.deepEqual(abstention.citations, []);
  assert.deepEqual(abstention.retrieved_chunks, []);
  assert.equal(normalizeRagResponse({ ...fixtures.rag_grounded_response, citations: [] }), null);
});

test('correlation and W3C trace metadata remain compatible', () => {
  const headers = buildTracingHeaders(fixtures.trace.correlation_id);
  assert.equal(headers['X-Correlation-ID'], fixtures.trace.correlation_id);
  assert.match(headers.traceparent, new RegExp(fixtures.trace.traceparent_pattern));
});
