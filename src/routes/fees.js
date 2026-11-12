/**
 * Fees Ledger & Payment Receipts API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/fees/ledger
 * Student's own fee ledger + verified payment receipts
 */
router.get('/ledger', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.json({ success: true, fees: [], receipts: [], totals: { totalDue: 0, totalPaid: 0, balanceDue: 0 } });
    }

    const [fees, receipts] = await Promise.all([
      db.getStudentFees(student.id),
      db.getPaymentReceipts(student.id),
    ]);

    const totals = fees.reduce(
      (acc, f) => ({
        totalDue: acc.totalDue + Number(f.total_due || 0),
        totalPaid: acc.totalPaid + Number(f.amount_paid || 0),
        balanceDue: acc.balanceDue + Number(f.balance_due || 0),
      }),
      { totalDue: 0, totalPaid: 0, balanceDue: 0 }
    );

    res.json({ success: true, fees, receipts, totals });
  } catch (err) {
    console.error('[fees/ledger] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load fees ledger.' });
  }
});

/**
 * GET /api/fees/receipts/:receiptNumber
 * Owner-scoped payment receipt lookup
 */
router.get('/receipts/:receiptNumber', requireAuth, async (req, res) => {
  try {
    const recRes = await db.query(
      `SELECT p.*, s.student_id AS gueid, s.enrollment_number, u.full_name, u.email,
              sf.total_due, sf.amount_paid, sf.balance_due, sem.semester_number, sess.session_name
       FROM payments p
       JOIN student_fees sf ON p.student_fee_id = sf.id
       JOIN students s ON p.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN fee_structures fs ON sf.fee_structure_id = fs.id
       JOIN semesters sem ON fs.semester_id = sem.id
       JOIN academic_sessions sess ON fs.academic_session_id = sess.id
       WHERE p.receipt_number = $1
       LIMIT 1`,
      [req.params.receiptNumber]
    );

    if (recRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Receipt not found.' });
    }

    const row = recRes.rows[0];
    if (req.user?.role !== 'admin') {
      const student = await db.getStudentByUserId(req.session.userId);
      if (!student || student.id !== row.student_id) {
        return res.status(403).json({ success: false, error: 'Access denied to this fee receipt.' });
      }
    }

    res.json({ success: true, receipt: row });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch fee receipt.' });
  }
});

/**
 * GET /api/fees/admin/overview
 * Admin overview of fee structures & student fee accounts
 */
