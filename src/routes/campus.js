/**
 * Circulars, Grievances, Hostel, Placements & Support Contact API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limiter');

/**
 * GET /api/campus/circulars
 */
router.get('/circulars', requireAuth, async (req, res) => {
  try {
    const roleAudience = req.user?.role === 'faculty' ? 'faculty' : 'students';
    const circulars = await db.getCirculars(roleAudience, 50);
    res.json({ success: true, circulars });
  } catch (err) {
    console.error('[campus/circulars] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch circulars.' });
  }
});

/**
 * GET /api/campus/grievances
 * Student's grievances + threaded responses
 */
router.get('/grievances', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.json({ success: true, grievances: [] });
    }

    const grievances = await db.getStudentGrievances(student.id);
    if (grievances.length > 0) {
      const ids = grievances.map((g) => g.id);
      const respRes = await db.query(
        `SELECT gr.*, u.full_name AS author_name, u.role AS author_role
         FROM grievance_responses gr
         JOIN users u ON gr.user_id = u.id
         WHERE gr.grievance_id = ANY($1::text[])
         ORDER BY gr.created_at ASC`,
        [ids]
      );
      const byGrievance = new Map();
      for (const r of respRes.rows) {
        if (!byGrievance.has(r.grievance_id)) byGrievance.set(r.grievance_id, []);
        byGrievance.get(r.grievance_id).push(r);
      }
      grievances.forEach((g) => {
        g.responses = byGrievance.get(g.id) || [];
      });
    }

    res.json({ success: true, grievances });
  } catch (err) {
    console.error('[campus/grievances] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load grievances.' });
  }
});

/**
 * POST /api/campus/grievances
 * Student submits a new grievance
 */
router.post('/grievances', requireAuth, async (req, res) => {
  const { category, subject, description, attachmentUrl } = req.body || {};
  const validCategories = ['academic', 'examination', 'hostel', 'canteen', 'fee', 'general'];
  const cleanCategory = String(category || 'general').trim().toLowerCase();

  if (!validCategories.includes(cleanCategory)) {
    return res.status(400).json({ success: false, error: 'Invalid grievance category.' });
  }
  if (!String(subject || '').trim() || !String(description || '').trim()) {
    return res.status(400).json({ success: false, error: 'Subject and description are required.' });
  }

  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const created = await db.createGrievance({
      studentId: student.id,
      category: cleanCategory,
      subject: String(subject).trim(),
      description: String(description).trim(),
      attachmentUrl: String(attachmentUrl || '').trim(),
    });

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'GRIEVANCE_SUBMITTED',
      resource: `grievances:${created.id}`,
      details: { category: cleanCategory, subject: created.subject },
    });

    res.json({ success: true, grievance: created });
  } catch (err) {
    console.error('[campus/grievances:create] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit grievance.' });
  }
});

/**
 * POST /api/campus/grievances/:id/responses
 * Owner student or admin/faculty posts a grievance response
 */
router.post('/grievances/:id/responses', requireAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ success: false, error: 'Response message is required.' });
  }

  try {
    const grvRes = await db.query(
      `SELECT g.*, s.user_id AS owner_user_id
       FROM grievances g
       JOIN students s ON g.student_id = s.id
       WHERE g.id = $1`,
      [req.params.id]
    );
    if (grvRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Grievance not found.' });
    }

    const grievance = grvRes.rows[0];
    const isElevated = req.user?.role === 'admin' || req.user?.role === 'faculty';
    if (!isElevated && grievance.owner_user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Access denied for this grievance.' });
    }

    const respId = `grvr_${crypto.randomUUID()}`;
    const ins = await db.query(
      `INSERT INTO grievance_responses (id, grievance_id, user_id, message, attachment_url, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [respId, req.params.id, req.session.userId, message, String(req.body?.attachmentUrl || '').trim()]
    );

    res.json({ success: true, response: ins.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to post response.' });
  }
});

/**
 * GET /api/campus/hostel-placements
 */
router.get('/hostel-placements', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) return res.json({ success: true, hostel: null, placements: [] });
    const [hostel, placements] = await Promise.all([
      db.getHostelDetails(student.id),
      db.getPlacements(student.id),
    ]);
    res.json({ success: true, hostel, placements });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load hostel and placement details.' });
  }
});

/**
 * POST /api/campus/contact
 * Public landing contact form persistence
 */
router.post(
  '/contact',
  rateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 10, message: 'Too many contact submissions. Please try again later.' }),
  async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const message = String(req.body?.message || '').trim();

    if (!name || !email.includes('@') || !message) {
      return res.status(400).json({ success: false, error: 'Name, valid email, and message are required.' });
    }

    try {
      const id = `msg_${crypto.randomUUID()}`;
      await db.query(
        `INSERT INTO contact_messages (id, name, email, message, status, ip_address, created_at)
         VALUES ($1, $2, $3, $4, 'open', $5, NOW())`,
        [id, name.slice(0, 120), email.slice(0, 180), message.slice(0, 2000), req.ip || '']
      );
      res.json({ success: true, message: 'Thank you for reaching out! Your message has been recorded for review.' });
    } catch (err) {
      console.error('[campus/contact] Error:', err.message);
      res.status(500).json({ success: false, error: 'Could not submit message right now.' });
    }
  }
);

module.exports = router;
