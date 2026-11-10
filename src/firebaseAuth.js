/**
 * Module 1: Student Identity & Multi-Tenancy (Firebase Auth)
 * gueattend - Google Firebase Authentication Admin & Multi-Tenant Isolation
 */

const { getAuth } = require('firebase-admin/auth');
const { getFirebaseApp } = require('./config/firebase');
const db = require('./database/db');

/**
 * Middleware: Verify Firebase ID Token or existing session
 */
async function verifyFirebaseTokenMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.split('Bearer ')[1].trim();
    try {
      const app = getFirebaseApp();
      if (!app) {
        return res.status(503).json({ success: false, error: 'Firebase authentication service unavailable.' });
      }

      const decodedToken = await getAuth(app).verifyIdToken(idToken);
      req.firebaseUser = decodedToken;

      // Sync or lookup corresponding student user in Supabase
      const user = await db.getUserByEmail(decodedToken.email);
      if (user) {
        req.session.userId = user.id;
        req.session.role = user.role;
        req.currentUser = user;
      }
      return next();
    } catch (err) {
      console.warn('[firebaseAuth] Invalid Firebase ID Token:', err.message);
      return res.status(401).json({ success: false, error: 'Invalid or expired Firebase authentication token.' });
    }
  }

  // Fallback to active session
  if (req.session && req.session.userId) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
}

module.exports = {
  verifyFirebaseTokenMiddleware,
};
