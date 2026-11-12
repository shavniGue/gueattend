/**
 * Administrator Portal & University Operations API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const crypto = require('crypto');
const XLSX = require('xlsx');
const router = express.Router();

const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { checkFirebaseHealth } = require('../config/firebase');
const { FIREBASE_PASSWORD_SENTINEL } = require('../firebaseAuth');

const CONNECTED_SESSION_SQL = "IN ('active', 'connected')";

/**
 * Shared parameterized WHERE builder for admin user directory & Excel export.
 */
function buildAdminUsersWhere(query) {
  const clauses = ['1=1'];
  const params = [];
  let pIdx = 1;

  const role = query.role ? String(query.role).trim() : null;
  const search = query.search ? `%${String(query.search).trim().toLowerCase()}%` : null;
  const qumsStatus = query.qumsStatus ? String(query.qumsStatus).trim().toLowerCase() : null;
  const telegram = query.telegram ? String(query.telegram).trim().toLowerCase() : null;
  const reconnect = query.reconnect ? String(query.reconnect).trim().toLowerCase() : null;
  const accountStatus = query.accountStatus ? String(query.accountStatus).trim().toLowerCase() : null;

  if (role) {
    clauses.push(`u.role = $${pIdx++}`);
    params.push(role);
  }
  if (search) {
    clauses.push(
      `(LOWER(u.email) LIKE $${pIdx} OR LOWER(COALESCE(u.full_name, '')) LIKE $${pIdx} OR LOWER(COALESCE(u.student_name, '')) LIKE $${pIdx} OR LOWER(COALESCE(u.qums_qid, '')) LIKE $${pIdx} OR LOWER(COALESCE(s.student_id, '')) LIKE $${pIdx} OR LOWER(COALESCE(u.new_erp_qid, '')) LIKE $${pIdx})`
    );
    params.push(search);
    pIdx++;
  }
  if (qumsStatus === 'connected') {
    clauses.push(`(u.qums_session_status ${CONNECTED_SESSION_SQL} OR u.new_erp_session_status ${CONNECTED_SESSION_SQL})`);
  } else if (qumsStatus === 'expired') {
    clauses.push(`(u.qums_session_status = 'expired' OR u.new_erp_session_status = 'expired')`);
  } else if (qumsStatus === 'disconnected') {
    clauses.push(
      `(COALESCE(u.qums_session_status, 'disconnected') NOT IN ('active', 'connected', 'expired') AND COALESCE(u.new_erp_session_status, 'not_setup') NOT IN ('active', 'connected', 'expired'))`
    );
  }

  if (telegram === 'linked') {
    clauses.push(`(COALESCE(u.telegram_chat_id, '') <> '' OR COALESCE(ta.telegram_chat_id, '') <> '')`);
  } else if (telegram === 'unlinked') {
    clauses.push(`(COALESCE(u.telegram_chat_id, '') = '' AND COALESCE(ta.telegram_chat_id, '') = '')`);
  }

  if (reconnect === 'telegram') {
    clauses.push(`LOWER(COALESCE(u.last_reconnect_source, '')) = 'telegram'`);
  } else if (reconnect === 'web') {
    clauses.push(`LOWER(COALESCE(u.last_reconnect_source, '')) IN ('web', 'webpage')`);
  } else if (reconnect === 'none') {
    clauses.push(`COALESCE(u.last_reconnect_source, '') = ''`);
  }

  if (accountStatus === 'active') {
    clauses.push(`u.is_suspended = FALSE`);
  } else if (accountStatus === 'suspended') {
    clauses.push(`u.is_suspended = TRUE`);
  }

  return { whereSql: clauses.join(' AND '), params, nextParamIndex: pIdx };
}

