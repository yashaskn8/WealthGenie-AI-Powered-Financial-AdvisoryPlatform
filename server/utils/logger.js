/**
 * WealthGenie Structured Logger (Winston)
 *
 * Production:  JSON lines to stdout — parseable by Railway Logs, Datadog, Grafana Loki.
 * Development: Colorized, human-readable console output.
 *
 * Usage:
 *   import logger from './utils/logger.js';
 *   logger.info('Server started', { port: 5000 });
 *   logger.warn('Slow query', { durationMs: 3200 });
 *   logger.error('Unhandled error', { err });
 */

import { createLogger, format, transports } from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

const SENSITIVE_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret|signature|\bsig\b|\bjti\b|email|pan|mobile|phone|account(?:[_-]?number)?|financial[_-]?profile|profile[_-]?payload|tax[_-]?(?:details|payload))/i;

function redactString(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, '[REDACTED_PAN]')
    .replace(/(?<!\w)(?:\+?91[\s-]?)?[6-9][0-9]{9}(?!\w)/g, '[REDACTED_PHONE]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED_API_KEY]')
    .replace(/((?:mongodb(?:\+srv)?|rediss?):\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/([?&](?:password|secret|token|auth|auth[_-]?token|jwt|access[_-]?token|refresh[_-]?token|api[_-]?key|x[_-]?api[_-]?key|key|authorization|cookie|session|session[_-]?id|signature|sig|email|e[_-]?mail|pan|mobile|phone|account|account[_-]?number|profile[_-]?id|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+|se|sp|sv|sr)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(^|[\s,{])(["']?(?:password|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret|signature|sig|jti|email|e[_-]?mail|pan|mobile|phone|bank[_-]?account(?:[_-]?number)?|account(?:[_-]?number)?|profile[_-]?id|financial[_-]?profile|tax[_-]?(?:details|payload)|monthly[_-]?(?:take[_-]?home|savings)|annual[_-]?(?:income|gross[_-]?income)|income|salary|savings|expenses?|net[_-]?worth|portfolio|investment[_-]?(?:goals?|amount|value)|risk[_-]?tolerance|deductions?)["']?\s*(?::|=|\s)\s*)(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\r\n,;&}\]]+)/gi, '$1$2"[REDACTED]"');
}

function redactValue(value, seen, depth = 0) {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (depth > 8) return '[REDACTED:MAX_DEPTH]';
  if (seen.has(value)) return '[REDACTED:CIRCULAR]';
  seen.add(value);
  if (value instanceof Date) {
    try { return Date.prototype.toISOString.call(value); } catch { return '[REDACTED:INVALID_DATE]'; }
  }

  let descriptors;
  if (value instanceof Error) {
    descriptors = Object.getOwnPropertyDescriptors(value);
    const result = {
      name: typeof descriptors.name?.value === 'string' ? redactString(descriptors.name.value) : 'Error',
      message: typeof descriptors.message?.value === 'string' ? redactString(descriptors.message.value) : '',
    };
    let stack = descriptors.stack?.value;
    if (typeof stack !== 'string' && typeof descriptors.stack?.get === 'function') {
      try {
        const getterSource = Function.prototype.toString.call(descriptors.stack.get);
        if (getterSource.includes('[native code]')) stack = descriptors.stack.get.call(value);
      } catch {
        // Do not invoke or trust custom stack accessors.
      }
    }
    if (typeof stack === 'string') result.stack = redactString(stack);
    if (descriptors.cause && Object.hasOwn(descriptors.cause, 'value')) {
      result.cause = redactValue(descriptors.cause.value, seen, depth + 1);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (['name', 'message', 'stack', 'cause', 'toJSON'].includes(key) || !descriptor.enumerable) continue;
      result[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : Object.hasOwn(descriptor, 'value')
          ? redactValue(descriptor.value, seen, depth + 1)
          : '[REDACTED:ACCESSOR]';
    }
    return result;
  }

  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length > 10000) return '[REDACTED:OVERSIZED_ARRAY]';
    descriptors = Object.getOwnPropertyDescriptors(value);
    return Array.from({ length }, (_, index) => {
      const descriptor = descriptors[index];
      if (!descriptor) return null;
      return Object.hasOwn(descriptor, 'value')
        ? redactValue(descriptor.value, seen, depth + 1)
        : '[REDACTED:ACCESSOR]';
    });
  }

  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return '[REDACTED:UNINSPECTABLE_OBJECT]'; }
  if (prototype !== Object.prototype && prototype !== null) return '[REDACTED:UNSUPPORTED_OBJECT]';

  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return '[REDACTED:UNINSPECTABLE_OBJECT]'; }
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === 'toJSON' || !descriptor.enumerable) continue;
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : Object.hasOwn(descriptor, 'value')
        ? redactValue(descriptor.value, seen, depth + 1)
        : '[REDACTED:ACCESSOR]';
  }
  return result;
}

export function redactLogValue(value) {
  return redactValue(value, new WeakSet());
}

export function sanitizeLoggerInfo(info) {
  const safeInfo = redactLogValue(info);
  for (const key of Object.keys(info)) delete info[key];
  Object.assign(info, safeInfo);
  return info;
}

const redactSecrets = format(sanitizeLoggerInfo);

export function formatHttpAccessLog({ method, path, status, contentLength, responseTime, requestId }) {
  const safePath = typeof path === 'string' ? path.split(/[?#]/, 1)[0] : '/';
  return `${redactString(String(method || '-'))} ${safePath || '/'} ${redactString(String(status || '-'))} ${redactString(String(contentLength || '-'))} - ${redactString(String(responseTime || '-'))} ms request_id=${redactString(String(requestId || '-'))}`;
}

const logger = createLogger({
  level: isProduction ? 'info' : 'debug',
  defaultMeta: {
    service: 'wealthgenie-api',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    format.errors({ stack: !isProduction }),
    redactSecrets(),
    isProduction
      ? format.json()
      : format.combine(format.colorize(), format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        }))
  ),
  transports: [new transports.Console()],
  // Prevent crashes from unhandled rejections / uncaught exceptions
  exitOnError: false,
});

/**
 * Morgan-compatible stream — pipe HTTP request logs through Winston.
 */
export const morganStream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

export default logger;
