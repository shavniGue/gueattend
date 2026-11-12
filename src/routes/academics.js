/**
 * Academic Records, Lecture Plans, Study Materials & Assignments API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database/db');
const { requireAuth, requireFaculty } = require('../middleware/auth');

/**
 * GET /api/academics/profile
 * Full student academic record (course, semester, section, CGPA, backlogs)
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const [results, backlogsRes] = await Promise.all([
      db.getStudentResults(student.id),
      db.query(
        `SELECT b.*, sub.code AS subject_code, sub.name AS subject_name, sem.semester_number
         FROM backlogs b
         JOIN subjects sub ON b.subject_id = sub.id
         LEFT JOIN semesters sem ON b.original_semester_id = sem.id
         WHERE b.student_id = $1
         ORDER BY b.created_at DESC`,
        [student.id]
      ),
    ]);

    const latestResult = results[0] || null;

    res.json({
      success: true,
      profile: {
        id: student.id,
        studentId: student.student_id,
        enrollmentNumber: student.enrollment_number,
        rollNumber: student.roll_number,
        fullName: student.full_name,
        email: student.email,
        phone: student.phone,
        departmentName: student.department_name,
        departmentCode: student.department_code,
        courseName: student.course_name,
        courseCode: student.course_code,
        semesterNumber: student.semester_number,
        sectionName: student.section_name,
        sessionName: student.session_name,
        cgpa: latestResult ? Number(latestResult.cgpa) : null,
        latestSgpa: latestResult ? Number(latestResult.sgpa) : null,
        activeBacklogs: backlogsRes.rows.filter((b) => b.status === 'active').length,
      },
      results,
      backlogs: backlogsRes.rows,
    });
  } catch (err) {
    console.error('[academics/profile] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load academic profile.' });
  }
});

/**
 * GET /api/academics/lecture-plans
 */
router.get('/lecture-plans', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    const targetSectionId = req.query.sectionId || student?.section_id;
    if (!targetSectionId) {
      return res.json({ success: true, plans: [], progress: [] });
    }

    if (req.user?.role === 'student' && student && targetSectionId !== student.section_id) {
      return res.status(403).json({ success: false, error: 'Cannot view another section lecture plan.' });
    }

    const [plans, progress] = await Promise.all([
      db.getLecturePlans(targetSectionId),
      db.getCourseProgress(targetSectionId),
    ]);

    res.json({ success: true, sectionId: targetSectionId, plans, progress });
  } catch (err) {
    console.error('[academics/lecture-plans] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch lecture plans.' });
  }
});

/**
 * POST /api/academics/lecture-plans
 * Faculty/Admin creates a lecture plan topic
 */
router.post('/lecture-plans', requireFaculty, async (req, res) => {
  const { subjectId, sectionId, weekNumber, topicTitle, plannedDate, notes } = req.body || {};
  if (!subjectId || !sectionId || !weekNumber || !topicTitle || !plannedDate) {
    return res.status(400).json({ success: false, error: 'subjectId, sectionId, weekNumber, topicTitle, and plannedDate are required.' });
  }

  try {
    const faculty = await db.getFacultyByUserId(req.session.userId);
    const facRes = faculty || (await db.query('SELECT id FROM faculty LIMIT 1')).rows[0];
    if (!facRes) {
      return res.status(400).json({ success: false, error: 'Faculty profile is required to author lecture plans.' });
    }

    const id = `lp_${crypto.randomUUID()}`;
    const ins = await db.query(
      `INSERT INTO lecture_plans (id, subject_id, faculty_id, section_id, week_number, topic_title, planned_date, completion_status, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'pending', $8, NOW(), NOW())
       RETURNING *`,
      [id, subjectId, facRes.id, sectionId, parseInt(weekNumber, 10), String(topicTitle).trim(), plannedDate, notes || '']
    );

    res.json({ success: true, lecturePlan: ins.rows[0] });
  } catch (err) {
    console.error('[academics/lecture-plans:create] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create lecture plan topic.' });
  }
});

/**
 * POST /api/academics/lecture-plans/:id/status
 */
