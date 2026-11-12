/**
 * Authentication and Fine-Grained Role-Based Access Control (RBAC) Middleware
 * gueattend Unified University ERP
 */

const db = require('../database/db');

function isApiRequest(req) {
  return (
    req.xhr ||
    req.headers.accept?.includes('json') ||
    req.path.startsWith('/api/') ||
    req.originalUrl.startsWith('/api/')
  );
}

function resolveEffectiveRole(user) {
  if (!user) return 'student';
  if (user.role === 'admin' && user.is_admin === true) return 'admin';
  if (user.role === 'admin') return 'student';
  return user.role || 'student';
}

async function hydrateAndCheckActiveUser(req, res) {
  if (!db.pool) {
    // Allow isolated non-DB static/unit checks cleanly only when session already holds role
    req.user = { id: req.session.userId, role: req.session.role || 'student' };
    return req.user;
  }

  const user = await db.getUserById(req.session.userId);
  if (!user || !user.is_active || user.is_suspended) {
    req.session.destroy(() => {});
    if (isApiRequest(req)) {
      res.status(403).json({
        success: false,
        error: 'Your account is inactive or suspended. Contact university administrator.',
        code: 'ACCOUNT_SUSPENDED',
      });
    } else {
      res.redirect('/login');
    }
    return null;
  }

  const effectiveRole = resolveEffectiveRole(user);
  user.role = effectiveRole;
  req.user = user;
  req.session.role = effectiveRole;
  return user;
}

/**
 * Ensures user is authenticated via active session
 */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (isApiRequest(req)) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in to gueattend.',
        code: 'UNAUTHORIZED',
      });
    }
    return res.redirect('/login');
  }

  try {
    const user = await hydrateAndCheckActiveUser(req, res);
    if (!user) return;
    return next();
  } catch (err) {
    console.error('[auth-middleware] Error verifying authenticated user:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error verifying session.' });
  }
}

/**
 * Enforces role restriction (e.g. 'admin', 'faculty', 'student')
 */
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.session || !req.session.userId) {
      if (isApiRequest(req)) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.',
          code: 'UNAUTHORIZED',
        });
      }
      return res.redirect('/login');
    }

    try {
      const user = await hydrateAndCheckActiveUser(req, res);
      if (!user) return;

      if (!allowedRoles.includes(user.role)) {
        if (isApiRequest(req)) {
          return res.status(403).json({
            success: false,
            error: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}.`,
            code: 'FORBIDDEN',
          });
        }
        return res.redirect('/dashboard');
      }

      return next();
    } catch (err) {
      console.error('[auth-middleware] Error verifying user role:', err.message);
      return res.status(500).json({ success: false, error: 'Internal server error verifying access permissions.' });
    }
  };
}

/**
 * Fine-grained permission guard allowing either resource owner OR elevated roles.
 */
function requireOwnerOrRole(ownerUserIdResolver, ...elevatedRoles) {
  return async (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'Authentication required.', code: 'UNAUTHORIZED' });
    }

    try {
      const user = await hydrateAndCheckActiveUser(req, res);
      if (!user) return;

      if (elevatedRoles.includes(user.role)) {
        return next();
      }

      const ownerUserId = await ownerUserIdResolver(req);
      if (ownerUserId && ownerUserId === user.id) {
        return next();
      }

      return res.status(403).json({
        success: false,
        error: 'Access denied for this university resource.',
        code: 'FORBIDDEN',
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Permission check failed.' });
    }
  };
}

const requireAdmin = requireRole('admin');
const requireFaculty = requireRole('faculty', 'admin');
const requireStudent = requireRole('student', 'admin');

module.exports = {
  requireAuth,
  requireRole,
  requireOwnerOrRole,
  requireAdmin,
  requireFaculty,
  requireStudent,
  resolveEffectiveRole,
};
