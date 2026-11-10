/**
 * Modular External ERP Data Integration Service
 * GUeAttend Unified University ERP
 *
 * Implements authorized synchronization layer:
 *   External API / Source -> Validation -> Normalization -> Supabase PostgreSQL
 */

const db = require('../database/db');

/**
 * Validates external attendance payload records
 */
function validateAttendanceRecord(rec) {
  if (!rec.studentId && !rec.qid && !rec.userId) {
    throw new Error('Record missing student identifier (studentId, qid, or userId).');
  }
  if (!rec.subjectCode) {
    throw new Error('Record missing subjectCode.');
  }
  if (!rec.classDate) {
    throw new Error('Record missing classDate.');
  }
  const validStatuses = ['present', 'absent', 'approved_leave', 'not_marked'];
  const status = String(rec.status || 'present').toLowerCase().trim();
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${rec.status}`);
  }
  return {
    ...rec,
    status,
  };
}

/**
 * Normalizes and synchronizes batch attendance records into Supabase PostgreSQL
 */
async function syncAttendanceBatch(records, sourceName = 'EXTERNAL_API', syncedByUserId = null) {
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const errorDetails = [];

  for (const item of records) {
    processed++;
    try {
      const valid = validateAttendanceRecord(item);

      // Resolve student and user IDs
      const sRes = await db.query(
        `SELECT s.id AS student_id, s.user_id, s.student_id AS qid 
         FROM students s
         WHERE s.student_id = $1 OR s.id = $1 OR s.user_id = $1`,
        [valid.studentId || valid.qid || valid.userId]
      );

      if (sRes.rows.length === 0) {
        errors++;
        errorDetails.push({ row: processed, error: `Student not found for ${valid.studentId || valid.qid}` });
        continue;
      }

      const sRow = sRes.rows[0];

      const res = await db.query(
        `INSERT INTO attendance_records (user_id, qid, subject_code, subject_name, class_date, student_id, status, remarks, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (user_id, qid, subject_code, class_date)
         DO UPDATE SET 
           status = EXCLUDED.status,
           subject_name = EXCLUDED.subject_name,
           remarks = EXCLUDED.remarks,
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          sRow.user_id,
          sRow.qid,
          valid.subjectCode,
          valid.subjectName || '',
          valid.classDate,
          sRow.student_id,
          valid.status,
          valid.remarks || 'Synced via integration service',
        ]
      );

      if (res.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    } catch (err) {
      errors++;
      errorDetails.push({ row: processed, error: err.message });
    }
  }

  // Record Sync Log in Supabase
  const log = await db.recordSyncLog({
    source: sourceName,
    entityType: 'attendance',
    processed,
    inserted,
    updated,
    errors,
    status: errors === 0 ? 'success' : errors < processed ? 'partial' : 'failed',
    details: { errors: errorDetails.slice(0, 10), totalErrors: errors },
    userId: syncedByUserId,
  });

  return {
    success: errors === 0,
    syncId: log.id,
    processed,
    inserted,
    updated,
    errors,
  };
}

module.exports = {
  validateAttendanceRecord,
  syncAttendanceBatch,
};