router.post('/lecture-plans/:id/status', requireFaculty, async (req, res) => {
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!['completed', 'pending', 'dropped'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status (completed, pending, or dropped).' });
  }

  try {
    const upd = await db.query(
      `UPDATE lecture_plans
       SET completion_status = $1,
           completed_date = CASE WHEN $1 = 'completed' THEN CURRENT_DATE ELSE NULL END,
           notes = COALESCE($2, notes),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, req.body?.notes ?? null, req.params.id]
    );
    if (upd.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lecture plan item not found.' });
    }
    res.json({ success: true, lecturePlan: upd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update lecture plan status.' });
  }
});

/**
 * GET /api/academics/study-materials
 */
router.get('/study-materials', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    const params = [];
    let whereSql = '';

    if (student && req.user?.role === 'student') {
      whereSql = 'WHERE sub.course_id = $1 AND sub.semester_id = $2';
      params.push(student.course_id, student.semester_id);
    }

    const resMat = await db.query(
      `SELECT sm.*, sub.code AS subject_code, sub.name AS subject_name, u.full_name AS faculty_name
       FROM study_materials sm
       JOIN subjects sub ON sm.subject_id = sub.id
       LEFT JOIN faculty fac ON sm.faculty_id = fac.id
       LEFT JOIN users u ON fac.user_id = u.id
       ${whereSql}
       ORDER BY sm.uploaded_at DESC
       LIMIT 50`,
      params
    );

    res.json({ success: true, materials: resMat.rows });
  } catch (err) {
    console.error('[academics/study-materials] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load study materials.' });
  }
});

/**
 * POST /api/academics/study-materials
 */
router.post('/study-materials', requireFaculty, async (req, res) => {
  const { subjectId, title, description, fileUrl, fileType } = req.body || {};
  if (!subjectId || !title || !fileUrl) {
    return res.status(400).json({ success: false, error: 'subjectId, title, and fileUrl are required.' });
  }

  try {
    const faculty = await db.getFacultyByUserId(req.session.userId);
    const facRes = faculty || (await db.query('SELECT id FROM faculty LIMIT 1')).rows[0];
    if (!facRes) {
      return res.status(400).json({ success: false, error: 'Faculty profile required.' });
    }

    const id = `mat_${crypto.randomUUID()}`;
    const ins = await db.query(
      `INSERT INTO study_materials (id, subject_id, faculty_id, title, description, file_url, file_type, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [id, subjectId, facRes.id, String(title).trim(), description || '', String(fileUrl).trim(), fileType || 'pdf']
    );
    res.json({ success: true, material: ins.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to publish study material.' });
  }
});

/**
 * GET /api/academics/assignments
 * Lists assignments for the student's section + submission status
 */
router.get('/assignments', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student && req.user?.role === 'student') {
      return res.json({ success: true, assignments: [] });
    }

    if (student && req.user?.role === 'student') {
      const resAsgn = await db.query(
        `SELECT
           a.*,
           sub.code AS subject_code,
           sub.name AS subject_name,
           u_fac.full_name AS faculty_name,
           subm.id AS submission_id,
           subm.submission_url,
           subm.remarks AS submission_remarks,
           subm.marks_obtained,
           subm.faculty_feedback,
           subm.submitted_at,
           subm.graded_at
         FROM assignments a
         LEFT JOIN subjects sub ON a.subject_id = sub.id
         LEFT JOIN faculty fac ON a.faculty_id = fac.id
         LEFT JOIN users u_fac ON fac.user_id = u_fac.id
         LEFT JOIN assignment_submissions subm ON subm.assignment_id = a.id AND subm.student_id = $1
         WHERE a.section_id = $2 OR a.section_id IS NULL OR a.user_id = $3
         ORDER BY COALESCE(a.due_date, a.created_at) ASC`,
        [student.id, student.section_id, req.session.userId]
      );
      return res.json({ success: true, assignments: resAsgn.rows });
    }

    // Faculty / Admin view
    const resAll = await db.query(
      `SELECT a.*, sub.code AS subject_code, sub.name AS subject_name, sec.name AS section_name,
              (SELECT COUNT(*)::int FROM assignment_submissions s WHERE s.assignment_id = a.id) AS submission_count
       FROM assignments a
       LEFT JOIN subjects sub ON a.subject_id = sub.id
       LEFT JOIN sections sec ON a.section_id = sec.id
       ORDER BY a.created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, assignments: resAll.rows });
  } catch (err) {
    console.error('[academics/assignments] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load assignments.' });
  }
});

/**
 * POST /api/academics/assignments
 * Faculty/Admin publishes an assignment
 */
router.post('/assignments', requireFaculty, async (req, res) => {
  const { subjectId, sectionId, title, description, dueDate, maxMarks, attachmentUrl } = req.body || {};
  if (!subjectId || !sectionId || !title || !dueDate) {
    return res.status(400).json({ success: false, error: 'subjectId, sectionId, title, and dueDate are required.' });
  }

  try {
    const faculty = await db.getFacultyByUserId(req.session.userId);
    const facId = faculty ? faculty.id : null;
    const ins = await db.query(
      `INSERT INTO assignments (user_id, subject_id, faculty_id, section_id, title, description, due_date, max_marks, attachment_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, NOW())
       RETURNING *`,
      [
        req.session.userId,
        subjectId,
        facId,
        sectionId,
        String(title).trim(),
        description || '',
        dueDate,
        Number(maxMarks || 100),
        attachmentUrl || '',
      ]
    );
    res.json({ success: true, assignment: ins.rows[0] });
  } catch (err) {
    console.error('[academics/assignments:create] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to publish assignment.' });
  }
});

/**
 * POST /api/academics/assignments/:id/submit
 * Student submits or updates assignment link & notes
 */
router.post('/assignments/:id/submit', requireAuth, async (req, res) => {
  const assignmentId = parseInt(req.params.id, 10);
  const { submissionUrl, remarks } = req.body || {};
  if (!assignmentId || !submissionUrl) {
    return res.status(400).json({ success: false, error: 'Valid assignment ID and submissionUrl are required.' });
  }

  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile required to submit assignments.' });
    }

    const asgnCheck = await db.query('SELECT id FROM assignments WHERE id = $1', [assignmentId]);
    if (asgnCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Assignment not found.' });
    }

    const subId = `asub_${crypto.randomUUID()}`;
    const upsert = await db.query(
      `INSERT INTO assignment_submissions (id, assignment_id, student_id, submission_url, remarks, submitted_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET
         submission_url = EXCLUDED.submission_url,
         remarks = EXCLUDED.remarks,
         submitted_at = NOW()
       RETURNING *`,
      [subId, assignmentId, student.id, String(submissionUrl).trim(), String(remarks || '').trim()]
    );

    res.json({ success: true, submission: upsert.rows[0], message: 'Assignment submitted successfully.' });
  } catch (err) {
    console.error('[academics/assignments:submit] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit assignment.' });
  }
});

/**
 * GET /api/academics/assignments/:id/submissions
 * Faculty/Admin views submissions for an assignment
 */
router.get('/assignments/:id/submissions', requireFaculty, async (req, res) => {
  try {
    const resSub = await db.query(
      `SELECT subm.*, s.student_id AS gueid, s.roll_number, u.full_name, u.email
       FROM assignment_submissions subm
       JOIN students s ON subm.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE subm.assignment_id = $1
       ORDER BY subm.submitted_at DESC`,
      [parseInt(req.params.id, 10)]
    );
    res.json({ success: true, submissions: resSub.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load assignment submissions.' });
  }
});

/**
 * POST /api/academics/submissions/:submissionId/grade
 * Faculty/Admin grades a student submission
 */
router.post('/submissions/:submissionId/grade', requireFaculty, async (req, res) => {
  const { marksObtained, facultyFeedback } = req.body || {};
  if (marksObtained === undefined || marksObtained === null || Number.isNaN(Number(marksObtained))) {
    return res.status(400).json({ success: false, error: 'Numeric marksObtained is required.' });
  }

  try {
    const upd = await db.query(
      `UPDATE assignment_submissions
       SET marks_obtained = $1,
           faculty_feedback = $2,
           graded_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [Number(marksObtained), String(facultyFeedback || '').trim(), req.params.submissionId]
    );
    if (upd.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found.' });
    }
    res.json({ success: true, submission: upd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to grade submission.' });
  }
});

module.exports = router;