router.get('/admin/overview', requireAdmin, async (req, res) => {
  try {
    const [structuresRes, ledgerRes, paymentsRes] = await Promise.all([
      db.query(
        `SELECT fs.*, c.code AS course_code, sem.semester_number, sess.session_name
         FROM fee_structures fs
         JOIN courses c ON fs.course_id = c.id
         JOIN semesters sem ON fs.semester_id = sem.id
         JOIN academic_sessions sess ON fs.academic_session_id = sess.id
         ORDER BY fs.due_date DESC`
      ),
      db.query(
        `SELECT sf.*, s.student_id AS gueid, u.full_name, u.email, sem.semester_number
         FROM student_fees sf
         JOIN students s ON sf.student_id = s.id
         JOIN users u ON s.user_id = u.id
         JOIN fee_structures fs ON sf.fee_structure_id = fs.id
         JOIN semesters sem ON fs.semester_id = sem.id
         ORDER BY sf.due_date DESC
         LIMIT 100`
      ),
      db.query(
        `SELECT p.*, s.student_id AS gueid, u.full_name
         FROM payments p
         JOIN students s ON p.student_id = s.id
         JOIN users u ON s.user_id = u.id
         ORDER BY p.payment_date DESC
         LIMIT 100`
      ),
    ]);
    res.json({
      success: true,
      structures: structuresRes.rows,
      studentFees: ledgerRes.rows,
      payments: paymentsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load admin fees overview.' });
  }
});

/**
 * POST /api/fees/admin/structures
 * Admin creates/updates a fee structure
 */
router.post('/admin/structures', requireAdmin, async (req, res) => {
  const { courseId, semesterId, tuitionFee = 0, examinationFee = 0, hostelFee = 0, libraryFee = 0, otherCharges = 0, dueDate } = req.body || {};
  if (!courseId || !semesterId || !dueDate) {
    return res.status(400).json({ success: false, error: 'courseId, semesterId, and dueDate are required.' });
  }

  try {
    const semRes = await db.query('SELECT academic_session_id FROM semesters WHERE id = $1', [semesterId]);
    if (semRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Semester not found.' });

    const total = Number(tuitionFee) + Number(examinationFee) + Number(hostelFee) + Number(libraryFee) + Number(otherCharges);
    const id = `fs_${crypto.randomUUID()}`;
    const upsert = await db.query(
      `INSERT INTO fee_structures (
         id, course_id, semester_id, academic_session_id,
         tuition_fee, examination_fee, hostel_fee, library_fee, other_charges, total_amount, due_date, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, NOW())
       ON CONFLICT (course_id, semester_id, academic_session_id)
       DO UPDATE SET
         tuition_fee = EXCLUDED.tuition_fee,
         examination_fee = EXCLUDED.examination_fee,
         hostel_fee = EXCLUDED.hostel_fee,
         library_fee = EXCLUDED.library_fee,
         other_charges = EXCLUDED.other_charges,
         total_amount = EXCLUDED.total_amount,
         due_date = EXCLUDED.due_date
       RETURNING *`,
      [id, courseId, semesterId, semRes.rows[0].academic_session_id, Number(tuitionFee), Number(examinationFee), Number(hostelFee), Number(libraryFee), Number(otherCharges), total, dueDate]
    );
    res.json({ success: true, feeStructure: upsert.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to save fee structure.' });
  }
});

/**
 * POST /api/fees/admin/payments
 * Admin records a verified payment and updates student fee ledger balance transactionally
 */
router.post('/admin/payments', requireAdmin, async (req, res) => {
  const { studentFeeId, amount, paymentMethod, transactionReference } = req.body || {};
  const payAmount = Number(amount || 0);
  if (!studentFeeId || payAmount <= 0 || !paymentMethod || !transactionReference) {
    return res.status(400).json({ success: false, error: 'studentFeeId, positive amount, paymentMethod, and transactionReference are required.' });
  }

  try {
    const result = await db.withTransaction(async (client) => {
      const sfRes = await client.query('SELECT * FROM student_fees WHERE id = $1 FOR UPDATE', [studentFeeId]);
      if (sfRes.rows.length === 0) {
        const err = new Error('Student fee record not found.');
        err.statusCode = 404;
        throw err;
      }
      const sf = sfRes.rows[0];
      const receiptNumber = `GEU-RCP-${Date.now().toString().slice(-8)}`;
      const paymentId = `pay_${crypto.randomUUID()}`;

      const payIns = await client.query(
        `INSERT INTO payments (id, student_fee_id, student_id, receipt_number, amount, payment_method, transaction_reference, payment_status, payment_date, verified_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', NOW(), $8, NOW())
         RETURNING *`,
        [paymentId, sf.id, sf.student_id, receiptNumber, payAmount, paymentMethod, String(transactionReference).trim(), req.session.userId]
      );

      const nextPaid = Number(sf.amount_paid || 0) + payAmount;
      const nextBalance = Math.max(0, Number(sf.total_due || 0) - nextPaid);
      const nextStatus = nextBalance <= 0 ? 'paid' : nextPaid > 0 ? 'partially_paid' : 'unpaid';

      const sfUpd = await client.query(
        `UPDATE student_fees
         SET amount_paid = $1, balance_due = $2, status = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [nextPaid, nextBalance, nextStatus, sf.id]
      );

      return { payment: payIns.rows[0], studentFee: sfUpd.rows[0] };
    });

    await db.recordAuditLog({
      userId: req.session.userId,
      action: 'RECORD_FEE_PAYMENT',
      resource: `payments:${result.payment.id}`,
      details: { receiptNumber: result.payment.receipt_number, amount: payAmount },
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to record payment.' });
  }
});

module.exports = router;
