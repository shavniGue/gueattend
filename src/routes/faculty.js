/**
 * Faculty Portal API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireFaculty } = require('../middleware/auth');

/**
 * GET /api/faculty/assigned-classes
 */
router.get('/assigned-classes', requireFaculty, async (req, res) => {
  try {
    const faculty = await db.getFacultyByUserId(req.session.userId);
    if (!faculty) return res.status(404).json({ success: false, error: 'Faculty profile not found.' });

    const sql = `
      SELECT 
        fs.*,
        sub.name AS subject_name,
        sub.code AS subject_code,
        sec.name AS section_name,
        sem.semester_number,
        c.name AS course_name
      FROM faculty_subjects fs
      JOIN subjects sub ON fs.subject_id = sub.id
      JOIN sections sec ON fs.section_id = sec.id
      JOIN semesters sem ON sec.semester_id = sem.id
      JOIN courses c ON sem.course_id = c.id
      WHERE fs.faculty_id = $1
    `;
    const result = await db.query(sql, [faculty.id]);

    res.json({
      success: true,
      faculty,
      classes: result.rows,
    });
  } catch (err) {
    console.error('[faculty/classes] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch assigned classes.' });
  }
});

/**
 * GET /api/faculty/students?sectionId=...
 */
router.get('/students', requireFaculty, async (req, res) => {
  const { sectionId } = req.query;
  if (!sectionId) return res.status(400).json({ success: false, error: 'sectionId is required.' });

  try {
    const sql = `
      SELECT s.*, u.full_name, u.email, u.phone
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.section_id = $1
      ORDER BY s.roll_number ASC, u.full_name ASC
    `;
    const result = await db.query(sql, [sectionId]);

    res.json({
      success: true,
      students: result.rows,
    });
  } catch (err) {
    console.error('[faculty/students] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch students list.' });
  }
});

/**
 * POST /api/faculty/attendance/mark
 * Marks attendance for an entire section period
 */
router.post('/attendance/mark', requireFaculty, async (req, res) => {
  const { sectionId, subjectId, classDate, periodNumber, topicTaught, studentStatuses } = req.body;
  // studentStatuses: [ { studentId, status: 'present' | 'absent' | 'approved_leave', remarks } ]

  if (!sectionId || !subjectId || !classDate || !periodNumber || !Array.isArray(studentStatuses)) {
    return res.status(400).json({ success: false, error: 'Missing required session parameters or student roster.' });
  }

  try {
    const faculty = await db.getFacultyByUserId(req.session.userId);
    const sessionId = `att_sess_${Date.now()}`;

    await db.withTransaction(async (client) => {
      // Resolve active academic session from section's semester or current academic_session
      const sessLookup = await client.query(
        `SELECT COALESCE(
           (SELECT sem.academic_session_id FROM sections sec JOIN semesters sem ON sec.semester_id = sem.id WHERE sec.id = $1 LIMIT 1),
           (SELECT id FROM academic_sessions WHERE is_current = TRUE LIMIT 1),
           'sess_2026_2027'
         ) AS academic_session_id`,
        [sectionId]
      );
      const academicSessionId = sessLookup.rows[0]?.academic_session_id || 'sess_2026_2027';

      // 1. Create or update session
      await client.query(
        `INSERT INTO attendance_sessions (id, academic_session_id, section_id, subject_id, faculty_id, class_date, period_number, topic_taught, marked_at)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, NOW())
         ON CONFLICT (academic_session_id, section_id, class_date, period_number)
         DO UPDATE SET 
           subject_id = EXCLUDED.subject_id,
           faculty_id = EXCLUDED.faculty_id,
           topic_taught = EXCLUDED.topic_taught,
           updated_at = NOW()`,
        [sessionId, academicSessionId, sectionId, subjectId, faculty ? faculty.id : 'fac_1', classDate, periodNumber, topicTaught || '']
      );

      // 2. Fetch subject code & name
      const subRes = await client.query('SELECT code, name FROM subjects WHERE id = $1', [subjectId]);
      const subCode = subRes.rows[0]?.code || '';
      const subName = subRes.rows[0]?.name || '';

      // 3. Insert or update student records
      for (const st of studentStatuses) {
        // Fetch student user_id and student_id
        const sRes = await client.query('SELECT user_id, student_id FROM students WHERE id = $1', [st.studentId]);
        if (sRes.rows.length === 0) continue;
        const sRow = sRes.rows[0];

        await client.query(
          `INSERT INTO attendance_records (user_id, qid, subject_code, subject_name, class_date, session_id, student_id, status, remarks, period_number, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           ON CONFLICT (user_id, qid, subject_code, class_date)
           DO UPDATE SET 
             status = EXCLUDED.status,
             remarks = EXCLUDED.remarks,
             period_number = EXCLUDED.period_number,
             session_id = EXCLUDED.session_id,
             updated_at = NOW()`,
          [
            sRow.user_id,
            sRow.student_id,
            subCode,
            subName,
            classDate,
            sessionId,
            st.studentId,
            st.status,
            st.remarks || '',
            periodNumber,
          ]
        );
      }

      await db.recordAuditLog({
        userId: req.session.userId,
        action: 'MARK_ATTENDANCE',
        resource: `attendance_sessions:${sessionId}`,
        details: { sectionId, subjectId, classDate, periodNumber, studentsCount: studentStatuses.length },
      });
    });

    res.json({ success: true, message: 'Attendance marked successfully.' });
  } catch (err) {
    console.error('[faculty/mark-attendance] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to record attendance session.' });
  }
});

