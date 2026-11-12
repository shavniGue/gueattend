/**
 * Module 2: College ERP (QUMS) Headless Browser Relay Routes
 * gueattend - Playwright Live CAPTCHA Stream & 1-Click Reconnect Endpoints
 */

const express = require('express');
const router = express.Router();
const qumsWeb = require('../qums-login-web');
const { requireAuth } = require('../middleware/auth');
const db = require('../database/db');

/**
 * GET /api/qums/captcha
 * Stream live visual CAPTCHA element as base64 to frontend
 */
router.get('/captcha', requireAuth, async (req, res) => {
  try {
    const challenge = await qumsWeb.getVisualCaptcha(req.session.userId);
    const captchaImg = challenge?.captchaImage || challenge?.captcha || null;
    if (!challenge || !challenge.success || !captchaImg) {
      return res.status(502).json({
        ok: false,
        success: false,
        error: challenge?.error || 'Could not load live CAPTCHA from student.geu.ac.in. Please retry.',
      });
    }
    res.json({
      ok: true,
      success: true,
      captcha: captchaImg,
      captchaImage: captchaImg,
      challengeId: challenge.challengeId,
      expiresInSeconds: challenge.expiresInSeconds || 180,
    });
  } catch (err) {
    console.error('[qums/captcha] Error:', err.message);
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

/**
 * POST /api/qums/start-login
 * Pre-fills username & password in Playwright and screenshots fresh CAPTCHA
 */
router.post('/start-login', requireAuth, async (req, res) => {
  const { qid, password, isReconnect } = req.body;
  try {
    const outcome = await qumsWeb.startQumsLogin({
      userId: req.session.userId,
      qid,
      password,
      isReconnect: Boolean(isReconnect),
    });
    res.json(outcome);
  } catch (err) {
    res.status(400).json({ ok: false, success: false, error: err.message });
  }
});

/**
 * POST /api/qums/submit-captcha
 * Submits human-solved CAPTCHA to active browser session
 */
router.post('/submit-captcha', requireAuth, async (req, res) => {
  const { qid, password } = req.body;
  const captchaAnswer = req.body.captchaAnswer || req.body.captcha || req.body.captchaText;
  try {
    const result = await qumsWeb.submitQumsCaptcha({
      userId: req.session.userId,
      captchaAnswer,
      qid,
      password,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, success: false, error: err.message });
  }
});

/**
 * POST /api/qums/login
 * Full login convenience handler: binds submit with fallback
 */
router.post('/login', requireAuth, async (req, res) => {
  const { qid, password } = req.body;
  const captchaAnswer = req.body.captchaAnswer || req.body.captcha || req.body.captchaText;

  if (!captchaAnswer) {
    return res.status(400).json({ ok: false, success: false, error: 'CAPTCHA answer is required.' });
  }

  try {
    const result = await qumsWeb.submitQumsCaptcha({
      userId: req.session.userId,
      captchaAnswer,
      qid,
      password,
    });
    res.json(result);
  } catch (err) {
    // If no active session, attempt start and submit
    if (qid && password) {
      try {
        await qumsWeb.startQumsLogin({ userId: req.session.userId, qid, password });
        const result = await qumsWeb.submitQumsCaptcha({ userId: req.session.userId, captchaAnswer });
        return res.json(result);
      } catch (innerErr) {
        return res.status(400).json({ ok: false, success: false, error: innerErr.message });
      }
    }
    res.status(400).json({ ok: false, success: false, error: err.message });
  }
});

/**
 * POST /api/qums/reconnect
 * 1-Click Reconnect: Uses vaulted encrypted password with fresh CAPTCHA
 */
router.post('/reconnect', requireAuth, async (req, res) => {
  const { source } = req.body;
  const captchaAnswer = req.body.captchaAnswer || req.body.captcha || req.body.captchaText;
  if (!captchaAnswer) {
    return res.status(400).json({ ok: false, success: false, error: 'Please enter the CAPTCHA.' });
  }

  try {
    const result = await qumsWeb.reconnectQumsSession({
      userId: req.session.userId,
      captchaAnswer,
      source: source || 'web',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, success: false, error: err.message });
  }
});

/**
 * POST /api/qums/disconnect
 */
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const creds = require('../credentials');
    creds.clearSessionCookies(req.session.userId);
    await qumsWeb.cleanupPending(req.session.userId);
    await db.query(
      `UPDATE users SET qums_session_status = 'disconnected', updated_at = NOW() WHERE id = $1`,
      [req.session.userId]
    ).catch(() => {});

    res.json({ ok: true, success: true, message: 'QUMS session disconnected.' });
  } catch (err) {
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

/**
 * GET /api/qums/status
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const creds = require('../credentials');
    const user = await db.getUserById(req.session.userId);
    const student = await db.getStudentByUserId(req.session.userId);
    const hasCookies = Boolean(creds.loadSessionCookies(req.session.userId));

    // Check expiry state
    const expRow = await db.query(
      'SELECT is_expired FROM session_expiry_state WHERE user_id = $1 ORDER BY detected_at DESC LIMIT 1',
      [req.session.userId]
    ).catch(() => ({ rows: [] }));

    const isExpired = expRow.rows.length > 0 && expRow.rows[0].is_expired;

    let sessionState = 'disconnected';
    if (isExpired) {
      sessionState = 'expired';
    } else if (hasCookies || (user && user.qums_session_status === 'connected')) {
      sessionState = 'connected';
    }

    res.json({
      ok: true,
      success: true,
      sessionState,
      studentQid: user?.qums_qid || '',
      status: sessionState === 'connected' ? 'active' : sessionState,
      hasVaultedPassword: Boolean(user && user.qums_password_encrypted),
      lastSynced: user?.updated_at || new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

module.exports = router;
