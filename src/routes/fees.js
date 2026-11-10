/**
 * Fee Management & Payment Receipts API Routes
 * GUeAttend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/fees/summary
 * Fee structure breakdown, dues, and payment statuses
 */
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const fees = await db.getStudentFees(student.id);

    let totalDue = 0;
    let totalPaid = 0;
    let balanceDue = 0;

    for (const f of fees) {
      totalDue += parseFloat(f.total_due || 0);
      totalPaid += parseFloat(f.amount_paid || 0);
      balanceDue += parseFloat(f.balance_due || 0);
    }

    res.json({
      success: true,
      totalDue: totalDue.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      balanceDue: balanceDue.toFixed(2),
      hasPendingDues: balanceDue > 0,
      feeRecords: fees,
    });
  } catch (err) {
    console.error('[fees/summary] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch fee summary.' });
  }
});

/**
 * GET /api/fees/receipts
 * Verified payment receipts
 */
router.get('/receipts', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const receipts = await db.getPaymentReceipts(student.id);

    res.json({
      success: true,
      receipts,
    });
  } catch (err) {
    console.error('[fees/receipts] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch payment receipts.' });
  }
});

module.exports = router;

