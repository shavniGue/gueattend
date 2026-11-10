/**
 * Authentication and Role-Based Access Control (RBAC) Middleware
 * gueattend Unified University ERP
 */

const db = require('../database/db');

/**
 * Ensures user is authenticated via session
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/api/')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in to gueattend.',
        code: 'UNAUTHORIZED',
      });
    }
    return res.redirect('/login');
  }
  next();
}

/**
 * Enforces role restriction (e.g. 'admin', 'faculty', 'student')
 */
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
        code: 'UNAUTHORIZED',
      });
    }

    try {
      const user = await db.getUserById(req.session.userId);
      if (!user || !user.is_active || user.is_suspended) {
        req.session.destroy(() => {});
        return res.status(403).json({
          success: false,
          error: 'Your account is inactive or suspended. Contact university administrator.',
          code: 'ACCOUNT_SUSPENDED',
        });
      }

      req.user = user;

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({
          success: false,
          error: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}.`,
          code: 'FORBIDDEN',
        });
      }

      next();
    } catch (err) {
      console.error('[auth-middleware] Error verifying user role:', err.message);
      return res.status(500).json({ success: false, error: 'Internal server error verifying access permissions.' });
    }
  };
}

const requireAdmin = requireRole('admin');
const requireFaculty = requireRole('faculty', 'admin');
const requireStudent = requireRole('student', 'admin');

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requireFaculty,
  requireStudent,
};

