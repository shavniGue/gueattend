/**
 * Module 5: Live Period Watcher & Backdated Month Register Loop
 * gueattend - 5-min Live Period Watcher & 10-min Backdated Register Scanner
 */

const scraper = require('./scraper');
const alerts = require('./alerts');
const db = require('./database/db');

/**
 * 5-Minute Live Period Watcher
 * Runs during college hours (08:30–17:00 IST)
 */
async function watchLivePeriodAttendance(userId, sendTelegramFn) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayClasses = await scraper.scrapeTodayClasses(userId, todayStr);

    for (const period of todayClasses) {
      if (period.status === 'present' || period.status === 'absent') {
        const dedupeKey = `${userId}:${period.subject_code}:${todayStr}:${period.period_number}:${period.status}`;
        const canSend = await alerts.shouldSendAlert(userId, dedupeKey, 'live_period_marked');

        if (canSend && sendTelegramFn) {
          const icon = period.status === 'present' ? '✅' : '❌';
          const msg = 
            `🔔 *Attendance Update: ${period.period_label || `Period ${period.period_number}`}*\n` +
            `*Subject:* ${period.subject} (${period.subject_code})\n` +
            `*Status:* ${icon} *${period.status.toUpperCase()}*\n` +
            `👨‍🏫 *Faculty:* ${period.faculty_name}\n` +
            `📅 *Date:* ${todayStr}\n\n` +
            `_Check your /attendance on gueattend for updated bunk margin._`;
          await sendTelegramFn(userId, msg);
        }
      }
    }
  } catch (err) {
    // Non-blocking
  }
}

/**
 * 10-Minute Month Register Scan (Backdated Modifications)
 */
async function scanMonthRegisterForBackdated(userId, sendTelegramFn) {
  try {
    const records = await scraper.scrapeMonthRegister(userId);
    const todayStr = new Date().toISOString().split('T')[0];

    // Look for records marked for earlier dates
    for (const r of records) {
      const d = r.class_date instanceof Date ? r.class_date.toISOString().split('T')[0] : String(r.class_date).slice(0, 10);
      if (d < todayStr && (r.status === 'present' || r.status === 'absent')) {
        const dedupeKey = `${userId}:backdated:${r.subject_code}:${d}:${r.period_number}:${r.status}`;
        const canSend = await alerts.shouldSendAlert(userId, dedupeKey, 'backdated_attendance_marked');

        if (canSend && sendTelegramFn) {
          const icon = r.status === 'present' ? '✅' : '❌';
          const msg = 
            `⚠️ *Retroactive Attendance Update*\n` +
            `A teacher just marked or revised attendance for an earlier date:\n` +
            `*Class Date:* 🗓️ *${d}*\n` +
            `*Subject:* ${r.subject_name} (${r.subject_code})\n` +
            `*Status:* ${icon} *${r.status.toUpperCase()}*`;
          await sendTelegramFn(userId, msg);
        }
      }
    }
  } catch (err) {}
}

module.exports = {
  watchLivePeriodAttendance,
  scanMonthRegisterForBackdated,
};
