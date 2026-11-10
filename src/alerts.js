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
 * Handle session expiry notification with inline reconnect button
 */
async function recordSessionExpiry(userId, note = 'College session expired.') {
  await db.query(
    `INSERT INTO session_expiry_state (user_id, expired_at, last_alert_at, alert_count, note)
     VALUES ($1, NOW(), NOW(), 1, $2)
     ON CONFLICT (user_id) DO UPDATE SET 
       last_alert_at = NOW(),
       alert_count = session_expiry_state.alert_count + 1,
       note = $2`,
    [userId, note]
  );
}

module.exports = {
  shouldSendAlert,
  recordSessionExpiry,
};
