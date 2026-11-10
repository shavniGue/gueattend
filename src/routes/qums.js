/**
 * Module 2: QUMS & Headless Browser Relay Routes
 * gueattend - Visual CAPTCHA Stream & 1-Click Reconnect Endpoints
 */

const express = require('express');
const router = express.Router();
const qumsWeb = require('../qums-login-web');
const { requireAuth } = require('../middleware/auth');
const db = require('../database/db');

/**
 * GET /api/qums/captcha
 * Stream visual CAPTCHA element as base64 to frontend
 */
router.get('/captcha', requireAuth, async (req, res) => {
  try {
    const challenge = await qumsWeb.getVisualCaptcha(req.session.userId);
    res.json({ success: true, captcha: challenge.captchaImage, ...challenge });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/qums/login
 * Submit QID, password and human-solved CAPTCHA
 */
router.post('/login', requireAuth, async (req, res) => {
  const { qid, password, challengeId } = req.body;
  const captchaAnswer = req.body.captchaAnswer || req.body.captcha;
  if (!qid || !password || !captchaAnswer) {
    return res.status(400).json({ success: false, error: 'QID, password, and CAPTCHA answer are required.' });
  }

  try {
    const result = await qumsWeb.submitQumsLogin({
      userId: req.session.userId,
      qid,
      password,
      challengeId,
      captchaAnswer,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/qums/reconnect
 * 1-Click Reconnect: Uses vaulted encrypted password with fresh CAPTCHA
 */
router.post('/reconnect', requireAuth, async (req, res) => {
  const { challengeId, source } = req.body;
  const captchaAnswer = req.body.captchaAnswer || req.body.captcha;
  if (!captchaAnswer) {
    return res.status(400).json({ success: false, error: 'Please enter the CAPTCHA.' });
  }

  try {
    const result = await qumsWeb.reconnectQumsSession({
      userId: req.session.userId,
      challengeId,
      captchaAnswer,
      source: source || 'web',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/qums/disconnect
 */
router.post('/disconnect', requireAuth, async (req, res) => {
  try {
    const creds = require('../credentials');
    creds.clearSessionCookies(req.session.userId);
    res.json({ success: true, message: 'QUMS session disconnected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    } else if (hasCookies || user) {
      sessionState = 'connected';
    }

    res.json({
      success: true,
      sessionState,
      studentQid: student?.student_id || user?.qums_qid || '24030110',
      status: sessionState === 'connected' ? 'active' : sessionState,
      lastSynced: user?.updated_at || new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
