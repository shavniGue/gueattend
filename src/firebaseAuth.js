/**
 * Module 1: Student Identity & Multi-Tenancy (Firebase Auth)
 * gueattend - Google Firebase Authentication Admin & Multi-Tenant Isolation
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const { getFirebaseApp, isAdminEmail } = require('./config/firebase');
const db = require('./database/db');

function hasValidFirebaseApiKey() {
  const key = (process.env.FIREBASE_API_KEY || '').trim();
  return Boolean(key && !key.includes('FakeKey') && !key.includes('your_'));
}

/**
 * Return public Firebase web config for client-side pre-warming
 */
function getFirebaseWebConfig() {
  const configured = hasValidFirebaseApiKey();
  return {
    configured,
    apiKey: configured ? process.env.FIREBASE_API_KEY.trim() : '',
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

  const isAdminClaim = Boolean(decodedToken.admin) || decodedToken.role === 'admin' || isAdminEmail(email);
  let user = await db.getUserByEmail(email);

  if (!user) {
    const fullName = decodedToken.name || email.split('@')[0];
    const newUserId = `usr_${crypto.randomUUID()}`;
    const seedSecret = optionalPassword || crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(seedSecret, 10);
    const assignedRole = isAdminClaim ? 'admin' : 'student';
    const isVerifiedInitial = Boolean(decodedToken.email_verified) || isAdminClaim;

    const newUserRes = await db.query(
      `INSERT INTO users (
         id, email, full_name, password_hash, firebase_uid, role, is_admin,
         email_verified, is_active, is_suspended, qums_session_status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, FALSE, 'disconnected', NOW(), NOW())
       RETURNING *`,
      [newUserId, email, fullName, passwordHash, decodedToken.uid, assignedRole, isAdminClaim, isVerifiedInitial]
    );
    user = newUserRes.rows[0];

    if (assignedRole === 'student') {
      await db.ensureStudentProfile(user.id, email).catch(() => {});
    }
  } else {
    const isVerifiedNow = Boolean(decodedToken.email_verified) || Boolean(user.email_verified) || isAdminClaim;
    const effectiveRole = (user.role === 'admin' || user.is_admin === true || isAdminClaim)
      ? 'admin'
      : (user.role || 'student');
    const isAdminFlag = effectiveRole === 'admin';

    if (optionalPassword) {
      const syncedHash = await bcrypt.hash(optionalPassword, 10);
      await db.query(
        `UPDATE users
         SET firebase_uid = $1, email_verified = $2, role = $3, is_admin = $4, password_hash = $5, updated_at = NOW()
         WHERE id = $6`,
        [decodedToken.uid, isVerifiedNow, effectiveRole, isAdminFlag, syncedHash, user.id]
      ).catch(() => {});
    } else {
      await db.query(
        `UPDATE users
         SET firebase_uid = $1, email_verified = $2, role = $3, is_admin = $4, updated_at = NOW()
         WHERE id = $5`,
        [decodedToken.uid, isVerifiedNow, effectiveRole, isAdminFlag, user.id]
      ).catch(() => {});
    }

    user.email_verified = isVerifiedNow;
    user.role = effectiveRole;
    user.is_admin = isAdminFlag;

    if (effectiveRole === 'student') {
      await db.ensureStudentProfile(user.id, email).catch(() => {});
    }
  }

  // Check active / suspension status
  if (user.is_active === false || user.is_suspended) {
    const err = new Error('Your account has been suspended. Please contact the administrator.');
    err.statusCode = 403;
    throw err;
  }

  // Check email verification status for students
  if (user.role === 'student' && !decodedToken.email_verified && !user.email_verified) {
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
  if (user.role === 'admin' || user.is_admin === true) {
    redirect = '/admin';
  } else if (user.role === 'faculty') {
    redirect = '/faculty';
  } else {
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

      const user = await db.getUserByEmail(decodedToken.email);
      if (user) {
        req.session.userId = user.id;
        req.session.role = (user.role === 'admin' || user.is_admin === true) ? 'admin' : user.role;
        req.currentUser = user;
      }
      return next();
    } catch (err) {
      console.warn('[firebaseAuth] Invalid Firebase ID Token:', err.message);
      return res.status(401).json({ success: false, error: 'Invalid or expired Firebase authentication token.' });
    }
  }

  if (req.session && req.session.userId) {
    return next();
  }

  return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
}

module.exports = {
  hasValidFirebaseApiKey,
  getFirebaseWebConfig,
  establishSessionFromIdToken,
  verifyFirebaseTokenMiddleware,
};
