/**
 * Module 1: Student Identity & Multi-Tenancy (Firebase Auth)
 * gueattend - Google Firebase Authentication Admin & Multi-Tenant Isolation
 */

const crypto = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const {
  getFirebaseApp,
  hasServiceAccountCredential,
  setAuthenticatedUserClaim,
} = require('./config/firebase');
const db = require('./database/db');

const FIREBASE_PASSWORD_SENTINEL = '!FIREBASE_MANAGED_DO_NOT_USE!';

/**
 * Ensures the Firebase user has custom claim `role = "authenticated"` for Supabase Third-Party Auth,
 * while keeping application roles (`student`, `faculty`, `admin`) separate in `app_role` and `public.users.role`.
 */
async function ensureFirebaseAuthenticatedClaim(decodedOrUid, appRole = 'student') {
  const uid = typeof decodedOrUid === 'string' ? decodedOrUid : decodedOrUid?.uid;
  if (!uid) {
    return { claimAssigned: false, tokenRefreshRequired: false };
  }

  if (
    typeof decodedOrUid === 'object' &&
    decodedOrUid.role === 'authenticated' &&
    (!appRole || decodedOrUid.app_role === appRole)
  ) {
    return { claimAssigned: false, tokenRefreshRequired: false, claims: decodedOrUid };
  }

  if (!hasServiceAccountCredential()) {
    return {
      claimAssigned: false,
      tokenRefreshRequired: false,
      requiresServiceAccount: true,
    };
  }

  try {
    const res = await setAuthenticatedUserClaim(uid, appRole);
    return {
      claimAssigned: Boolean(res.updated || res.claims?.role === 'authenticated'),
      tokenRefreshRequired: Boolean(res.updated),
      claims: res.claims,
    };
  } catch (err) {
    console.warn(`[firebaseAuth] Could not assign role=authenticated claim for ${uid}:`, err.message);
    return { claimAssigned: false, tokenRefreshRequired: false, error: err.message };
  }
}

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
 * Establish Express session from verified Firebase ID Token (Single Identity Provider).
 * Never grants access by email alone, never stores Firebase passwords in Supabase,
 * and never grants admin privileges through public signup.
 */
