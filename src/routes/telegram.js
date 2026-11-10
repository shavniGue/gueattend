/**
 * Telegram Account Integration API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'gue_attendance_bot';

/**
 * GET /api/telegram/status
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const account = await db.getTelegramAccountByUserId(req.session.userId);
    res.json({
      success: true,
      botUsername: BOT_USERNAME,
      botUrl: `https://t.me/${BOT_USERNAME}`,
      isLinked: Boolean(account),
      account: account
        ? {
            chatId: account.telegram_chat_id,
            username: account.telegram_username,
            firstName: account.first_name,
            linkedAt: account.linked_at,
          }
        : null,
    });
  } catch (err) {
    console.error('[telegram/status] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch Telegram integration status.' });
  }
});

/**
 * POST /api/telegram/link-token
 * Generates a 1-click link token valid for 15 minutes
 */
router.post('/link-token', requireAuth, async (req, res) => {
  try {
    const token = await db.createTelegramLinkToken(req.session.userId);
    const deepLink = `https://t.me/${BOT_USERNAME}?start=${token}`;

    res.json({
      success: true,
      token,
      deepLink,
      botUsername: BOT_USERNAME,
      expiresInMinutes: 15,
      instruction: `Send /login ${token} to @${BOT_USERNAME} or tap the deep link button below.`,
    });
  } catch (err) {
    console.error('[telegram/link-token] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate linking token.' });
  }
});

/**
 * POST /api/telegram/unlink
 */
router.post('/unlink', requireAuth, async (req, res) => {
  try {
    await db.unlinkTelegram(req.session.userId);
    res.json({ success: true, message: 'Telegram account unlinked successfully.' });
  } catch (err) {
    console.error('[telegram/unlink] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to unlink Telegram account.' });
  }
});

module.exports = router;

