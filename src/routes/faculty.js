/**
 * Faculty Portal API Routes
 * GUeAttend Unified University ERP
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
      // 1. Create or update session
      await client.query(
        `INSERT INTO attendance_sessions (id, academic_session_id, section_id, subject_id, faculty_id, class_date, period_number, topic_taught, marked_at)
         VALUES ($1, 'sess_2026_2027', $2, $3, $4, $5::date, $6, $7, NOW())
         ON CONFLICT (academic_session_id, section_id, class_date, period_number)
         DO UPDATE SET 
           subject_id = EXCLUDED.subject_id,
           faculty_id = EXCLUDED.faculty_id,
           topic_taught = EXCLUDED.topic_taught,
           updated_at = NOW()`,
        [sessionId, sectionId, subjectId, faculty ? faculty.id : 'fac_1', classDate, periodNumber, topicTaught || '']
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

module.exports = router;

