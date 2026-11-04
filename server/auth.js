/**
 * auth.js — a shared-password gate for the public demo deployment, not a
 * real user-accounts system. One password, set once as an env var, shared
 * with whoever should be able to open the demo (e.g. hackathon judges) so
 * the live Cloud Run URL isn't wide open to anyone who finds it — reading
 * the ledger, running the agent, and burning the shared Gemini key.
 *
 * ACCESS_PASSWORD unset (the default) means the gate is off entirely —
 * same opt-in-via-env-var convention as USE_MOCK, FIRESTORE_ENABLED, and
 * SEND_REAL_EMAIL elsewhere in this codebase, so local dev and a
 * deployment that hasn't set this up yet behave exactly as before this
 * file existed.
 *
 * Session is a signed, expiring cookie rather than server-side session
 * state, because Cloud Run can run multiple instances with nothing shared
 * between them — an in-memory session map would randomly log people out
 * depending which instance handled the next request.
 */

const crypto = require('crypto');

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const AUTH_ENABLED = Boolean(ACCESS_PASSWORD);

// Falls back to a derivation of the password itself so the gate works with
// zero extra configuration beyond setting ACCESS_PASSWORD. Set SESSION_SECRET
// explicitly to rotate the signing key without changing the shared password.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`collectai-session:${ACCESS_PASSWORD}`).digest('hex');

const COOKIE_NAME = 'collectai_session';
// A shared-password gate protects the demo from strangers, not one visitor
// from another — there's nothing per-person to expire quickly. 30 days
// means "open the link once, it just works" for the length of a judging
// window, rather than people re-entering a shared password every session.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(payload) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return false;
  const sepIndex = token.lastIndexOf('.');
  if (sepIndex === -1) return false;
  const payload = token.slice(0, sepIndex);
  const sig = token.slice(sepIndex + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const expiresAt = Number(payload.split(':')[1]);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function makeSessionCookieValue() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return sign(`collectai:${expiresAt}`);
}

/** Express doesn't parse req.cookies without the cookie-parser middleware —
 *  rather than add a dependency for one read-only lookup, this reads the
 *  one cookie we care about directly off the raw header. */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  });
  return out;
}

function isAuthenticated(req) {
  if (!AUTH_ENABLED) return true;
  const cookies = parseCookies(req.headers.cookie);
  return verify(cookies[COOKIE_NAME]);
}

/** Constant-time password comparison — this is a shared demo password, not
 *  a high-value secret, but there's no cost to doing this correctly. */
function checkPassword(candidate) {
  if (!AUTH_ENABLED) return false;
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(ACCESS_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Express middleware: 401s JSON requests instead of redirecting, since
 *  every caller here is the SPA's fetch client, not a browser navigation —
 *  the frontend reacts to the 401 (or to GET /api/auth/status) by showing
 *  the password gate screen itself. */
function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({
    error: 'Not authenticated',
    details: 'This demo is password-protected.',
  });
}

module.exports = {
  AUTH_ENABLED,
  COOKIE_NAME,
  SESSION_TTL_MS,
  isAuthenticated,
  checkPassword,
  makeSessionCookieValue,
  requireAuth,
};
