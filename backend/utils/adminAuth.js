const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const prisma = require('../config/database');
const {
  ensureNewsroomTables,
  hasSubmitterAccess,
  normalizeEmail,
} = require('./newsroomAccess');

const ADMIN_EMAIL = 'anubhavattri07@gmail.com';
const ADMIN_COOKIE_NAME = 'sunwire_admin_session';
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const NEWSROOM_ROLES = {
  ADMIN: 'admin',
  SUBMITTER: 'submitter',
};

function cleanText(value = '') {
  return String(value || '').trim();
}

function getCookieSigningSecret() {
  const secret = cleanText(
    process.env.ADMIN_SESSION_SECRET
    || process.env.SESSION_SECRET
    || process.env.GOOGLE_CLIENT_SECRET
    || process.env.DATABASE_URL
    || ''
  );

  if (!secret) {
    throw new Error('Admin session secret is not configured.');
  }

  return secret;
}

function buildCookiePayload(session = {}) {
  return {
    email: normalizeEmail(session.email),
    name: cleanText(session.name || ''),
    picture: cleanText(session.picture || ''),
    role: cleanText(session.role || ''),
    exp: Number(session.exp || 0),
  };
}

function signSessionPayload(payload = {}) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', getCookieSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function parseCookieHeader(header = '') {
  return String(header || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex <= 0) return acc;
      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function setResponseCookie(res, cookieValue) {
  const existing = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  if (!existing) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }

  const next = Array.isArray(existing) ? [...existing, cookieValue] : [existing, cookieValue];
  res.setHeader('Set-Cookie', next);
}

function setAdminSessionCookie(res, session = {}) {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS;
  const token = signSessionPayload(buildCookiePayload({
    ...session,
    exp,
  }));
  setResponseCookie(res, serializeCookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  }));
  return exp;
}

function clearAdminSessionCookie(res) {
  setResponseCookie(res, serializeCookie(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
    path: '/',
    maxAge: 0,
  }));
}

function parseSignedAdminSession(req) {
  try {
    const cookies = parseCookieHeader(req?.headers?.cookie || '');
    const rawToken = cleanText(cookies[ADMIN_COOKIE_NAME] || '');
    if (!rawToken) return null;

    const [encodedPayload, signature] = rawToken.split('.');
    if (!encodedPayload || !signature) return null;

    const expectedSignature = createHmac('sha256', getCookieSigningSecret())
      .update(encodedPayload)
      .digest('base64url');

    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (providedBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const email = normalizeEmail(payload?.email || '');
    const exp = Number(payload?.exp || 0);
    const role = cleanText(payload?.role || '');
    if (!email || exp <= Math.floor(Date.now() / 1000)) return null;

    return {
      email,
      name: cleanText(payload?.name || ''),
      picture: cleanText(payload?.picture || ''),
      role,
      exp,
    };
  } catch (_) {
    return null;
  }
}

async function resolveNewsroomRole(email = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return '';
  if (normalizedEmail === ADMIN_EMAIL) return NEWSROOM_ROLES.ADMIN;
  await ensureNewsroomTables(prisma);
  if (await hasSubmitterAccess(prisma, normalizedEmail)) return NEWSROOM_ROLES.SUBMITTER;
  return '';
}

async function readAdminSession(req, options = {}) {
  const session = parseSignedAdminSession(req);
  if (!session?.email) return null;

  if (options.trustSignedRole && [NEWSROOM_ROLES.ADMIN, NEWSROOM_ROLES.SUBMITTER].includes(session.role)) {
    return session;
  }

  const resolvedRole = await resolveNewsroomRole(session.email);
  if (!resolvedRole) return null;
  if (session.role && session.role !== resolvedRole) return null;

  return {
    ...session,
    role: resolvedRole,
  };
}

async function verifyGoogleIdToken(idToken = '') {
  const token = cleanText(idToken);
  if (!token) {
    const error = new Error('Google ID token is required.');
    error.statusCode = 401;
    throw error;
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    const error = new Error('Google session could not be verified.');
    error.statusCode = 401;
    throw error;
  }

  const payload = await response.json();
  const email = cleanText(payload?.email || '').toLowerCase();
  const audience = cleanText(payload?.aud || payload?.audience || '');
  const configuredClientId = cleanText(
    process.env.GOOGLE_CLIENT_ID
    || process.env.GOOGLE_AUTH_CLIENT_ID
    || process.env.GOOGLE_OAUTH_CLIENT_ID
    || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    || ''
  );

  if (!email || String(payload?.email_verified || '').toLowerCase() !== 'true') {
    const error = new Error('Google account email could not be verified.');
    error.statusCode = 401;
    throw error;
  }

  if (configuredClientId && audience && audience !== configuredClientId) {
    const error = new Error('Google session audience mismatch.');
    error.statusCode = 401;
    throw error;
  }

  return {
    email,
    name: cleanText(payload?.name || ''),
    picture: cleanText(payload?.picture || ''),
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

function sendUnauthorized(res, statusCode = 403) {
  res.status(statusCode).json({ error: 'Admin access denied.' });
}

async function requireNewsroomSession(req, res, options = {}) {
  const session = await readAdminSession(req);
  const allowedRoles = Array.isArray(options.roles) && options.roles.length
    ? options.roles
    : [NEWSROOM_ROLES.ADMIN];

  if (session?.email && allowedRoles.includes(session.role)) {
    req.user = session;
    return session;
  }

  clearAdminSessionCookie(res);

  if (options.redirectTo) {
    res.statusCode = 302;
    res.setHeader('Location', options.redirectTo);
    res.end();
    return null;
  }

  sendUnauthorized(res, 403);
  return null;
}

async function requireAdminSession(req, res, options = {}) {
  return requireNewsroomSession(req, res, {
    ...options,
    roles: [NEWSROOM_ROLES.ADMIN],
  });
}

async function requireSubmitterSession(req, res, options = {}) {
  return requireNewsroomSession(req, res, {
    ...options,
    roles: [NEWSROOM_ROLES.ADMIN, NEWSROOM_ROLES.SUBMITTER],
  });
}

module.exports = {
  ADMIN_COOKIE_NAME,
  ADMIN_EMAIL,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  NEWSROOM_ROLES,
  clearAdminSessionCookie,
  readAdminSession,
  requireAdminSession,
  requireNewsroomSession,
  requireSubmitterSession,
  resolveNewsroomRole,
  setAdminSessionCookie,
  verifyGoogleIdToken,
};
