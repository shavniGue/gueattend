/**
 * Authentication Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limiter');

// In-memory CAPTCHA store with 5-minute expiry
const captchaStore = new Map();

/**
 * GET /api/auth/captcha
 * Generates a challenge token and simple text CAPTCHA
 */
router.get('/captcha', (req, res) => {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let text = '';
  for (let i = 0; i < 5; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const captchaId = crypto.randomBytes(16).toString('hex');
  captchaStore.set(captchaId, { text: text.toUpperCase(), expiresAt: Date.now() + 5 * 60 * 1000 });

  res.json({
    success: true,
    captchaId,
    captchaText: text, // In production could render to SVG/Canvas
  });
});

/**
 * GET /api/auth/firebase-config
 * Public Firebase Web config for client-side pre-warming (Tier 1)
 */
router.get('/firebase-config', (req, res) => {
  const { getFirebaseWebConfig } = require('../firebaseAuth');
  res.json(getFirebaseWebConfig());
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 25,
  message: 'Too many registration attempts. Please try again shortly.',
});

const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many verification requests. Please wait a few minutes.',
});

/**
 * Cryptographically verifies a Firebase ID token and ensures it belongs to the expected email/UID.
 */
async function verifyRegistrationIdToken(idToken, expectedEmail, expectedUid) {
  if (!idToken) return null;

  const { getAuth } = require('firebase-admin/auth');
  const { getFirebaseApp } = require('../config/firebase');
  const app = getFirebaseApp();
  if (!app) {
    const err = new Error('Firebase authentication service is unavailable.');
    err.statusCode = 503;
    throw err;
  }

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(idToken);
  } catch (verifyErr) {
    const err = new Error('Invalid or expired authentication token.');
    err.statusCode = 401;
    throw err;
  }

  const tokenEmail = (decoded.email || '').trim().toLowerCase();
  if (!tokenEmail || tokenEmail !== expectedEmail) {
    const err = new Error('Authentication token email does not match registration email.');
    err.statusCode = 403;
    throw err;
  }

  if (expectedUid && decoded.uid !== expectedUid) {
    const err = new Error('Authentication token identity mismatch.');
    err.statusCode = 403;
    throw err;
  }

  return decoded;
}

/**
 * Creates a student profile only when the user has student role and no profile exists yet.
 * Never overwrites an existing student's GUeID/student_id.
 */
async function ensureSafeStudentRecord(user, cleanEmail) {
  if (!user || user.role !== 'student') return null;
  const existingStudent = await db.getStudentByUserId(user.id);
  if (existingStudent) return existingStudent;
  return db.ensureStudentProfile(user.id, cleanEmail).catch(() => null);
}

/**
 * Case A (No account exists) or Case D3 (Firebase account exists without DB record).
 */
