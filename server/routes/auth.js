import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { validate, registerSchema, loginSchema } from '../validation/schemas.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { verifyJWT, verifyJWTWithRevocationAvailability } from '../middleware/authMiddleware.js';
import { blacklistToken, tokenRevocationMustFailClosed } from '../config/redis.js';
import {
  clearAuthCookies,
  createSessionToken,
  ensureCsrfCookie,
  setAuthCookies,
  shouldExposeBearerToken,
} from '../services/authSession.js';

const router = Router();

// Authentication responses can contain session-derived identity data and must
// never be stored by browsers, proxies, or shared caches.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
});

/**
 * POST /api/auth/register
 * Creates a new user account and returns a JWT.
 */
router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password, mobile } = req.body;

  // SECURITY: Hash password FIRST, before checking email existence.
  // This ensures both "email exists" and "email new" paths take the same ~250ms
  // from bcrypt, preventing timing-based email enumeration attacks.
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw createError(409, `Registration attempt with existing email: ${email}`, 'Email already registered.');
  }

  // Wrap create in try/catch to handle the race condition where two concurrent
  // requests both pass the findOne check but only one can insert (unique index).
  let user;
  try {
    user = await User.create({ name: name.trim(), email, mobile, passwordHash });
  } catch (err) {
    if (err.code === 11000) {
      // MongoDB duplicate key error — concurrent registration with same email
      throw createError(409, `Concurrent registration race for: ${email}`, 'Email already registered.');
    }
    throw err; // Re-throw non-duplicate errors
  }

  const token = createSessionToken(user);
  const csrfToken = setAuthCookies(res, token);

  res.status(201).json({
    ...(shouldExposeBearerToken() ? { token } : {}),
    csrfToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
}));

/**
 * POST /api/auth/login
 * Authenticates a user and returns a JWT.
 */
// Dummy hash for constant-time rejection when user not found.
// This prevents timing attacks that reveal email existence.
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lz0Yqn4F5s5sUuQ7v8r9t0u1v2w3x4y5z6a7b8c9d0e1f2';

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Use the same error message for both "user not found" and "wrong password"
  // to prevent email enumeration attacks
  const INVALID_CREDS = 'Invalid credentials.';

  // Must explicitly select passwordHash (hidden by default via select:false)
  const user = await User.findOne({ email }).select('+passwordHash');

  // SECURITY: Always run bcrypt.compare to maintain constant response time.
  // Without this, a missing user returns ~0ms (no compare) vs ~200ms (with compare),
  // creating a timing oracle that reveals whether an email is registered.
  const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    throw createError(401, `Failed login for email: ${email}`, INVALID_CREDS);
  }

  const token = createSessionToken(user);
  const csrfToken = setAuthCookies(res, token);

  res.json({
    ...(shouldExposeBearerToken() ? { token } : {}),
    csrfToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role || 'user',
      createdAt: user.createdAt,
    },
  });
}));

/**
 * POST /api/auth/logout [Protected]
 * Revokes the current user's session JWT.
 */
router.post('/logout', verifyJWTWithRevocationAvailability, asyncHandler(async (req, res) => {
  clearAuthCookies(res);
  const { jti, exp } = req.user;
  const required = tokenRevocationMustFailClosed();
  const remainingTime = Number.isFinite(exp) ? exp - Math.floor(Date.now() / 1000) : 0;
  const revoked = jti && remainingTime > 0
    ? await blacklistToken(jti, remainingTime)
    : false;
  if (required && !revoked) {
    throw createError(
      503,
      'JWT revocation could not be durably confirmed.',
      'Logout could not be completed securely. Please retry.',
      { code: 'TOKEN_REVOCATION_UNAVAILABLE' },
    );
  }
  res.json({ message: 'Logout successful.' });
}));

/**
 * GET /api/auth/session [Protected]
 * Restores the authenticated browser session without exposing the JWT.
 */
router.get('/session', verifyJWT, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).lean();
  if (!user) {
    clearAuthCookies(res);
    throw createError(401, `Session user not found: ${req.user.userId}`, 'Session is no longer valid.');
  }
  const csrfToken = ensureCsrfCookie(req, res);
  res.json({
    csrfToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role || 'user',
      createdAt: user.createdAt,
    },
  });
}));

export default router;
