/**
 * WealthGenie Global Error Handler
 * Provides structured error logging and safe client responses.
 * Never exposes internal error messages or stack traces to clients.
 */

import logger from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

const ERROR_CATEGORIES = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTH: 'AUTH_ERROR',
  NOT_FOUND: 'NOT_FOUND_ERROR',
  CONFLICT: 'CONFLICT_ERROR',
  ML_SERVICE: 'ML_SERVICE_ERROR',
  GEMINI: 'GEMINI_API_ERROR',
  MARKET_DATA: 'MARKET_DATA_ERROR',
  DATABASE: 'DATABASE_ERROR',
  RATE_LIMIT: 'RATE_LIMIT_ERROR',
  UNKNOWN: 'UNKNOWN_ERROR',
};

function categoriseError(err) {
  if (err.name === 'ValidationError' || err.isJoi) return ERROR_CATEGORIES.VALIDATION;
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return ERROR_CATEGORIES.VALIDATION;
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
    return ERROR_CATEGORIES.AUTH;
  if (err.name === 'CastError' && err.kind === 'ObjectId')
    return ERROR_CATEGORIES.VALIDATION;
  if (err.message?.includes('ML service') || err.message?.includes('SHAP'))
    return ERROR_CATEGORIES.ML_SERVICE;
  if (err.message?.includes('Gemini') || err.message?.includes('generativelanguage'))
    return ERROR_CATEGORIES.GEMINI;
  if (err.message?.includes('AMFI') || err.message?.includes('Yahoo') || err.message?.includes('market'))
    return ERROR_CATEGORIES.MARKET_DATA;
  if (err.name === 'MongoServerError' && err.code === 11000)
    return ERROR_CATEGORIES.CONFLICT;
  if (err.name?.startsWith('Mongo') || err.name?.startsWith('Mongoose') || err.message?.includes('buffering timed out'))
    return ERROR_CATEGORIES.DATABASE;
  return ERROR_CATEGORIES.UNKNOWN;
}

const CLIENT_MESSAGES = {
  [ERROR_CATEGORIES.VALIDATION]: 'Invalid request data.',
  [ERROR_CATEGORIES.AUTH]: 'Authentication failed.',
  [ERROR_CATEGORIES.NOT_FOUND]: 'The requested resource was not found.',
  [ERROR_CATEGORIES.CONFLICT]: 'A resource with this data already exists.',
  [ERROR_CATEGORIES.ML_SERVICE]: 'Recommendation engine temporarily unavailable.',
  [ERROR_CATEGORIES.GEMINI]: 'AI advisory service temporarily unavailable.',
  [ERROR_CATEGORIES.MARKET_DATA]: 'Live market data temporarily unavailable.',
  [ERROR_CATEGORIES.DATABASE]: 'Database operation failed.',
  [ERROR_CATEGORIES.RATE_LIMIT]: 'Too many requests. Please try again later.',
  [ERROR_CATEGORIES.UNKNOWN]: 'An unexpected error occurred.',
};

function requestId(req) {
  if (req?.correlationId) return req.correlationId;
  const provided = req?.headers?.['x-request-id'];
  if (typeof provided === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(provided)) return provided;
  if (req) req.correlationId = randomUUID();
  return req?.correlationId || randomUUID();
}

/**
 * Canonical public error envelope. `error` is retained as a compatibility
 * alias while new clients should consume `message`, `code`, and `request_id`.
 */
export function errorEnvelope(req, message, code, details) {
  const body = {
    error: message,
    message,
    code,
    request_id: requestId(req),
  };
  if (details !== undefined) body.details = details;
  return body;
}

export function sendError(req, res, status, message, code, details) {
  return res.status(status).json(errorEnvelope(req, message, code, details));
}

import mongoose from 'mongoose';

export function errorHandler(err, req, res, _next) {
  const category = categoriseError(err);
  const rawStatus = Number(err.status || err.statusCode);
  let status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 500;

  // Enhance database error categorization for connection/network loss to return 503
  if (category === ERROR_CATEGORIES.DATABASE) {
    const isConnectionError = 
      err.name === 'MongoNetworkError' ||
      err.name === 'MongoTimeoutError' ||
      err.message?.includes('connection') ||
      err.message?.includes('topology') ||
      err.message?.includes('replica set') ||
      err.message?.includes('pool') ||
      err.message?.includes('buffering timed out') ||
      mongoose.connection.readyState !== 1;
    if (isConnectionError) {
      status = 503;
      err.clientMessage = 'Database service temporarily unavailable.';
    }
  }

  // Response time tracking (if start time was recorded)
  const responseTimeMs = req._startTime
    ? Date.now() - req._startTime
    : null;

  // Structured JSON log — easy to grep in production
  const logEntry = {
    timestamp: new Date().toISOString(),
    category,
    status,
    method: req.method,
    path: req.originalUrl || req.path,
    userId: req.user?.userId || 'anonymous',
    requestId: req.correlationId || req.headers['x-request-id'] || null,
    responseTimeMs,
    message: err.message,
  };

  // Security-specific logging for auth failures
  if (category === ERROR_CATEGORIES.AUTH || status === 401 || status === 403) {
    logEntry.securityEvent = true;
    logEntry.ip = req.ip || req.connection?.remoteAddress || 'unknown';
    logEntry.userAgent = (req.headers['user-agent'] || 'unknown').substring(0, 100);
    logger.warn('Auth failure security event', {
      method: req.method,
      path: req.originalUrl,
      ip: logEntry.ip,
      userAgent: logEntry.userAgent,
    });
  }

  // Only include stack traces in development
  if (process.env.NODE_ENV === 'development') {
    logEntry.stack = err.stack;
  }

  if (status >= 500) {
    logger.error('Server error handled', { logEntry, err });
  } else {
    logger.warn('Client request warning handled', { logEntry });
  }

  // Prevent double-sending if headers already sent
  if (res.headersSent) return _next(err);

  // Safe client response — never expose internals
  const message = err.clientMessage || CLIENT_MESSAGES[category];
  const publicCode = typeof err.code === 'string' && /^[A-Z0-9_]+$/.test(err.code)
    ? err.code
    : category;
  return sendError(req, res, status, message, publicCode, err.clientDetails);
}

/**
 * Async route wrapper — catches rejected promises and forwards to error handler.
 * Use this instead of try/catch in every route.
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise
 * @returns {Function} Express middleware
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create an operational error with a specific status code and client message.
 *
 * @param {number} status - HTTP status code
 * @param {string} message - Internal message for logging
 * @param {string} [clientMessage] - Safe message for the client
 * @returns {Error}
 */
export function createError(status, message, clientMessage, options = {}) {
  const err = new Error(message);
  err.status = status;
  if (clientMessage) err.clientMessage = clientMessage;
  if (options.code) err.code = options.code;
  if (options.details !== undefined) err.clientDetails = options.details;
  return err;
}
