/**
 * Examinations, Schedules, Marks & Results API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database/db');
const { requireAuth, requireFaculty, requireAdmin } = require('../middleware/auth');

function computeGradeLetterAndPoint(total, maxMarks) {
  const pct = maxMarks > 0 ? (total / maxMarks) * 100 : 0;
  if (pct >= 90) return { letter: 'O', point: 10.0, status: 'pass' };
  if (pct >= 80) return { letter: 'A+', point: 9.0, status: 'pass' };
  if (pct >= 70) return { letter: 'A', point: 8.0, status: 'pass' };
  if (pct >= 60) return { letter: 'B+', point: 7.0, status: 'pass' };
  if (pct >= 50) return { letter: 'B', point: 6.0, status: 'pass' };
  if (pct >= 40) return { letter: 'C', point: 5.0, status: 'pass' };
  return { letter: 'F', point: 0.0, status: 'fail' };
}

/**
 * GET /api/exams/overview
 * Aggregated student view: upcoming exams, schedules, marks, semester results, backlogs
 */
router.get('/overview', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.json({
        success: true,
        examinations: [],
        schedules: [],
        marks: [],
        results: [],
        backlogs: [],
      });
    }

    const [examsRes, schedules, marks, results, backlogsRes] = await Promise.all([
      db.query(
        `SELECT e.*, sem.semester_number, sess.session_name
         FROM examinations e
         JOIN semesters sem ON e.semester_id = sem.id
         JOIN academic_sessions sess ON e.academic_session_id = sess.id
         WHERE e.semester_id = $1
         ORDER BY e.start_date DESC`,
        [student.semester_id]
      ),
      db.getExamSchedules(student.semester_id),
      db.getStudentMarks(student.id),
      db.getStudentResults(student.id),
      db.query(
        `SELECT b.*, sub.code AS subject_code, sub.name AS subject_name
         FROM backlogs b
         JOIN subjects sub ON b.subject_id = sub.id
         WHERE b.student_id = $1
         ORDER BY b.created_at DESC`,
        [student.id]
      ),
    ]);

    res.json({
      success: true,
      examinations: examsRes.rows,
      schedules,
      marks,
      results,
      backlogs: backlogsRes.rows,
    });
  } catch (err) {
    console.error('[exams/overview] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load examination & results data.' });
  }
});

/**
 * GET /api/exams/schedules
 */
router.get('/schedules', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) return res.json({ success: true, schedules: [] });
    const schedules = await db.getExamSchedules(student.semester_id);
    res.json({ success: true, schedules });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch exam schedules.' });
  }
});

/**
 * GET /api/exams/results
 */
router.get('/results', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) return res.json({ success: true, results: [], marks: [] });
    const [results, marks] = await Promise.all([
      db.getStudentResults(student.id),
      db.getStudentMarks(student.id, req.query.examId || null),
    ]);
    res.json({ success: true, results, marks });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch student results.' });
  }
});

/**
 * GET /api/exams/manage
 * Faculty & Admin: lists examinations, schedules, and semesters
 */