/**
 * GET /api/admin/overview
 * Live KPI counts + background watcher / service health metrics
 */
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const startMs = Date.now();
    const [kpiRes, notifRes, watcherRes] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (
            WHERE qums_session_status ${CONNECTED_SESSION_SQL}
               OR new_erp_session_status ${CONNECTED_SESSION_SQL}
          )::int AS qums_connected,
          COUNT(*) FILTER (
            WHERE qums_session_status = 'expired'
               OR new_erp_session_status = 'expired'
          )::int AS session_expired,
          COUNT(*) FILTER (WHERE COALESCE(telegram_chat_id, '') <> '')::int AS telegram_linked,
          COALESCE(SUM(reconnect_count_telegram), 0)::int AS reconnected_telegram,
          COALESCE(SUM(reconnect_count_web), 0)::int AS reconnected_web,
          COUNT(*) FILTER (WHERE is_suspended = TRUE)::int AS suspended_users
        FROM users
      `),
      db.query('SELECT COUNT(*)::int AS cnt FROM notification_log'),
      db.query(`
        SELECT
          MAX(attendance_last_checked_at) AS last_attendance_check,
          MAX(assignment_last_checked_at) AS last_assignment_check
        FROM users
      `),
    ]);
    const latencyMs = Date.now() - startMs;

    const row = kpiRes.rows[0] || {};
    const watchers = watcherRes.rows[0] || {};
    const fbHealth = checkFirebaseHealth();
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const botConfigured = Boolean(botToken && botToken !== 'your_telegram_bot_token_from_botfather');
    const pollingOn = String(process.env.TELEGRAM_POLLING || '').toLowerCase() === 'on';

    res.json({
      success: true,
      kpis: {
        totalUsers: row.total_users || 0,
        qumsConnected: row.qums_connected || 0,
        sessionExpired: row.session_expired || 0,
        telegramLinked: row.telegram_linked || 0,
        reconnectedTelegram: row.reconnected_telegram || 0,
        reconnectedWeb: row.reconnected_web || 0,
        suspendedUsers: row.suspended_users || 0,
        notificationsSent: notifRes.rows[0]?.cnt || 0,
      },
      services: {
        database: {
          status: 'ONLINE',
          mode: 'postgres',
          latencyMs,
        },
        telegramBot: {
          status: pollingOn ? 'POLLING' : botConfigured ? 'READY' : 'OFF',
          configured: botConfigured,
          polling: pollingOn,
          username: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
        },
        attendanceWatcher: {
          status: 'ACTIVE',
          lastCheckedAt: watchers.last_attendance_check || null,
        },
        assignmentWatcher: {
          status: 'ACTIVE',
          lastCheckedAt: watchers.last_assignment_check || null,
        },
        morningScheduler: {
          status: 'SCHEDULED',
          scheduleLabel: '08:30 IST morning classes (Asia/Kolkata)',
        },
        firebaseAdmin: {
          status: fbHealth.hasServiceAccount ? 'READY' : fbHealth.initialized ? 'PROJECT SCOPE' : 'KEY NEEDED',
          projectId: fbHealth.projectId || 'gueattend',
          hasApiKey: Boolean(fbHealth.hasApiKey),
          hasServiceAccount: Boolean(fbHealth.hasServiceAccount),
        },
      },
    });
  } catch (err) {
    console.error('[admin/overview] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load admin overview.' });
  }
});

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
 * Paginated and filterable user accounts directory
 */
router.get('/users', requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || 1, 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || 25, 10)));
  const offset = (page - 1) * limit;

  try {
    const { whereSql, params, nextParamIndex } = buildAdminUsersWhere(req.query);
    const fromJoinSql = `
      FROM users u
      LEFT JOIN students s ON s.user_id = u.id
      LEFT JOIN faculty f ON f.user_id = u.id
      LEFT JOIN telegram_accounts ta ON ta.user_id = u.id
      WHERE ${whereSql}
    `;

    const listSql = `
      SELECT u.id, u.email, u.full_name, u.student_name, u.role, u.is_admin, u.is_active,
             u.is_suspended, u.email_verified, u.created_at,
             u.qums_qid, u.qums_session_status, u.active_erp_type,
             u.new_erp_qid, u.new_erp_student_name, u.new_erp_session_status,
             u.telegram_chat_id, ta.telegram_username,
             u.last_reconnect_source, u.last_reconnected_at,
             u.reconnect_count_telegram, u.reconnect_count_web,
             u.attendance_last_checked_at, u.assignment_last_checked_at,
             s.student_id, s.enrollment_number, f.employee_id
      ${fromJoinSql}
      ORDER BY u.created_at DESC
      LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}
    `;

    const [result, filteredCountRes, totalCountRes] = await Promise.all([
      db.query(listSql, [...params, limit, offset]),
      db.query(`SELECT COUNT(*)::int AS cnt ${fromJoinSql}`, params),
      db.query('SELECT COUNT(*)::int AS cnt FROM users'),
    ]);

    res.json({
      success: true,
      total: totalCountRes.rows[0].cnt,
      filteredTotal: filteredCountRes.rows[0].cnt,
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
 * GET /api/admin/users/export.xlsx
 * Downloads filtered user accounts list as an Excel workbook
 */
router.get('/users/export.xlsx', requireAdmin, async (req, res) => {
  try {
    const { whereSql, params } = buildAdminUsersWhere(req.query);
    const sql = `
      SELECT u.email, u.full_name, u.student_name, u.role, u.is_suspended,
             u.qums_qid, u.new_erp_qid, u.active_erp_type,
             u.qums_session_status, u.new_erp_session_status,
             u.telegram_chat_id, u.last_reconnect_source, u.last_reconnected_at,
             u.reconnect_count_telegram, u.reconnect_count_web,
             u.attendance_last_checked_at, u.assignment_last_checked_at, u.created_at,
             s.student_id
      FROM users u
      LEFT JOIN students s ON s.user_id = u.id
      LEFT JOIN telegram_accounts ta ON ta.user_id = u.id
      WHERE ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT 1000
    `;
    const result = await db.query(sql, params);
    const exportRows = result.rows.map((u) => ({
      'Student Name': u.student_name || u.new_erp_student_name || u.full_name || 'User',
      Email: u.email,
      Role: u.role,
      Status: u.is_suspended ? 'SUSPENDED' : 'ACTIVE',
      GUeID: u.qums_qid || u.new_erp_qid || u.student_id || '-',
      'ERP Mode': u.active_erp_type === 'NEW' ? 'GEU NEW ERP' : 'GEU PORTAL',
      'GEU ERP Session': u.qums_session_status || 'disconnected',
      Telegram: u.telegram_chat_id ? 'LINKED' : 'UNLINKED',
      'Last Reconnect': u.last_reconnect_source || '-',
      'Telegram Reconnects': u.reconnect_count_telegram || 0,
      'Web Reconnects': u.reconnect_count_web || 0,
      'Attendance Last Checked': u.attendance_last_checked_at || '-',
      'Assignment Last Checked': u.assignment_last_checked_at || '-',
      Created: u.created_at || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="gueattend-users.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('[admin/export] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to export users workbook.' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Explicit administrator user deletion (blocks self-deletion & writes audit log)
 */
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.session.userId) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own active administrator account.' });
  }

  try {
    const existing = await db.getUserById(targetId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    await db.withTransaction(async (client) => {
      await client.query('DELETE FROM telegram_accounts WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM students WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM faculty WHERE user_id = $1', [targetId]);
      await client.query('DELETE FROM users WHERE id = $1', [targetId]);
    });

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'DELETE_USER',
      resource: `users:${targetId}`,
      details: { deletedEmail: existing.email, deletedRole: existing.role },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'User account removed.' });
  } catch (err) {
    console.error('[admin/delete] Error:', err.message);
    res.status(500).json({ success: false, error: `Could not delete user: ${err.message}` });
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
          const userId = `usr_${crypto.randomUUID()}`;

          await client.query(
            `INSERT INTO users (id, email, password_hash, role, is_admin, full_name, is_active, email_verified)
             VALUES ($1, LOWER($2), $3, 'student', FALSE, $4, TRUE, TRUE)
             ON CONFLICT (email) DO NOTHING`,
            [userId, email, FIREBASE_PASSWORD_SENTINEL, fullName]
          );

          const hierarchy = await client.query(`
            SELECT sec.id AS section_id, sem.id AS semester_id, c.id AS course_id, d.id AS department_id, sess.id AS academic_session_id
            FROM sections sec
            JOIN semesters sem ON sec.semester_id = sem.id
            JOIN courses c ON sem.course_id = c.id
            JOIN departments d ON c.department_id = d.id
            JOIN academic_sessions sess ON sem.academic_session_id = sess.id
            ORDER BY sess.is_current DESC, sec.id ASC
            LIMIT 1
          `);
          if (hierarchy.rows.length > 0) {
            const h = hierarchy.rows[0];
            await client.query(
              `INSERT INTO students (id, user_id, student_id, enrollment_number, roll_number, department_id, course_id, semester_id, section_id, academic_session_id)
               VALUES ($1, (SELECT id FROM users WHERE email = LOWER($2)), $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (student_id) DO NOTHING`,
              [`stu_${crypto.randomUUID()}`, email, studentId, enrollment, studentId, h.department_id, h.course_id, h.semester_id, h.section_id, h.academic_session_id]
            );
          }
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
 * POST /api/admin/users/:id/role
 * Fine-grained RBAC role update with self-demotion protection & audit log
 */
router.post('/users/:id/role', requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  const nextRole = String(req.body?.role || '').trim().toLowerCase();
  if (!['student', 'faculty', 'admin'].includes(nextRole)) {
    return res.status(400).json({ success: false, error: 'Role must be student, faculty, or admin.' });
  }
  if (targetId === req.session.userId && nextRole !== 'admin') {
    return res.status(400).json({ success: false, error: 'Cannot demote your own active administrator account.' });
  }

  try {
    const existing = await db.getUserById(targetId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const isAdminFlag = nextRole === 'admin';
    const upd = await db.query(
      `UPDATE users SET role = $1, is_admin = $2, updated_at = NOW() WHERE id = $3 RETURNING id, email, role, is_admin`,
      [nextRole, isAdminFlag, targetId]
    );

    if (nextRole === 'faculty') {
      const dept = (await db.query('SELECT id FROM departments LIMIT 1')).rows[0];
      if (dept) {
        await db.query(
          `INSERT INTO faculty (id, user_id, employee_id, department_id, designation)
           VALUES ($1, $2, $3, $4, 'Faculty Member')
           ON CONFLICT (user_id) DO NOTHING`,
          [`fac_${crypto.randomUUID()}`, targetId, `EMP-${Date.now().toString().slice(-6)}`, dept.id]
        ).catch(() => {});
      }
    }

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'UPDATE_USER_ROLE',
      resource: `users:${targetId}`,
      details: { previousRole: existing.role, nextRole, isAdmin: isAdminFlag },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true, user: upd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update user role.' });
  }
});

/**
 * GET /api/admin/academics/metadata
 */
router.get('/academics/metadata', requireAdmin, async (req, res) => {
  try {
    const [depts, courses, sems, secs, subjects, faculty] = await Promise.all([
      db.query('SELECT * FROM departments ORDER BY name ASC'),
      db.query('SELECT * FROM courses ORDER BY name ASC'),
      db.query('SELECT * FROM semesters ORDER BY semester_number ASC'),
      db.query('SELECT * FROM sections ORDER BY name ASC'),
      db.query('SELECT * FROM subjects ORDER BY code ASC'),
      db.query('SELECT f.id, f.employee_id, u.full_name, u.email FROM faculty f JOIN users u ON f.user_id = u.id ORDER BY u.full_name ASC'),
    ]);
    res.json({
      success: true,
      departments: depts.rows,
      courses: courses.rows,
      semesters: sems.rows,
      sections: secs.rows,
      subjects: subjects.rows,
      faculty: faculty.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load academic metadata.' });
  }
});

/**
 * GET /api/admin/circulars & DELETE /api/admin/circulars/:id
 */
router.get('/circulars', requireAdmin, async (req, res) => {
  try {
    const resCirc = await db.query(
      `SELECT c.*, u.full_name AS published_by_name
       FROM circulars c
       LEFT JOIN users u ON c.published_by_user_id = u.id
       ORDER BY c.is_pinned DESC, c.published_at DESC
       LIMIT 50`
    );
    res.json({ success: true, circulars: resCirc.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch circulars.' });
  }
});

router.delete('/circulars/:id', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM circulars WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Circular removed.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete circular.' });
  }
});

/**
 * GET /api/admin/grievances & POST /api/admin/grievances/:id/status
 */
router.get('/grievances', requireAdmin, async (req, res) => {
  try {
    const resGrv = await db.query(
      `SELECT g.*, s.student_id AS gueid, u.full_name AS student_name, u.email AS student_email
       FROM grievances g
       JOIN students s ON g.student_id = s.id
       JOIN users u ON s.user_id = u.id
       ORDER BY CASE WHEN g.status = 'submitted' THEN 0 ELSE 1 END, g.created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, grievances: resGrv.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch grievances.' });
  }
});

