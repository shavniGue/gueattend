/**
 * Academic & Lecture Plan Management API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/academic/lecture-plan
 * Lecture Plan widgets: Today's Topics, Topics of Week, Completed, Pending, Dropped
 */
router.get('/lecture-plan', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const plans = await db.getLecturePlans(student.section_id);

    const todayStr = new Date().toISOString().split('T')[0];

    const todayTopics = plans.filter((p) => {
      const d = p.planned_date instanceof Date ? p.planned_date.toISOString().split('T')[0] : String(p.planned_date);
      return d === todayStr;
    });

    const completedTopics = plans.filter((p) => p.completion_status === 'completed');
    const pendingTopics = plans.filter((p) => p.completion_status === 'pending');
    const droppedTopics = plans.filter((p) => p.completion_status === 'dropped');

    res.json({
      success: true,
      totalTopics: plans.length,
      todayTopics,
      completedTopics,
      pendingTopics,
      droppedTopics,
      allPlans: plans,
    });
  } catch (err) {
    console.error('[academic/lecture-plan] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch lecture plans.' });
  }
});

/**
 * GET /api/academic/course-progress
 * Subject-wise syllabus completion percentage
 */
router.get('/course-progress', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const progress = await db.getCourseProgress(student.section_id);

    res.json({
      success: true,
      subjects: progress,
    });
  } catch (err) {
    console.error('[academic/course-progress] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch course progress.' });
  }
});

/**
 * GET /api/academic/materials
 * Study materials and lecture notes
 */
router.get('/materials', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const sql = `
      SELECT sm.*, sub.code AS subject_code, sub.name AS subject_name, u_fac.full_name AS faculty_name
      FROM study_materials sm
      JOIN subjects sub ON sm.subject_id = sub.id
      JOIN faculty fac ON sm.faculty_id = fac.id
      JOIN users u_fac ON fac.user_id = u_fac.id
      WHERE sub.semester_id = $1
      ORDER BY sm.uploaded_at DESC
    `;
    const materialsRes = await db.query(sql, [student.semester_id]);

    res.json({
      success: true,
      materials: materialsRes.rows,
    });
  } catch (err) {
    console.error('[academic/materials] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch study materials.' });
  }
});

/**
 * GET /api/academic/assignments
 * Homework assignments and student submission status
 */
router.get('/assignments', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const sql = `
      SELECT 
        a.*,
        sub.code AS subject_code,
        sub.name AS subject_name,
        asub.submission_url,
        asub.submitted_at,
        asub.marks_obtained,
        asub.faculty_feedback,
        CASE WHEN asub.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_submitted
      FROM assignments a
      LEFT JOIN subjects sub ON a.subject_id = sub.id
      LEFT JOIN assignment_submissions asub ON asub.assignment_id = a.id AND asub.student_id = $1
      ORDER BY a.created_at DESC
    `;
    const asgnRes = await db.query(sql, [student.id]);

    res.json({
      success: true,
      assignments: asgnRes.rows,
    });
  } catch (err) {
    console.error('[academic/assignments] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch assignments.' });
  }
});

module.exports = router;

