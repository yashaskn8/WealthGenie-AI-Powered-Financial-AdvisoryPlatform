import { assertSafePublicUrl } from './safePublicDocumentFetcher.js';

const QUERY_MAX_LENGTH = 240;
const QUERY_FORBIDDEN = /(https?:\/\/|ftp:\/\/|file:\/\/|gopher:\/\/|data:|javascript:|eyJ[a-zA-Z0-9_-]+\.|\b(?:email|phone|jwt|token|password|monthlyTakeHome|rawProfile|userId)\b)/i;

export function validateResearchQuery(query) {
  const value = String(query || '').trim();
  if (!value || value.length > QUERY_MAX_LENGTH || QUERY_FORBIDDEN.test(value) || /[\u0000-\u001f]/.test(value)) {
    const error = new Error('Research query rejected by the server policy.');
    error.code = 'RESEARCH_QUERY_REJECTED';
    throw error;
  }
  return value;
}

function safeResult(result) {
  if (!result || typeof result !== 'object' || typeof result.url !== 'string') return null;
  return {
    url: result.url,
    title: typeof result.title === 'string' ? result.title.slice(0, 240) : null,
    publisher: typeof result.publisher === 'string' ? result.publisher.slice(0, 160) : null,
    publicationDate: result.publicationDate || null,
    section: typeof result.section === 'string' ? result.section.slice(0, 160) : null,
    factType: typeof result.factType === 'string' ? result.factType.slice(0, 100) : 'public_fact',
    claimCandidate: typeof result.claimCandidate === 'string' ? result.claimCandidate.slice(0, 700) : null,
    content: typeof result.content === 'string' ? result.content.slice(0, 200000) : null,
  };
}

export class FixtureResearchSearchProvider {
  constructor({ documents = [] } = {}) {
    this.documents = documents.map(safeResult).filter(Boolean);
    this.name = 'fixture';
  }

  async search({ query, maxResults = 5 } = {}) {
    const safeQuery = validateResearchQuery(query);
    const terms = safeQuery.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const ranked = this.documents.map(document => {
      const haystack = `${document.title || ''} ${document.publisher || ''} ${document.factType || ''} ${document.content || ''} ${document.claimCandidate || ''}`.toLowerCase();
      return { document, score: terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) };
    }).filter(item => item.score > 0).sort((left, right) => right.score - left.score);
    return ranked.slice(0, Math.max(1, Math.min(5, maxResults))).map(item => item.document);
  }
}

export class ConfiguredResearchSearchProvider {
  constructor({ endpoint, token = null, fetchImpl = globalThis.fetch } = {}) {
    this.endpoint = endpoint;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.name = 'configured';
  }

  async search({ query, brief, maxResults = 5, signal } = {}) {
    const safeQuery = validateResearchQuery(query);
    const endpoint = await assertSafePublicUrl(this.endpoint);
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        query: safeQuery,
        jurisdiction: brief.jurisdiction,
        asOf: brief.asOf,
        requestedFactTypes: brief.requestedFactTypes,
        instrumentCategories: brief.instrumentCategories,
        limit: Math.min(5, maxResults),
      }),
    });
    if (!response.ok) {
      const error = new Error('Configured research provider failed.');
      error.code = 'RESEARCH_PROVIDER_UNAVAILABLE';
      throw error;
    }
    const body = await response.json();
    return Array.isArray(body?.results) ? body.results.map(safeResult).filter(Boolean).slice(0, 5) : [];
  }
}

export function createResearchSearchProvider({ env = process.env, fixtureDocuments = null, fetchImpl = globalThis.fetch } = {}) {
  const provider = String(env.RESEARCH_SEARCH_PROVIDER || '').trim().toLowerCase();
  if (provider === 'fixture' || fixtureDocuments) return new FixtureResearchSearchProvider({ documents: fixtureDocuments || [] });
  if (provider === 'configured' && env.RESEARCH_SEARCH_PROVIDER_URL) {
    return new ConfiguredResearchSearchProvider({ endpoint: env.RESEARCH_SEARCH_PROVIDER_URL, token: env.RESEARCH_SEARCH_PROVIDER_TOKEN || null, fetchImpl });
  }
  const error = new Error('No approved research search provider is configured.');
  error.code = 'RESEARCH_PROVIDER_UNAVAILABLE';
  throw error;
}
