import crypto from 'node:crypto';
import { stableResearchId } from './researchConstants.js';
import { classifyResearchSource } from './sourceTrust.js';

const INJECTION_PATTERN = /(ignore\s+(?:all|previous|the)\s+instructions?|system\s+message|developer\s+message|reveal\s+(?:the\s+)?prompt|call\s+this\s+url|execute\s+recompute)/i;
const MAX_EXCERPT_LENGTH = 800;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function stripUntrustedDocumentMarkup(content) {
  return String(content || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractDocumentEvidence({ document, sourceId = null, factType = 'public_fact', title = null, publisher = null, publicationDate = null } = {}) {
  const text = stripUntrustedDocumentMarkup(document?.body ?? document?.content ?? document);
  if (!text) return { blocked: false, promptInjectionDetected: false, evidenceUnits: [] };
  if (INJECTION_PATTERN.test(text)) {
    return { blocked: true, promptInjectionDetected: true, evidenceUnits: [], reasonCodes: ['PROMPT_INJECTION_IN_DOCUMENT'] };
  }
  const canonicalUrl = String(document?.url || document?.canonicalUrl || '');
  const resolvedSourceId = sourceId || stableResearchId('S', canonicalUrl);
  const retrievedAt = document?.retrievedAt || new Date().toISOString();
  const sourceTrustTier = classifyResearchSource({ url: canonicalUrl, publisher });
  const sentences = text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean).slice(0, 12);
  const evidenceUnits = sentences.map((sentence, index) => {
    const excerpt = sentence.slice(0, MAX_EXCERPT_LENGTH);
    const evidenceId = stableResearchId('E', `${resolvedSourceId}:${index}:${excerpt}`);
    return {
      evidenceId,
      sourceId: resolvedSourceId,
      documentHash: hash(text),
      title: title || document?.title || null,
      publisher: publisher || document?.publisher || null,
      canonicalUrl,
      publicationDate: publicationDate || document?.publicationDate || null,
      retrievedAt,
      section: document?.section || null,
      claimCandidate: excerpt,
      supportingExcerptHash: hash(excerpt),
      supportingExcerpt: excerpt,
      factType,
      sourceTrustTier,
      freshnessStatus: publicationDate ? 'FRESH' : 'UNKNOWN',
    };
  });
  return { blocked: false, promptInjectionDetected: false, evidenceUnits };
}