/**
 * GET /api/faculty/corrections
 * Pending correction requests for faculty review
 */
router.get('/corrections', requireFaculty, async (req, res) => {
  try {
    const sql = `
      SELECT 
        ac.*,
        u_stu.full_name AS student_name,
        s.student_id,
        ar.class_date,
        ar.subject_code,
        ar.subject_name
      FROM attendance_corrections ac
      JOIN attendance_records ar ON ac.attendance_record_id = ar.id
      JOIN users u_stu ON ac.requested_by_user_id = u_stu.id
      LEFT JOIN students s ON s.user_id = u_stu.id
      WHERE ac.status = 'pending'
      ORDER BY ac.created_at ASC
    `;
    const result = await db.query(sql);

    res.json({ success: true, corrections: result.rows });
  } catch (err) {
    console.error('[faculty/corrections] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch corrections.' });
  }
});

/**
 * POST /api/faculty/corrections/:id/action
 * Approve or reject attendance correction
 */
router.post('/corrections/:id/action', requireFaculty, async (req, res) => {
  const { action, reviewerNotes } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action (must be approve or reject).' });
  }

  try {
    const corrRes = await db.query('SELECT * FROM attendance_corrections WHERE id = $1', [req.params.id]);
    if (corrRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Correction request not found.' });
    const corr = corrRes.rows[0];

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE attendance_corrections 
         SET status = $1, reviewed_by_user_id = $2, reviewed_at = NOW() 
         WHERE id = $3`,
        [newStatus, req.session.userId, req.params.id]
      );

      if (action === 'approve') {
        // Update the actual attendance record
        await client.query(
          `UPDATE attendance_records 
           SET status = $1, remarks = CONCAT(remarks, ' [Corrected by faculty]'), updated_at = NOW() 
           WHERE id = $2`,
          [corr.new_status, corr.attendance_record_id]
        );
      }
    });

    res.json({ success: true, message: `Correction request ${newStatus}.` });
  } catch (err) {
    console.error('[faculty/corrections/action] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to process correction action.' });
  }
});

/**
 * GET /api/faculty/substitutions
 */
router.get('/substitutions', requireFaculty, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cs.*, tt.day_of_week, tp.label AS period_label, tp.start_time, tp.end_time,
              sub.code AS subject_code, sub.name AS subject_name, sec.name AS section_name,
              u_orig.full_name AS original_faculty_name, u_sub.full_name AS substitute_faculty_name
       FROM class_substitutions cs
       JOIN timetable tt ON cs.timetable_id = tt.id
       JOIN timetable_periods tp ON tt.period_number = tp.period_number
       JOIN subjects sub ON tt.subject_id = sub.id
       JOIN sections sec ON tt.section_id = sec.id
       JOIN faculty f1 ON cs.original_faculty_id = f1.id
       JOIN users u_orig ON f1.user_id = u_orig.id
       JOIN faculty f2 ON cs.substitute_faculty_id = f2.id
       JOIN users u_sub ON f2.user_id = u_sub.id
       ORDER BY cs.substitution_date DESC
       LIMIT 50`
    );
    const facRes = await db.query(
      `SELECT f.id, u.full_name, f.employee_id FROM faculty f JOIN users u ON f.user_id = u.id ORDER BY u.full_name ASC`
    );
    const ttRes = await db.query(
      `SELECT tt.id, tt.day_of_week, tt.period_number, sub.code AS subject_code, sub.name AS subject_name, sec.name AS section_name
       FROM timetable tt
       JOIN subjects sub ON tt.subject_id = sub.id
       JOIN sections sec ON tt.section_id = sec.id
       ORDER BY tt.day_of_week ASC, tt.period_number ASC`
    );
    res.json({ success: true, substitutions: result.rows, facultyList: facRes.rows, timetableSlots: ttRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch faculty substitutions.' });
  }
});

/**
 * POST /api/faculty/substitutions
 */
router.post('/substitutions', requireFaculty, async (req, res) => {
  const { timetableId, substitutionDate, substituteFacultyId, reason } = req.body || {};
  if (!timetableId || !substitutionDate || !substituteFacultyId) {
    return res.status(400).json({ success: false, error: 'timetableId, substitutionDate, and substituteFacultyId are required.' });
  }

  try {
    const ttRes = await db.query('SELECT id, faculty_id FROM timetable WHERE id = $1', [timetableId]);
    if (ttRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Timetable slot not found.' });

    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const upsert = await db.query(
      `INSERT INTO class_substitutions (id, timetable_id, substitution_date, original_faculty_id, substitute_faculty_id, reason, status, created_at)
       VALUES ($1, $2, $3::date, $4, $5, $6, 'scheduled', NOW())
       ON CONFLICT (timetable_id, substitution_date)
       DO UPDATE SET
         substitute_faculty_id = EXCLUDED.substitute_faculty_id,
         reason = EXCLUDED.reason,
         status = 'scheduled'
       RETURNING *`,
      [id, timetableId, substitutionDate, ttRes.rows[0].faculty_id, substituteFacultyId, String(reason || '').trim()]
    );

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'SCHEDULE_CLASS_SUBSTITUTION',
      resource: `class_substitutions:${upsert.rows[0].id}`,
      details: { timetableId, substitutionDate, substituteFacultyId },
    });

    res.json({ success: true, substitution: upsert.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to schedule substitution.' });
  }
});

module.exports = router;

