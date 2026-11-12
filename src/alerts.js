/**
 * Module 5: Deduplication & Alert Delivery Engine
 * gueattend - Zero-Spam Deduplication & Session Expiry Management
 */

const db = require('./database/db');

/**
 * Check if an alert was already delivered (Zero-Spam Deduplication)
 * Key Format: userId:subjectCode:date:period:status
 */
async function shouldSendAlert(userId, dedupeKey, alertType = 'attendance_update') {
  const check = await db.query(
    'SELECT id FROM notification_log WHERE user_id = $1 AND dedupe_key = $2',
    [userId, dedupeKey]
  );

  if (check.rows.length > 0) {
    return false; // Already delivered, do not spam
  }

  // Record delivery immediately
  await db.query(
    `INSERT INTO notification_log (user_id, type, dedupe_key, sent_at, metadata)
     VALUES ($1, $2, $3, NOW(), $4)`,
    [userId, alertType, dedupeKey, JSON.stringify({ dedupeKey, alertType })]
  );

  return true;
}

/**
 * Handle session expiry notification cleanly across BIGINT epoch columns and TIMESTAMPTZ columns.
 */
async function recordSessionExpiry(userId, note = 'College session expired.') {
  const nowEpochMs = Date.now();
  await db.query(
    `INSERT INTO session_expiry_state (
       user_id, expired_at, last_alert_at, alert_count, resolved_at,
       note, is_expired, detected_at, expired_at_ts, last_alert_at_ts, resolved_at_ts
     )
     VALUES ($1, $2, $2, 1, NULL, $3, TRUE, NOW(), NOW(), NOW(), NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       last_alert_at = $2,
       last_alert_at_ts = NOW(),
       alert_count = session_expiry_state.alert_count + 1,
       is_expired = TRUE,
       detected_at = NOW(),
       resolved_at = NULL,
       resolved_at_ts = NULL,
       note = $3`,
    [userId, nowEpochMs, note]
  );
}

/**
 * Mark an expired portal session as resolved after successful reconnect.
 */
async function resolveSessionExpiry(userId) {
  const nowEpochMs = Date.now();
  await db.query(
    `UPDATE session_expiry_state
     SET is_expired = FALSE,
         resolved_at = $2,
         resolved_at_ts = NOW()
     WHERE user_id = $1`,
    [userId, nowEpochMs]
  ).catch(() => {});
}

module.exports = {
  shouldSendAlert,
  recordSessionExpiry,
  resolveSessionExpiry,
};