async function establishSessionFromIdToken(req, res, idToken) {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase authentication service is not configured.');
  }

  const decodedToken = await getAuth(app).verifyIdToken(idToken);
  const email = (decodedToken.email || '').toLowerCase().trim();
  if (!email) {
    throw new Error('Firebase token does not contain an email address.');
  }

  // Primary lookup strictly by verified Firebase UID
  let user = await db.getUserByFirebaseUid(decodedToken.uid);

  if (!user) {
    // Fallback lookup by email ONLY to bind a pre-seeded account that has no firebase_uid yet
    const byEmail = await db.getUserByEmail(email);
    if (byEmail) {
      if (byEmail.firebase_uid && byEmail.firebase_uid !== decodedToken.uid) {
        await db.recordAuditLog({
          userId: byEmail.id,
          action: 'FIREBASE_UID_MISMATCH',
          resource: 'auth:login',
          details: {
            email,
            existingFirebaseUid: byEmail.firebase_uid,
            incomingFirebaseUid: decodedToken.uid,
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        }).catch(() => {});

        const err = new Error(
          'This email is already linked to a different authentication identity. Please recover access via your original sign-in method or contact an administrator.'
        );
        err.statusCode = 409;
        throw err;
      }

      if (!decodedToken.email_verified) {
        const err = new Error('Please verify your email first before linking this account.');
        err.statusCode = 403;
        err.emailNotVerified = true;
        throw err;
      }

      // Safely bind Firebase UID while preserving existing DB role (e.g. bootstrapped admin or faculty)
      await db.query(
        `UPDATE users
         SET firebase_uid = $1, email_verified = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [decodedToken.uid, byEmail.id]
      );
      user = await db.getUserById(byEmail.id);

      await db.recordAuditLog({
        userId: user.id,
        action: 'FIREBASE_UID_BOUND',
        resource: 'auth:login',
        details: { email, firebaseUid: decodedToken.uid, role: user.role },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});
    }
  }

  if (!user) {
    // Public signup (Email or Google): ALWAYS student role; NEVER grant admin via public signup
    const fullName = decodedToken.name || email.split('@')[0];
    const newUserId = `usr_${crypto.randomUUID()}`;
    const isVerifiedInitial = Boolean(decodedToken.email_verified);

    const newUserRes = await db.query(
      `INSERT INTO users (
         id, email, full_name, password_hash, firebase_uid, role, is_admin,
         email_verified, is_active, is_suspended, qums_session_status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'student', FALSE, $6, TRUE, FALSE, 'disconnected', NOW(), NOW())
       RETURNING *`,
      [newUserId, email, fullName, FIREBASE_PASSWORD_SENTINEL, decodedToken.uid, isVerifiedInitial]
    );
    user = newUserRes.rows[0];

    await db.ensureStudentProfile(user.id, email).catch(() => {});
    await db.recordAuditLog({
      userId: user.id,
      action: 'USER_REGISTERED',
      resource: 'auth:firebase-signup',
      details: { email, firebaseUid: decodedToken.uid, provider: decodedToken.firebase?.sign_in_provider || 'firebase' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});
  } else {
    const isVerifiedNow = Boolean(decodedToken.email_verified) || Boolean(user.email_verified);
    if (isVerifiedNow !== Boolean(user.email_verified)) {
      await db.query(
        `UPDATE users SET email_verified = $1, updated_at = NOW() WHERE id = $2`,
        [isVerifiedNow, user.id]
      ).catch(() => {});
      user.email_verified = isVerifiedNow;
    }

    if (user.role === 'student') {
      await db.ensureStudentProfile(user.id, email).catch(() => {});
    }
  }

  // Check active / suspension status
  if (user.is_active === false || user.is_suspended) {
    const err = new Error('Your account has been suspended. Please contact the administrator.');
    err.statusCode = 403;
    throw err;
  }

  // Require verified email for students
  if (user.role === 'student' && !decodedToken.email_verified && !user.email_verified) {
    const err = new Error('Please verify your email before logging in. Check your inbox for the verification link.');
    err.statusCode = 403;
    err.emailNotVerified = true;
    throw err;
  }

  // Admin privileges require BOTH verified Firebase UID mapping AND existing DB admin role
  const effectiveRole = (user.role === 'admin' && user.is_admin === true && user.firebase_uid === decodedToken.uid)
    ? 'admin'
    : (user.role === 'faculty' ? 'faculty' : 'student');

  // Ensure Firebase custom claim `role=authenticated` is assigned for Supabase RLS
  const claimResult = await ensureFirebaseAuthenticatedClaim(decodedToken, effectiveRole);

  // Create Express session
  req.session.userId = user.id;
  req.session.role = effectiveRole;
  req.session.firebaseUid = decodedToken.uid;

  // Redirection Logic
  let redirect = '/dashboard';
  if (effectiveRole === 'admin') {
    redirect = '/admin';
  } else if (effectiveRole === 'faculty') {
    redirect = '/faculty';
  } else {
    const creds = require('./credentials');
    const hasCookies = creds.loadSessionCookies(user.id);
    const isConnected = (user.qums_session_status === 'connected' || user.qums_session_status === 'active') || Boolean(hasCookies);
    redirect = isConnected ? '/dashboard' : '/geu-setup';
  }

  return {
    ok: true,
    user: { ...user, role: effectiveRole },
    redirect,
    tokenRefreshRequired: Boolean(claimResult.tokenRefreshRequired),
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
      req.firebaseClaims = {
        role: decodedToken.role || null,
        appRole: decodedToken.app_role || null,
      };

      const cleanEmail = (decodedToken.email || '').trim().toLowerCase();
      let user = await db.getUserByFirebaseUid(decodedToken.uid);
      if (!user && cleanEmail) {
        const byEmail = await db.getUserByEmail(cleanEmail);
        if (byEmail) {
          if (byEmail.firebase_uid && byEmail.firebase_uid !== decodedToken.uid) {
            return res.status(409).json({
              success: false,
              error: 'Firebase identity does not match existing account record.',
            });
          }
          user = byEmail;
        }
      }
      if (user) {
        if (user.is_active === false || user.is_suspended) {
          return res.status(403).json({ success: false, error: 'Account is inactive or suspended.' });
        }
        const effectiveRole = (user.role === 'admin' && user.is_admin === true && (!user.firebase_uid || user.firebase_uid === decodedToken.uid))
          ? 'admin'
          : (user.role === 'admin' ? 'student' : (user.role || 'student'));
        req.session.userId = user.id;
        req.session.role = effectiveRole;
        req.session.firebaseUid = decodedToken.uid;
        req.currentUser = user;
        req.firebaseClaims.appRole = effectiveRole;
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
  FIREBASE_PASSWORD_SENTINEL,
  hasValidFirebaseApiKey,
  getFirebaseWebConfig,
  ensureFirebaseAuthenticatedClaim,
  establishSessionFromIdToken,
  verifyFirebaseTokenMiddleware,
};
