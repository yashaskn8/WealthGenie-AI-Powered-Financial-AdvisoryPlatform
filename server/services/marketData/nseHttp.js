const NSE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const NSE_REQUEST_HEADERS = Object.freeze({
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': NSE_USER_AGENT,
});

function retryable(error) {
  const status = Number(error?.response?.status);
  return !Number.isFinite(status) || status === 429 || status >= 500;
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function getNseJson(httpClient, url, {
  params,
  referer,
  timeout = 10_000,
  maxAttempts = 2,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await httpClient.get(url, {
        params,
        timeout,
        maxRedirects: 3,
        headers: {
          ...NSE_REQUEST_HEADERS,
          ...(referer ? { Referer: referer } : {}),
        },
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !retryable(error)) break;
      await delay(150 * attempt);
    }
  }
  throw lastError;
}

export function safeNseHttpError(error, fallback) {
  const status = Number(error?.response?.status);
  return Number.isFinite(status) ? `${fallback} (HTTP ${status}).` : fallback;
}
