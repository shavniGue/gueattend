/**
 * Administrator Portal & University Operations API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const router = express.Router();

const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

/**
 * GET /api/admin/metrics
 * System-wide ERP statistics
 */
router.get('/metrics', requireAdmin, async (req, res) => {
  try {
    const [uCount, sCount, fCount, attCount, circCount, grvCount] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM students'),
      db.query('SELECT COUNT(*) FROM faculty'),
      db.query('SELECT COUNT(*) FROM attendance_records'),
      db.query('SELECT COUNT(*) FROM circulars'),
      db.query("SELECT COUNT(*) FROM grievances WHERE status = 'submitted'"),
    ]);

    res.json({
      success: true,
      metrics: {
        totalUsers: parseInt(uCount.rows[0].count, 10),
        totalStudents: parseInt(sCount.rows[0].count, 10),
        totalFaculty: parseInt(fCount.rows[0].count, 10),
        totalAttendanceRecords: parseInt(attCount.rows[0].count, 10),
        totalCirculars: parseInt(circCount.rows[0].count, 10),
        pendingGrievances: parseInt(grvCount.rows[0].count, 10),
      },
    });
  } catch (err) {
    console.error('[admin/metrics] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch admin metrics.' });
  }
});

/**
 * GET /api/admin/users
 * Paginated user accounts list
 */
router.get('/users', requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page || 1, 10);
  const limit = parseInt(req.query.limit || 50, 10);
  const offset = (page - 1) * limit;
  const role = req.query.role || null;
  const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;

  try {
    let sql = `
      SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.is_suspended, u.created_at,
             s.student_id, s.enrollment_number, f.employee_id
      FROM users u
      LEFT JOIN students s ON s.user_id = u.id
      LEFT JOIN faculty f ON f.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let pIdx = 1;

    if (role) {
      sql += ` AND u.role = $${pIdx++}`;
      params.push(role);
    }
    if (search) {
      sql += ` AND (LOWER(u.email) LIKE $${pIdx} OR LOWER(u.full_name) LIKE $${pIdx} OR LOWER(COALESCE(s.student_id, '')) LIKE $${pIdx})`;
      params.push(search);
      pIdx++;
    }

    sql += ` ORDER BY u.created_at DESC LIMIT $${pIdx++} OFFSET $${pIdx++}`;
    params.push(limit, offset);

    const result = await db.query(sql, params);
    const countRes = await db.query('SELECT COUNT(*) FROM users');

    res.json({
      success: true,
      total: parseInt(countRes.rows[0].count, 10),
      page,
      limit,
      users: result.rows,
    });
  } catch (err) {
    console.error('[admin/users] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch users list.' });
  }
});

/**
 * POST /api/admin/users/:id/suspend
 */
router.post('/users/:id/suspend', requireAdmin, async (req, res) => {
  const { isSuspended } = req.body;
  try {
    await db.query('UPDATE users SET is_suspended = $1, updated_at = NOW() WHERE id = $2', [Boolean(isSuspended), req.params.id]);
    await db.recordAuditLog({
      userId: req.session.userId,
      action: isSuspended ? 'SUSPEND_USER' : 'UNSUSPEND_USER',
      resource: `users:${req.params.id}`,
    });
    res.json({ success: true, message: `User status updated.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/circulars/create
 */
router.post('/circulars/create', requireAdmin, async (req, res) => {
  const { title, circularNumber, category, targetAudience, content, isPinned } = req.body;
  if (!title || !circularNumber || !category || !content) {
    return res.status(400).json({ success: false, error: 'Missing circular fields.' });
  }

  try {
    const id = `circ_${Date.now()}`;
    await db.query(
      `INSERT INTO circulars (id, title, circular_number, category, target_audience, content, published_by_user_id, is_pinned, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [id, title, circularNumber, category, targetAudience || 'all', content, req.session.userId, Boolean(isPinned)]
    );

    res.json({ success: true, message: 'Circular published campus-wide.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/import/excel
 * Imports authorized student/timetable/attendance records from Excel/CSV
 */
router.post('/import/excel', requireAdmin, express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, error: 'No Excel file data received.' });
    }

    const workbook = XLSX.read(req.body, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Excel sheet is empty.' });
    }

    let processed = 0;
    let inserted = 0;

    // Process rows
    await db.withTransaction(async (client) => {
      for (const row of rows) {
        processed++;
        const email = row.Email || row.email;
        const fullName = row.FullName || row.name || row.Name || 'Student';
        const studentId = String(row.StudentID || row.student_id || row.RollNo || '').trim();
        const enrollment = String(row.EnrollmentNo || row.enrollment || `GEU/${Date.now()}/${processed}`);

        if (email && studentId) {
          const userId = `usr_${Date.now()}_${processed}`;
          const hash = await bcrypt.hash('Password@123', 10);

          await client.query(
            `INSERT INTO users (id, email, password_hash, role, full_name, is_active, email_verified)
             VALUES ($1, LOWER($2), $3, 'student', $4, TRUE, TRUE)
             ON CONFLICT (email) DO NOTHING`,
            [userId, email, hash, fullName]
          );

          await client.query(
            `INSERT INTO students (id, user_id, student_id, enrollment_number, roll_number, department_id, course_id, semester_id, section_id, academic_session_id)
             VALUES ($1, (SELECT id FROM users WHERE email = LOWER($2)), $3, $4, $5, 'dept_cse', 'course_btech_cse', 'sem_btech_cse_5', 'sec_btech_cse_5_g4', 'sess_2026_2027')
             ON CONFLICT (student_id) DO NOTHING`,
            [`stu_${Date.now()}_${processed}`, email, studentId, enrollment, studentId]
          );
          inserted++;
        }
      }

      await db.recordSyncLog({
        source: 'EXCEL_BATCH_IMPORT',
        entityType: 'students',
        processed,
        inserted,
        userId: req.session.userId,
      });
    });

    res.json({
      success: true,
      message: `Processed ${processed} records, successfully inserted ${inserted} students.`,
      processed,
      inserted,
    });
  } catch (err) {
    console.error('[admin/import] Error:', err.message);
    res.status(500).json({ success: false, error: `Import failed: ${err.message}` });
  }
});

/**
 * GET /api/admin/audit-logs
 */
router.get('/audit-logs', requireAdmin, async (req, res) => {
  try {
    const sql = `
      SELECT al.*, u.email, u.full_name, u.role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 100
    `;
    const result = await db.query(sql);
    res.json({ success: true, logs: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

