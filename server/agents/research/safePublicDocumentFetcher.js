import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_ALLOWED_PORTS = new Set(['', '80', '443']);

function ipv4Parts(value) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(part => part >= 0 && part <= 255) ? parts : null;
}

function isForbiddenIpv4(value) {
  const parts = ipv4Parts(value);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isForbiddenIp(value) {
  const normalized = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(normalized) === 4) return isForbiddenIpv4(normalized);
  if (net.isIP(normalized) === 6) {
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('::ffff:') && isForbiddenIpv4(normalized.slice(7));
  }
  return false;
}

export function validatePublicUrl(rawUrl, { allowedPorts = DEFAULT_ALLOWED_PORTS } = {}) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch {
    const error = new Error('Public document URL is invalid.');
    error.code = 'RESEARCH_URL_REJECTED';
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !allowedPorts.has(parsed.port)) {
    const error = new Error('Public document URL is not allowed.');
    error.code = 'RESEARCH_URL_REJECTED';
    throw error;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || isForbiddenIp(hostname)) {
    const error = new Error('Public document URL resolves to a private or loopback address.');
    error.code = 'RESEARCH_SSRF_BLOCKED';
    throw error;
  }
  parsed.hash = '';
  return parsed;
}

export async function assertSafePublicUrl(rawUrl, { dnsLookup = dns.lookup, allowedPorts = DEFAULT_ALLOWED_PORTS } = {}) {
  const parsed = validatePublicUrl(rawUrl, { allowedPorts });
  if (net.isIP(parsed.hostname)) return parsed;
  let records;
  try { records = await dnsLookup(parsed.hostname, { all: true, verbatim: true }); } catch {
    const error = new Error('Public document hostname could not be resolved.');
    error.code = 'RESEARCH_HOST_UNRESOLVED';
    throw error;
  }
  if (!records?.length || records.some(record => isForbiddenIp(record.address))) {
    const error = new Error('Public document hostname resolves to a private or loopback address.');
    error.code = 'RESEARCH_SSRF_BLOCKED';
    throw error;
  }
  return parsed;
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw Object.assign(new Error('Research document exceeds the response size limit.'), { code: 'RESEARCH_RESPONSE_TOO_LARGE' });
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error('Research document exceeds the response size limit.'), { code: 'RESEARCH_RESPONSE_TOO_LARGE' });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export class SafePublicDocumentFetcher {
  constructor({ fetchImpl = globalThis.fetch, dnsLookup = dns.lookup, maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = DEFAULT_MAX_REDIRECTS } = {}) {
    this.fetchImpl = fetchImpl;
    this.dnsLookup = dnsLookup;
    this.maxBytes = Math.min(DEFAULT_MAX_BYTES, Math.max(1024, Number(maxBytes) || DEFAULT_MAX_BYTES));
    this.timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(250, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    this.maxRedirects = Math.min(DEFAULT_MAX_REDIRECTS, Math.max(0, Number(maxRedirects) || DEFAULT_MAX_REDIRECTS));
  }

  async fetchDocument(rawUrl, { signal } = {}) {
    let current = rawUrl;
    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      const safeUrl = await assertSafePublicUrl(current, { dnsLookup: this.dnsLookup });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const combinedSignal = signal && AbortSignal.any ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let response;
      try {
        response = await this.fetchImpl(safeUrl, {
          redirect: 'manual',
          signal: combinedSignal,
          headers: { accept: 'text/html, text/plain, application/json;q=0.9', 'user-agent': 'WealthGenie-ResearchMesh/1.0' },
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw Object.assign(new Error('Research document fetch timed out.'), { code: 'RESEARCH_FETCH_TIMEOUT' });
        throw Object.assign(new Error('Research document fetch failed.'), { code: 'RESEARCH_FETCH_FAILED', cause: error });
      } finally {
        clearTimeout(timer);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount >= this.maxRedirects) throw Object.assign(new Error('Research document redirect chain is not allowed.'), { code: 'RESEARCH_REDIRECT_REJECTED' });
        current = new URL(location, safeUrl).toString();
        continue;
      }
      if (!response.ok) throw Object.assign(new Error('Research document returned an error status.'), { code: 'RESEARCH_DOCUMENT_UNAVAILABLE' });
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!(contentType === 'text/html' || contentType === 'text/plain' || contentType === 'application/json' || contentType.startsWith('text/'))) {
        throw Object.assign(new Error('Research document content type is not supported.'), { code: 'RESEARCH_CONTENT_TYPE_REJECTED' });
      }
      const bytes = await readBoundedBody(response, this.maxBytes);
      return { url: safeUrl.toString(), contentType, body: bytes.toString('utf8'), retrievedAt: new Date().toISOString() };
    }
    throw Object.assign(new Error('Research document redirect chain is not allowed.'), { code: 'RESEARCH_REDIRECT_REJECTED' });
  }
}
