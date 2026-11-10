/**
 * Attendance Management & Month Register API Routes
 * GUeAttend Unified University ERP
 *
 * Mandatory Formula:
 *   Attendance % = (Present Classes / Total Marked Classes) * 100
 *   Unmarked classes are NEVER counted as absent.
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/attendance/today
 * Today's attendance table:
 * Period, Duration, Subject, Subject Code, Faculty Name, Attendance Status
 */
router.get('/today', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found for current user.' });
    }

    const todayStr = req.query.date || new Date().toISOString().split('T')[0];
    const records = await db.getTodayAttendance(student.id, todayStr);

    res.json({
      success: true,
      date: todayStr,
      attendance: records,
    });
  } catch (err) {
    console.error('[attendance/today] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch today attendance.' });
  }
});

/**
 * GET /api/attendance/summary
 * Overall attendance percentage and subject-wise metrics
 */
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const summary = await db.getAttendanceSummary(student.id);

    res.json({
      success: true,
      summary,
    });
  } catch (err) {
    console.error('[attendance/summary] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to calculate attendance summary.' });
  }
});

/**
 * GET /api/attendance/monthly?month=11&year=2026
 * Month register query with date-wise indicators
 */
router.get('/monthly', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const now = new Date();
    const month = parseInt(req.query.month || (now.getMonth() + 1), 10);
    const year = parseInt(req.query.year || now.getFullYear(), 10);

    if (month < 1 || month > 12) {
      return res.status(400).json({ success: false, error: 'Invalid month (1 - 12 required).' });
    }

    const records = await db.getMonthlyAttendance(student.id, month, year);

    // Group records by date for easy calendar/table mapping in UI
    const registerByDate = {};
    for (const r of records) {
      const d = r.class_date instanceof Date ? r.class_date.toISOString().split('T')[0] : String(r.class_date);
      if (!registerByDate[d]) {
        registerByDate[d] = [];
      }
      registerByDate[d].push(r);
    }

    res.json({
      success: true,
      month,
      year,
      totalEntries: records.length,
      registerByDate,
      rawRecords: records,
    });
  } catch (err) {
    console.error('[attendance/monthly] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch monthly attendance register.' });
  }
});

/**
 * GET /api/attendance/history?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Both startDate and endDate are required.' });
    }

    const records = await db.getAttendanceHistory(student.id, startDate, endDate);

    res.json({
      success: true,
      startDate,
      endDate,
      count: records.length,
      records,
    });
  } catch (err) {
    console.error('[attendance/history] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch attendance history.' });
  }
});

/**
 * GET /api/attendance/subject/:subjectId
 */
router.get('/subject/:subjectId', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const records = await db.getSubjectAttendance(student.id, req.params.subjectId);

    res.json({
      success: true,
      subjectId: req.params.subjectId,
      records,
    });
  } catch (err) {
    console.error('[attendance/subject] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch subject attendance.' });
  }
});

/**
 * POST /api/attendance/correction
 * Submit attendance correction request
 */
router.post('/correction', requireAuth, async (req, res) => {
  const { recordId, newStatus, reason } = req.body;
  if (!recordId || !newStatus || !reason) {
    return res.status(400).json({ success: false, error: 'recordId, newStatus, and reason are required.' });
  }

  try {
    const recRes = await db.query('SELECT * FROM attendance_records WHERE id = $1', [recordId]);
    if (recRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Attendance record not found.' });
    }

    const rec = recRes.rows[0];
    const correctionId = `corr_${Date.now()}`;

    await db.query(
      `INSERT INTO attendance_corrections (id, attendance_record_id, requested_by_user_id, old_status, new_status, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
      [correctionId, recordId, req.session.userId, rec.status, newStatus, reason]
    );

    res.json({ success: true, message: 'Correction request submitted for faculty review.' });
  } catch (err) {
    console.error('[attendance/correction] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit correction request.' });
  }
});

module.exports = router;