router.get('/manage', requireFaculty, async (req, res) => {
  try {
    const [examsRes, schedRes] = await Promise.all([
      db.query(
        `SELECT e.*, sem.semester_number, c.code AS course_code, sess.session_name
         FROM examinations e
         JOIN semesters sem ON e.semester_id = sem.id
         JOIN courses c ON sem.course_id = c.id
         JOIN academic_sessions sess ON e.academic_session_id = sess.id
         ORDER BY e.start_date DESC`
      ),
      db.query(
        `SELECT es.*, e.name AS exam_name, sub.code AS subject_code, sub.name AS subject_name, cr.room_number
         FROM exam_schedules es
         JOIN examinations e ON es.examination_id = e.id
         JOIN subjects sub ON es.subject_id = sub.id
         LEFT JOIN classrooms cr ON es.classroom_id = cr.id
         ORDER BY es.exam_date ASC`
      ),
    ]);
    res.json({ success: true, examinations: examsRes.rows, schedules: schedRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load examinations management data.' });
  }
});

/**
 * POST /api/exams/marks
 * Faculty/Admin enters or updates marks for a student
 */
router.post('/marks', requireFaculty, async (req, res) => {
  const { examinationId, studentId, subjectId, internalMarks = 0, externalMarks = 0, maxMarks = 100 } = req.body || {};
  if (!examinationId || !studentId || !subjectId) {
    return res.status(400).json({ success: false, error: 'examinationId, studentId, and subjectId are required.' });
  }

  try {
    const total = Number(internalMarks || 0) + Number(externalMarks || 0);
    const maxVal = Number(maxMarks || 100);
    const grade = computeGradeLetterAndPoint(total, maxVal);
    const id = `mrk_${crypto.randomUUID()}`;

    const resMark = await db.query(
      `INSERT INTO marks (
         id, examination_id, student_id, subject_id,
         internal_marks, external_marks, total_marks, max_marks,
         grade_letter, grade_point, status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       ON CONFLICT (examination_id, student_id, subject_id)
       DO UPDATE SET
         internal_marks = EXCLUDED.internal_marks,
         external_marks = EXCLUDED.external_marks,
         total_marks = EXCLUDED.total_marks,
         max_marks = EXCLUDED.max_marks,
         grade_letter = EXCLUDED.grade_letter,
         grade_point = EXCLUDED.grade_point,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [id, examinationId, studentId, subjectId, Number(internalMarks), Number(externalMarks), total, maxVal, grade.letter, grade.point, grade.status]
    );

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'UPSERT_EXAM_MARKS',
      resource: `marks:${resMark.rows[0].id}`,
      details: { examinationId, studentId, subjectId, total, grade: grade.letter },
    });

    res.json({ success: true, mark: resMark.rows[0] });
  } catch (err) {
    console.error('[exams/marks] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to record student marks.' });
  }
});

/**
 * POST /api/exams
 * Admin creates an examination session
 */
router.post('/', requireAdmin, async (req, res) => {
  const { semesterId, name, examType, startDate, endDate, admitCardReleased } = req.body || {};
  if (!semesterId || !name || !examType || !startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'semesterId, name, examType, startDate, and endDate are required.' });
  }

  try {
    const semRes = await db.query('SELECT academic_session_id FROM semesters WHERE id = $1', [semesterId]);
    if (semRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Semester not found.' });
    }
    const id = `exam_${crypto.randomUUID()}`;
    const ins = await db.query(
      `INSERT INTO examinations (id, academic_session_id, semester_id, name, exam_type, start_date, end_date, is_published, admit_card_released, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, FALSE, $8, NOW())
       RETURNING *`,
      [id, semRes.rows[0].academic_session_id, semesterId, String(name).trim(), examType, startDate, endDate, Boolean(admitCardReleased)]
    );
    res.json({ success: true, examination: ins.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create examination.' });
  }
});

/**
 * POST /api/exams/:id/schedules
 * Admin adds an exam timetable slot
 */
router.post('/:id/schedules', requireAdmin, async (req, res) => {
  const { subjectId, examDate, startTime, endTime, classroomId, maxMarks = 100 } = req.body || {};
  if (!subjectId || !examDate || !startTime || !endTime) {
    return res.status(400).json({ success: false, error: 'subjectId, examDate, startTime, and endTime are required.' });
  }

  try {
    const id = `es_${crypto.randomUUID()}`;
    const upsert = await db.query(
      `INSERT INTO exam_schedules (id, examination_id, subject_id, exam_date, start_time, end_time, classroom_id, max_marks, created_at)
       VALUES ($1, $2, $3, $4::date, $5::time, $6::time, $7, $8, NOW())
       ON CONFLICT (examination_id, subject_id)
       DO UPDATE SET
         exam_date = EXCLUDED.exam_date,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         classroom_id = EXCLUDED.classroom_id,
         max_marks = EXCLUDED.max_marks
       RETURNING *`,
      [id, req.params.id, subjectId, examDate, startTime, endTime, classroomId || null, Number(maxMarks)]
    );
    res.json({ success: true, schedule: upsert.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to save exam schedule.' });
  }
});

/**
 * POST /api/exams/:id/publish
 * Admin toggles published/admit card status
 */
router.post('/:id/publish', requireAdmin, async (req, res) => {
  try {
    const upd = await db.query(
      `UPDATE examinations
       SET is_published = COALESCE($1, is_published),
           admit_card_released = COALESCE($2, admit_card_released)
       WHERE id = $3
       RETURNING *`,
      [
        req.body?.isPublished !== undefined ? Boolean(req.body.isPublished) : null,
        req.body?.admitCardReleased !== undefined ? Boolean(req.body.admitCardReleased) : null,
        req.params.id,
      ]
    );
    if (upd.rows.length === 0) return res.status(404).json({ success: false, error: 'Examination not found.' });
    res.json({ success: true, examination: upd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update examination publication state.' });
  }
});

module.exports = router;
