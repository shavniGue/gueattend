/**
 * Module 1: Student Identity & Multi-Tenancy (Firebase Auth)
 * gueattend - Google Firebase Authentication Admin & Multi-Tenant Isolation
 */

const { getAuth } = require('firebase-admin/auth');
const { getFirebaseApp } = require('./config/firebase');
const db = require('./database/db');

/**
 * Return public Firebase web config for client-side pre-warming
 */
function getFirebaseWebConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyFakeKeyForPrewarming_Gueattend2026',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'gueattend.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'gueattend',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gueattend.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '366802350784',
    appId: process.env.FIREBASE_APP_ID || '1:366802350784:web:d1222169119b1f56967325',
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || 'G-EFR2J8WCH0',
  };
}

/**
 * Establish Express session from Firebase ID Token (Tier 1 Web App Login)
 */
async function establishSessionFromIdToken(req, res, idToken, optionalPassword) {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase authentication service is not configured.');
  }

  const decodedToken = await getAuth(app).verifyIdToken(idToken);
  const email = (decodedToken.email || '').toLowerCase().trim();
  if (!email) {
    throw new Error('Firebase token does not contain a verified email address.');
  }

  let user = await db.getUserByEmail(email);

  if (!user) {
    // Auto-provision student account in Supabase
    const fullName = decodedToken.name || email.split('@')[0];
    const newUserId = `usr_${require('crypto').randomUUID()}`;
    const newUserRes = await db.query(
      `INSERT INTO users (id, email, full_name, firebase_uid, role, email_verified, is_active, is_suspended, qums_session_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'student', $5, TRUE, FALSE, 'disconnected', NOW(), NOW())
       RETURNING *`,
      [newUserId, email, fullName, decodedToken.uid, Boolean(decodedToken.email_verified)]
    );
    user = newUserRes.rows[0];

    // Seed student profile
    const studentQid = email.split('@')[0].replace(/[^0-9]/g, '') || `2403${Math.floor(1000 + Math.random() * 9000)}`;
    await db.query(
      `INSERT INTO students (user_id, student_id, enrollment_number, program, current_semester, academic_year)
       VALUES ($1, $2, $2, 'B.Tech Computer Science & Engineering', 5, '2025-2026')
       ON CONFLICT DO NOTHING`,
      [user.id, studentQid]
    ).catch(() => {});
  } else {
    // Update firebase UID & verification status
    const isVerifiedNow = Boolean(decodedToken.email_verified) || Boolean(user.email_verified);
    await db.query(
      `UPDATE users SET firebase_uid = $1, email_verified = $2, updated_at = NOW() WHERE id = $3`,
      [decodedToken.uid, isVerifiedNow, user.id]
    ).catch(() => {});
    user.email_verified = isVerifiedNow;
  }

  // Check suspension status
  if (user.is_suspended) {
    const err = new Error('Your account has been suspended. Please contact the administrator.');
    err.statusCode = 403;
    throw err;
  }

  // Check email verification status for students
  if (user.role === 'student' && !decodedToken.email_verified && user.email_verified === false) {
    const err = new Error('Please verify your email before logging in. Check your inbox for the verification link.');
    err.statusCode = 403;
    err.emailNotVerified = true;
    throw err;
  }

  // Create Express session
  req.session.userId = user.id;
  req.session.role = user.role || 'student';
  req.session.firebaseUid = decodedToken.uid;

  // Redirection Logic
  let redirect = '/dashboard';
  if (user.role === 'admin') {
    redirect = '/admin';
  } else if (user.role === 'faculty') {
    redirect = '/faculty';
  } else {
    // Check if college ERP is connected
    const creds = require('./credentials');
    const hasCookies = creds.loadSessionCookies(user.id);
    const isConnected = user.qums_session_status === 'connected' || Boolean(hasCookies);
    redirect = isConnected ? '/dashboard' : '/qums-setup';
  }

  return {
    ok: true,
    user,
    redirect,
  };
}

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
  getFirebaseWebConfig,
  establishSessionFromIdToken,
  verifyFirebaseTokenMiddleware,
};
