/**
 * In-App Notifications API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/notifications
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const list = await db.getUserNotifications(req.session.userId, 40);
    const unreadCount = list.filter((n) => !n.is_read).length;

    res.json({
      success: true,
      unreadCount,
      notifications: list,
    });
  } catch (err) {
    console.error('[notifications/get] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications.' });
  }
});

/**
 * POST /api/notifications/:id/read
 */
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await db.markNotificationAsRead(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    console.error('[notifications/read] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update notification.' });
  }
});

module.exports = router;