async function handleNewUserRegistration({ req, res, cleanEmail, fullName, password, decodedToken }) {
  const { isAdminEmail } = require('../config/firebase');
  const role = isAdminEmail(cleanEmail) ? 'admin' : 'student';
  const hash = await bcrypt.hash(password, 10);
  const name = (fullName || cleanEmail.split('@')[0]).trim();
  const newUserId = `usr_${crypto.randomUUID()}`;
  const emailVerified = Boolean(decodedToken?.email_verified);
  // Only persist firebase_uid after server-side Firebase ID token verification.
  const verifiedFirebaseUid = decodedToken ? decodedToken.uid : null;

  const newUserRes = await db.query(
    `INSERT INTO users (id, email, full_name, password_hash, firebase_uid, role, email_verified, is_active, is_suspended, qums_session_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE, 'disconnected', NOW(), NOW())
     RETURNING *`,
    [newUserId, cleanEmail, name, hash, verifiedFirebaseUid, role, emailVerified]
  );
  const user = newUserRes.rows[0];

  const studentProfile = await ensureSafeStudentRecord(user, cleanEmail);

  await db.recordAuditLog({
    userId: user.id,
    action: 'USER_REGISTERED',
    resource: 'auth:register',
    details: {
      email: cleanEmail,
      firebaseUidLinked: Boolean(verifiedFirebaseUid),
      resumedFromFirebase: Boolean(decodedToken),
      emailVerified,
      studentQid: studentProfile?.student_id || null,
    },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({
    success: true,
    ok: true,
    status: emailVerified ? 'ALREADY_VERIFIED' : 'VERIFICATION_REQUIRED',
    resumed: false,
    emailVerified,
    message: emailVerified
      ? 'Your account is already verified and ready. Please sign in.'
      : 'Account created successfully. A verification email has been sent.',
    email: cleanEmail,
  });
}

/**
 * Handles Cases B, C, D, and E when a record already exists in public.users.
 */
async function handleExistingUserRegistration({ req, res, existing, cleanEmail, password, decodedToken }) {
  // Without a verified Firebase ID token, require password ownership before disclosing verification state.
  if (!decodedToken) {
    const passwordMatches = existing.password_hash
      ? await bcrypt.compare(password, existing.password_hash)
      : false;

    if (!passwordMatches) {
      await db.recordAuditLog({
        userId: existing.id,
        action: 'REGISTRATION_UNAUTHENTICATED_RETRY',
        resource: 'auth:register',
        details: { email: cleanEmail },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(409).json({
        success: false,
        ok: false,
        status: 'ACCOUNT_EXISTS_UNAUTHENTICATED',
        error: 'Unable to complete registration for this email directly. If you already have an account or pending verification, please sign in or reset your password.',
      });
    }

    const ensuredStudent = await ensureSafeStudentRecord(existing, cleanEmail);

    if (existing.email_verified) {
      await db.recordAuditLog({
        userId: existing.id,
        action: 'REGISTRATION_ALREADY_VERIFIED',
        resource: 'auth:register',
        details: { email: cleanEmail, studentProfileEnsured: Boolean(ensuredStudent) },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(409).json({
        success: false,
        ok: false,
        status: 'ALREADY_VERIFIED',
        emailVerified: true,
        email: cleanEmail,
        message: 'An account with this email already exists and is verified. Please sign in.',
      });
    }

    await db.recordAuditLog({
      userId: existing.id,
      action: 'REGISTRATION_RESUMED',
      resource: 'auth:register',
      details: { email: cleanEmail, method: 'password_match', studentProfileEnsured: Boolean(ensuredStudent) },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      ok: true,
      status: 'VERIFICATION_REQUIRED',
      resumed: true,
      emailVerified: false,
      email: cleanEmail,
      message: 'Your registration is incomplete and awaiting email verification. Please verify your email or use Resend Link.',
    });
  }

  // Case E: Firebase UID mismatch or unverified Firebase token against an already-verified DB row without UID.
  const hasUidMismatch = Boolean(existing.firebase_uid && existing.firebase_uid !== decodedToken.uid);
  const hasVerifiedStateConflict = Boolean(
    existing.email_verified && !existing.firebase_uid && !decodedToken.email_verified
  );

  if (hasUidMismatch || hasVerifiedStateConflict) {
    await db.recordAuditLog({
      userId: existing.id,
      action: 'REGISTRATION_IDENTITY_CONFLICT',
      resource: 'auth:register',
      details: {
        email: cleanEmail,
        supabaseFirebaseUid: existing.firebase_uid || null,
        incomingFirebaseUid: decodedToken.uid,
        existingEmailVerified: Boolean(existing.email_verified),
        incomingEmailVerified: Boolean(decodedToken.email_verified),
        role: existing.role,
        hasExistingStudentId: Boolean(existing.qums_qid),
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(409).json({
      success: false,
      ok: false,
      status: 'IDENTITY_CONFLICT',
      code: 'IDENTITY_CONFLICT',
      emailVerified: Boolean(decodedToken.email_verified),
      error: 'An earlier profile record exists for this email under a different sign-in state. Your existing university data was preserved safely.',
      message: 'Please verify the email link we sent and sign in on the Login page (or reset your password) to safely recover your account.',
    });
  }

  // Cases B, C, and D (no identity conflict): safely resume incomplete state and preserve roles & GUeID.
  const mergedVerified = Boolean(existing.email_verified || decodedToken.email_verified);
  const needsUidLink = !existing.firebase_uid;
  const needsVerifiedSync = mergedVerified && !existing.email_verified;
  const canUpdatePasswordHash = !existing.email_verified && !existing.qums_qid && existing.role !== 'admin';

  if (needsUidLink || needsVerifiedSync || canUpdatePasswordHash) {
    const nextPasswordHash = canUpdatePasswordHash
      ? await bcrypt.hash(password, 10)
      : existing.password_hash;

    await db.query(
      `UPDATE users
       SET firebase_uid = COALESCE(firebase_uid, $1),
           email_verified = $2,
           password_hash = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [decodedToken.uid, mergedVerified, nextPasswordHash, existing.id]
    );
  }

  const studentExistedBefore = existing.role === 'student' ? Boolean(await db.getStudentByUserId(existing.id)) : true;
  await ensureSafeStudentRecord(existing, cleanEmail);

  const repairedIncompleteState = needsUidLink || needsVerifiedSync || !studentExistedBefore;

  if (mergedVerified) {
    await db.recordAuditLog({
      userId: existing.id,
      action: repairedIncompleteState ? 'REGISTRATION_RESUMED' : 'REGISTRATION_ALREADY_VERIFIED',
      resource: 'auth:register',
      details: {
        email: cleanEmail,
        firebaseUidLinked: needsUidLink,
        emailVerified: true,
        studentProfileRepaired: !studentExistedBefore,
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(409).json({
      success: false,
      ok: false,
      status: 'ALREADY_VERIFIED',
      resumed: repairedIncompleteState,
      emailVerified: true,
      email: cleanEmail,
      message: 'An account with this email already exists and is verified. Please sign in.',
    });
  }

  await db.recordAuditLog({
    userId: existing.id,
    action: 'REGISTRATION_RESUMED',
    resource: 'auth:register',
    details: {
      email: cleanEmail,
      firebaseUidLinked: needsUidLink,
      emailVerified: false,
      studentProfileRepaired: !studentExistedBefore,
    },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({
    success: true,
    ok: true,
    status: 'VERIFICATION_REQUIRED',
    resumed: true,
    emailVerified: false,
    email: cleanEmail,
    message: 'Your registration is pending email verification. Please verify your email or use Resend Link.',
  });
}

/**
 * POST /api/auth/register
 * Platform Registration: Email + Password (NO CAPTCHA) with Email Verification & Safe Recovery
 */
router.post('/register', registerLimiter, async (req, res) => {
  const { fullName, email, password, firebaseUid, idToken } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, ok: false, error: 'Email and password are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanEmail.includes('@')) {
    return res.status(400).json({ success: false, ok: false, error: 'Please enter a valid email address.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ success: false, ok: false, error: 'Password must be at least 6 characters long.' });
  }

  let decodedToken = null;
  if (idToken) {
    try {
      decodedToken = await verifyRegistrationIdToken(idToken, cleanEmail, firebaseUid || null);
    } catch (tokenErr) {
      await db.recordAuditLog({
        userId: null,
        action: 'REGISTRATION_TOKEN_INVALID',
        resource: 'auth:register',
        details: { email: cleanEmail, reason: tokenErr.message },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(() => {});

      return res.status(tokenErr.statusCode || 401).json({
        success: false,
        ok: false,
        error: tokenErr.message || 'Invalid authentication token.',
      });
    }
  }

  try {
    const existing = await db.getUserByEmail(cleanEmail);
    if (!existing) {
      return await handleNewUserRegistration({ req, res, cleanEmail, fullName, password, decodedToken });
    }
    return await handleExistingUserRegistration({ req, res, existing, cleanEmail, password, decodedToken });
  } catch (err) {
    console.error('[auth/register] Error:', err.message);
    return res.status(500).json({ success: false, ok: false, error: 'Failed to process registration.' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Rate-limited and privacy-safe verification resend audit endpoint
 */
router.post('/resend-verification', resendVerificationLimiter, async (req, res) => {
  const { email, idToken } = req.body || {};
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    let decodedToken = null;
    if (idToken) {
      decodedToken = await verifyRegistrationIdToken(idToken, cleanEmail, null);
    }

    const user = await db.getUserByEmail(cleanEmail);
    if (user) {
      await db.recordAuditLog({
        userId: user.id,
        action: 'VERIFICATION_RESEND_REQUESTED',
        resource: 'auth:resend-verification',
        details: {
          email: cleanEmail,
          authenticatedViaFirebase: Boolean(decodedToken),
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return res.json({
      success: true,
      message: 'If this account is awaiting verification, use the verification email sent to your inbox or sign in on the Login page to request another link.',
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[auth/resend-verification] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Could not process verification resend request.' });
  }
});

/**
 * Core Login Handler (NO CAPTCHA on Platform Login!)
 */
async function handleUserLogin(req, res) {
  const { identifier, email, password, idToken } = req.body;
  const targetEmailOrId = email || identifier;

  // 1. Tier 1: Firebase ID Token authentication (Google Firebase signed JWT)
  if (idToken) {
    try {
      const { establishSessionFromIdToken } = require('../firebaseAuth');
      const outcome = await establishSessionFromIdToken(req, res, idToken, password);

      await db.recordAuditLog({
        userId: outcome.user.id,
        action: 'FIREBASE_TOKEN_LOGIN',
        resource: 'auth:login',
        details: { email: outcome.user.email, redirect: outcome.redirect },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.json({
        ok: true,
        success: true,
        redirect: outcome.redirect,
        redirectUrl: outcome.redirect,
        user: {
          id: outcome.user.id,
          email: outcome.user.email,
          fullName: outcome.user.full_name,
          role: outcome.user.role,
        },
      });
    } catch (fbErr) {
      console.warn('[auth/login] Firebase ID Token rejected:', fbErr.message);
      if (fbErr.statusCode === 403) {
        return res.status(403).json({
          success: false,
          ok: false,
          emailNotVerified: Boolean(fbErr.emailNotVerified),
          error: fbErr.message,
        });
      }
      if (!password) {
        return res.status(401).json({ success: false, ok: false, error: fbErr.message });
      }
    }
  }

  // 2. Legacy / Bcrypt Fallback (NO CAPTCHA!)
  if (!targetEmailOrId || !password) {
    return res.status(400).json({ success: false, ok: false, error: 'User ID / Email and password are required.' });
  }

  try {
    const cleanId = String(targetEmailOrId).trim().toLowerCase();
    let user = await db.getUserByEmail(cleanId);

    // If not found by email, check student_id / enrollment_number
    if (!user) {
      const stuRes = await db.query(
        `SELECT u.* FROM users u
         JOIN students s ON s.user_id = u.id
         WHERE LOWER(s.student_id) = $1 OR LOWER(s.enrollment_number) = $1`,
        [cleanId]
      );
      if (stuRes.rows.length > 0) {
        user = stuRes.rows[0];
      }
    }

    // If not found by student_id, check faculty employee_id
    if (!user) {
      const facRes = await db.query(
        `SELECT u.* FROM users u
         JOIN faculty f ON f.user_id = u.id
         WHERE LOWER(f.employee_id) = $1`,
        [cleanId]
      );
      if (facRes.rows.length > 0) {
        user = facRes.rows[0];
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, ok: false, error: 'Invalid university credentials.' });
    }

    if (!user.is_active || user.is_suspended) {
      return res.status(403).json({
        success: false,
        ok: false,
        error: 'Your account has been deactivated or suspended. Please contact the university administrator.',
      });
    }

    // Verify Password
    const { hasValidFirebaseApiKey } = require('../firebaseAuth');
    const { isAdminEmail } = require('../config/firebase');
    const match = user.password_hash ? await bcrypt.compare(password, user.password_hash).catch(() => false) : false;

    if (!match) {
      await db.recordAuditLog({
        userId: user.id,
        action: 'FAILED_LOGIN',
        resource: 'auth:login',
        details: { identifier: cleanId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const needsFirebaseKey = !hasValidFirebaseApiKey() && (Boolean(user.firebase_uid) || isAdminEmail(user.email));
      const errMsg = needsFirebaseKey
        ? 'Invalid credentials. (Note: Firebase Auth requires FIREBASE_API_KEY in .env / Render Environment Variables to verify Firebase passwords.)'
        : 'Invalid university credentials.';
      return res.status(401).json({ success: false, ok: false, error: errMsg });
    }

    const effectiveRole = (user.role === 'admin' || user.is_admin === true || isAdminEmail(user.email))
      ? 'admin'
      : (user.role || 'student');

    // Check email verification for student
    if (effectiveRole === 'student' && user.email_verified === false) {
      return res.status(403).json({
        success: false,
        ok: false,
        emailNotVerified: true,
        error: 'Please verify your email before logging in. Check your inbox for the verification link.',
      });
    }

    // Set Session
    req.session.userId = user.id;
    req.session.role = effectiveRole;

    // Determine redirect route based on role & ERP connection status
    let redirectUrl = '/dashboard';
    if (effectiveRole === 'admin') {
      redirectUrl = '/admin';
    } else if (effectiveRole === 'faculty') {
      redirectUrl = '/faculty';
    } else {
      await db.ensureStudentProfile(user.id, user.email).catch(() => {});
      const creds = require('../credentials');
      const hasCookies = creds.loadSessionCookies(user.id);
      const isConnected = user.qums_session_status === 'connected' || Boolean(hasCookies);
      redirectUrl = isConnected ? '/dashboard' : '/qums-setup';
    }

    await db.recordAuditLog({
      userId: user.id,
      action: 'USER_LOGIN',
      resource: 'auth:login',
      details: { role: effectiveRole, redirectUrl },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      ok: true,
      success: true,
      message: 'Login successful.',
      redirect: redirectUrl,
      redirectUrl,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: effectiveRole,
      },
    });
  } catch (err) {
    console.error('[auth/login] Login error:', err.message);
    res.status(500).json({ success: false, ok: false, error: 'Internal server error during authentication.' });
  }
}

/**
 * POST /api/auth/login
 * Unified multi-role login (Student, Faculty, Administrator)
 */
router.post('/login', rateLimit({ windowMs: 60000, maxRequests: 8, message: 'Too many login attempts. Please wait.' }), handleUserLogin);

/**
 * GET /api/auth/me
 * Returns current authenticated profile details
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ success: false, error: 'User not found.' });
    }

    let profile = null;
    if (user.role === 'student') {
      profile = await db.getStudentByUserId(user.id);
    } else if (user.role === 'faculty') {
      profile = await db.getFacultyByUserId(user.id);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        phone: user.phone,
        avatarUrl: user.avatar_url,
      },
      profile,
    });
  } catch (err) {
    console.error('[auth/me] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch current user profile.' });
  }
});

/**
 * POST /api/auth/logout
 * Logs out and clears session
 */
router.post('/logout', (req, res) => {
  const userId = req.session?.userId;
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    if (userId) {
      db.recordAuditLog({
        userId,
        action: 'USER_LOGOUT',
        resource: 'auth:logout',
        ip: req.ip,
      });
    }
    res.json({ success: true, message: 'Logged out successfully.', redirectUrl: '/login' });
  });
});

/**
 * POST /api/auth/forgot-password
 */
router.post('/forgot-password', rateLimit({ maxRequests: 5 }), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

  try {
    const user = await db.getUserByEmail(email);
    // Security: always return success to avoid user enumeration
    if (!user) {
      return res.json({ success: true, message: 'If this email is registered, reset instructions have been dispatched.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `INSERT INTO password_resets (email, token_hash, expires_at, created_at)
       VALUES (LOWER($1), $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at`,
      [email, tokenHash, expiresAt]
    );

    res.json({
      success: true,
      message: 'Password reset link generated.',
      // In dev environment, return the token for testing
      debugResetToken: process.env.NODE_ENV !== 'production' ? token : undefined,
    });
  } catch (err) {
    console.error('[auth/forgot] Error:', err.message);
    res.status(500).json({ success: false, error: 'Error processing password reset.' });
  }
});

/**
 * POST /api/auth/reset-password
 */
router.post('/reset-password', rateLimit({ maxRequests: 5 }), async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resCheck = await db.query(
      `SELECT * FROM password_resets WHERE email = LOWER($1) AND token_hash = $2 AND expires_at > NOW()`,
      [email, tokenHash]
    );

    if (resCheck.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired password reset token.' });
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await db.updateUserPassword(user.id, hash);
    await db.query('DELETE FROM password_resets WHERE email = LOWER($1)', [email]);

    res.json({ success: true, message: 'Password reset successful. You may now log in.' });
  } catch (err) {
    console.error('[auth/reset] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
});

router.handleUserLogin = handleUserLogin;
module.exports = router;

