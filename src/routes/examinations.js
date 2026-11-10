/**
 * Examination & Results Management API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/examinations/schedules
 * Examination dates, venues, timings, and admit card status
 */
router.get('/schedules', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const schedules = await db.getExamSchedules(student.semester_id);

    // Check admit card eligibility (requires >= 75% attendance or special clearance)
    const summary = await db.getAttendanceSummary(student.id);
    const isEligible = summary.overallPercentage >= 75.0 || summary.totalMarked === 0;

    res.json({
      success: true,
      admitCardEligible: isEligible,
      attendancePercentage: summary.overallPercentage,
      schedules,
    });
  } catch (err) {
    console.error('[examinations/schedules] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch exam schedules.' });
  }
});

/**
 * GET /api/examinations/marks
 * Internal, external, practical marks and grades
 */
router.get('/marks', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const examId = req.query.examId || null;
    const marks = await db.getStudentMarks(student.id, examId);

    res.json({
      success: true,
      marks,
    });
  } catch (err) {
    console.error('[examinations/marks] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch marks.' });
  }
});

/**
 * GET /api/examinations/results
 * Semester results, SGPA, CGPA, backlogs, and academic performance history
 */
router.get('/results', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const results = await db.getStudentResults(student.id);

    // Compute cumulative stats
    let totalCgpa = 0.0;
    if (results.length > 0) {
      totalCgpa = results[0].cgpa;
    }

    res.json({
      success: true,
      currentCgpa: totalCgpa,
      results,
    });
  } catch (err) {
    console.error('[examinations/results] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch semester results.' });
  }
});

module.exports = router;

