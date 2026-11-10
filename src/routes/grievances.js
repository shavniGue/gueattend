/**
 * Grievance Redressal API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/grievances
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const grievances = await db.getStudentGrievances(student.id);

    res.json({
      success: true,
      grievances,
    });
  } catch (err) {
    console.error('[grievances/get] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch grievances.' });
  }
});

/**
 * POST /api/grievances
 */
router.post('/', requireAuth, async (req, res) => {
  const { category, subject, description, attachmentUrl } = req.body;
  if (!category || !subject || !description) {
    return res.status(400).json({ success: false, error: 'Category, subject, and description are required.' });
  }

  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const grievance = await db.createGrievance({
      studentId: student.id,
      category,
      subject,
      description,
      attachmentUrl: attachmentUrl || '',
    });

    res.json({
      success: true,
      message: 'Grievance submitted successfully. University redressal committee notified.',
      grievance,
    });
  } catch (err) {
    console.error('[grievances/post] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit grievance.' });
  }
});

module.exports = router;

