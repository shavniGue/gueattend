/**
 * Attendance Management & Month Register API Routes
 * gueattend - Smart Attendance & Timetable System
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
 * GET /api/attendance/corrections
 * List logged-in student's attendance correction requests
 */
router.get('/corrections', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ac.*, ar.class_date, ar.subject_code, ar.subject_name, ar.period_number
       FROM attendance_corrections ac
       JOIN attendance_records ar ON ac.attendance_record_id = ar.id
       WHERE ac.requested_by_user_id = $1
       ORDER BY ac.created_at DESC
       LIMIT 50`,
      [req.session.userId]
    );
    res.json({ success: true, corrections: result.rows });
  } catch (err) {
    console.error('[attendance/corrections] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch correction requests.' });
  }
});

/**
 * POST /api/attendance/correction
 * Submit attendance correction request (strictly owner-scoped)
 */
router.post('/correction', requireAuth, async (req, res) => {
  const { recordId, newStatus, reason } = req.body || {};
  const allowedStatuses = ['present', 'absent', 'approved_leave'];
  const normalizedStatus = String(newStatus || '').trim().toLowerCase();

  if (!recordId || !normalizedStatus || !String(reason || '').trim()) {
    return res.status(400).json({ success: false, error: 'recordId, newStatus, and reason are required.' });
  }
  if (!allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ success: false, error: 'newStatus must be present, absent, or approved_leave.' });
  }

  try {
    const student = await db.getStudentByUserId(req.session.userId);
    const recRes = await db.query('SELECT * FROM attendance_records WHERE id = $1', [recordId]);
    if (recRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Attendance record not found.' });
    }

    const rec = recRes.rows[0];
    const ownsRecord = rec.user_id === req.session.userId || (student && rec.student_id === student.id);
    if (!ownsRecord && req.session.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'You may only request corrections for your own attendance records.' });
    }

    const correctionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const insRes = await db.query(
      `INSERT INTO attendance_corrections (id, attendance_record_id, requested_by_user_id, old_status, new_status, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
       RETURNING *`,
      [correctionId, recordId, req.session.userId, rec.status, normalizedStatus, String(reason).trim()]
    );

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'ATTENDANCE_CORRECTION_REQUESTED',
      resource: `attendance_records:${recordId}`,
      details: { correctionId, oldStatus: rec.status, newStatus: normalizedStatus },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, correction: insRes.rows[0], message: 'Correction request submitted for faculty review.' });
  } catch (err) {
    console.error('[attendance/correction] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit correction request.' });
  }
});

module.exports = router;

