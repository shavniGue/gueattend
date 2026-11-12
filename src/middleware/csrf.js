/**
 * CSRF & Cross-Origin Request Protection Middleware
 * Protects state-mutating API endpoints (POST/PUT/PATCH/DELETE) via:
 *  1. Strict Origin / Referer same-origin validation
 *  2. Synchronizer CSRF token (`X-CSRF-Token` / `XSRF-TOKEN` bound to session)
 */

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getOrCreateCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function attachCsrfCookie(req, res, next) {
  if (req.session) {
    const token = getOrCreateCsrfToken(req);
    if (token && !res.headersSent) {
      res.cookie('XSRF-TOKEN', token, {
        httpOnly: false,
        sameSite: 'lax',
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        path: '/',
      });
    }
  }
  next();
}

function extractRequestOriginHost(req) {
  const originHeader = req.headers.origin;
  if (originHeader && originHeader !== 'null') {
    try {
      return new URL(originHeader).host.toLowerCase();
    } catch (e) {
      return '__INVALID_ORIGIN__';
    }
  }
  const refererHeader = req.headers.referer;
  if (refererHeader) {
    try {
      return new URL(refererHeader).host.toLowerCase();
    } catch (e) {
      return '__INVALID_REFERER__';
    }
  }
  return null;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Only guard API routes (static / page routes do not mutate state)
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // 1. Validate same-origin whenever browser sends Origin or Referer
  const requestOriginHost = extractRequestOriginHost(req);
  const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();

  if (requestOriginHost && expectedHost && requestOriginHost !== expectedHost) {
    return res.status(403).json({
      success: false,
      error: 'Cross-origin mutating request blocked by CSRF policy.',
      code: 'CSRF_ORIGIN_MISMATCH',
    });
  }

  // 2. When authenticated session has an issued CSRF token and the browser already holds XSRF-TOKEN cookie,
  // enforce matching X-CSRF-Token header on state-changing requests (excluding login/logout/firebase pre-auth).
  const isAuthBootstrapRoute =
    req.path === '/api/login' ||
    req.path.startsWith('/api/auth/login') ||
    req.path.startsWith('/api/auth/register') ||
    req.path.startsWith('/api/auth/sync-claims') ||
    req.path.startsWith('/api/auth/resend-verification') ||
    req.path === '/api/campus/contact';

  if (!isAuthBootstrapRoute && req.session?.csrfToken) {
    const headerToken = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || req.body?._csrf;
    const cookieHeader = String(req.headers.cookie || '');
    const browserHasXsrfCookie = cookieHeader.includes('XSRF-TOKEN=');

    if (headerToken && headerToken !== req.session.csrfToken) {
      return res.status(403).json({
        success: false,
        error: 'Invalid CSRF security token.',
        code: 'CSRF_TOKEN_INVALID',
      });
    }

    if (browserHasXsrfCookie && headerToken !== req.session.csrfToken) {
      return res.status(403).json({
        success: false,
        error: 'Missing or invalid X-CSRF-Token header.',
        code: 'CSRF_TOKEN_REQUIRED',
      });
    }
  }

  return next();
}

module.exports = {
  getOrCreateCsrfToken,
  attachCsrfCookie,
  csrfProtection,
};