router.post('/grievances/:id/status', requireAdmin, async (req, res) => {
  const status = String(req.body?.status || '').trim().toLowerCase();
  const notes = String(req.body?.resolutionNotes || '').trim();
  if (!['submitted', 'under_review', 'resolved', 'closed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid grievance status.' });
  }

  try {
    const upd = await db.query(
      `UPDATE grievances
       SET status = $1,
           resolution_notes = CASE WHEN $2 <> '' THEN $2 ELSE resolution_notes END,
           assigned_to_user_id = COALESCE(assigned_to_user_id, $3),
           resolved_at = CASE WHEN $1 IN ('resolved', 'closed') THEN NOW() ELSE resolved_at END
       WHERE id = $4
       RETURNING *`,
      [status, notes, req.session.userId, req.params.id]
    );
    if (upd.rows.length === 0) return res.status(404).json({ success: false, error: 'Grievance not found.' });

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'GRIEVANCE_STATUS_UPDATED',
      resource: `grievances:${req.params.id}`,
      details: { status },
    });

    res.json({ success: true, grievance: upd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update grievance.' });
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

/**
 * GET /api/admin/contact-messages
 */
router.get('/contact-messages', requireAdmin, async (req, res) => {
  try {
    const resMsg = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, messages: resMsg.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch contact messages.' });
  }
});

module.exports = router;

