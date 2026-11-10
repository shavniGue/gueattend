/**
 * Campus Placement Drives API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/placement/drives
 */
router.get('/drives', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const drives = await db.getPlacements(student.id);

    res.json({
      success: true,
      drives,
    });
  } catch (err) {
    console.error('[placement/drives] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch placement drives.' });
  }
});

/**
 * POST /api/placement/apply
 */
router.post('/apply', requireAuth, async (req, res) => {
  const { placementId, resumeUrl } = req.body;
  if (!placementId) return res.status(400).json({ success: false, error: 'placementId is required.' });

  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const appId = `pa_${Date.now()}`;
    await db.query(
      `INSERT INTO placement_applications (id, placement_id, student_id, status, resume_url, applied_at, updated_at)
       VALUES ($1, $2, $3, 'applied', $4, NOW(), NOW())
       ON CONFLICT (placement_id, student_id) DO NOTHING`,
      [appId, placementId, student.id, resumeUrl || '']
    );

    res.json({ success: true, message: 'Application submitted to University Training & Placement Cell.' });
  } catch (err) {
    console.error('[placement/apply] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit placement application.' });
  }
});

module.exports = router;

