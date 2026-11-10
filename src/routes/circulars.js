/**
 * Circulars & Official Announcements API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/circulars
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const role = req.session.role || 'student';
    const audience = role === 'faculty' ? 'faculty' : 'students';
    const circulars = await db.getCirculars(audience, 30);

    res.json({
      success: true,
      circulars,
    });
  } catch (err) {
    console.error('[circulars] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch circulars.' });
  }
});

module.exports = router;

