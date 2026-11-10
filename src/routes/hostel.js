/**
 * Hostel Management API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/hostel/my-room
 */
router.get('/my-room', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const allocation = await db.getHostelDetails(student.id);

    res.json({
      success: true,
      allocated: Boolean(allocation),
      allocation,
    });
  } catch (err) {
    console.error('[hostel] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch hostel details.' });
  }
});

module.exports = router;

