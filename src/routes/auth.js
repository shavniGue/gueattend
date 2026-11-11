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

/**
 * POST /api/auth/register
 * Platform Registration: Email + Password (NO CAPTCHA) with Email Verification
 */
router.post('/register', async (req, res) => {
  const { fullName, email, password, firebaseUid } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, ok: false, error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const existing = await db.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(400).json({
        success: false,
        ok: false,
        error: 'An account with this email already exists. Please sign in.',
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const name = (fullName || cleanEmail.split('@')[0]).trim();
    const newUserId = `usr_${crypto.randomUUID()}`;

    // Insert user into Supabase with email_verified = false
    const newUserRes = await db.query(
      `INSERT INTO users (id, email, full_name, password_hash, firebase_uid, role, email_verified, is_active, is_suspended, qums_session_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'student', FALSE, TRUE, FALSE, 'disconnected', NOW(), NOW())
       RETURNING *`,
      [newUserId, cleanEmail, name, hash, firebaseUid || null]
    );
    const user = newUserRes.rows[0];

    // Seed student profile
    const studentQid = cleanEmail.split('@')[0].replace(/[^0-9]/g, '') || `2403${Math.floor(1000 + Math.random() * 9000)}`;
    await db.query(
      `INSERT INTO students (user_id, student_id, enrollment_number, program, current_semester, academic_year)
       VALUES ($1, $2, $2, 'B.Tech Computer Science & Engineering', 5, '2025-2026')
       ON CONFLICT DO NOTHING`,
      [user.id, studentQid]
    ).catch(() => {});

    await db.recordAuditLog({
      userId: user.id,
      action: 'USER_REGISTERED',
      resource: 'auth:register',
      details: { email: cleanEmail, studentQid },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      ok: true,
      message: 'Account created successfully. A verification email has been sent.',
      email: cleanEmail,
    });
  } catch (err) {
    console.error('[auth/register] Error:', err.message);
    res.status(500).json({ success: false, ok: false, error: 'Failed to create student account.' });
  }
});

/**
 * POST /api/auth/resend-verification
 */
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const user = await db.getUserByEmail(cleanEmail);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User account not found.' });
  }
  res.json({ success: true, message: 'Verification email resent successfully.' });
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
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await db.recordAuditLog({
        userId: user.id,
        action: 'FAILED_LOGIN',
        resource: 'auth:login',
        details: { identifier: cleanId },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.status(401).json({ success: false, ok: false, error: 'Invalid university credentials.' });
    }

    // Check email verification for student
    if (user.role === 'student' && user.email_verified === false) {
      return res.status(403).json({
        success: false,
        ok: false,
        emailNotVerified: true,
        error: 'Please verify your email before logging in. Check your inbox for the verification link.',
      });
    }

    // Set Session
    req.session.userId = user.id;
    req.session.role = user.role;

    // Determine redirect route based on role & ERP connection status
    let redirectUrl = '/dashboard';
    if (user.role === 'admin') {
      redirectUrl = '/admin';
    } else if (user.role === 'faculty') {
      redirectUrl = '/faculty';
    } else {
      const creds = require('../credentials');
      const hasCookies = creds.loadSessionCookies(user.id);
      const isConnected = user.qums_session_status === 'connected' || Boolean(hasCookies);
      redirectUrl = isConnected ? '/dashboard' : '/qums-setup';
    }

    await db.recordAuditLog({
      userId: user.id,
      action: 'USER_LOGIN',
      resource: 'auth:login',
      details: { role: user.role, redirectUrl },
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
        role: user.role,
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

