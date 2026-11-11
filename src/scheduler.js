/**
 * Module 5: Autonomous Background Schedulers
 * gueattend - 5 Dedicated Cron Loops for Routine Automation
 */

const cron = require('node-cron');
const db = require('./database/db');
const scraper = require('./scraper');
const watcher = require('./watcher');
const assignments = require('./assignments');

let scheduledJobs = [];

/**
 * Initialize all 5 autonomous background schedulers
 */
function initAutonomousSchedulers(telegramSenderFn) {
  // 1. Morning Timetable: Every Monday - Saturday at 08:30 AM IST (03:00 UTC)
  const morningJob = cron.schedule('30 3 * * 1-6', async () => {
    console.log('[scheduler] Executing 08:30 AM Morning Timetable Routine...');
    try {
      const users = await db.query('SELECT DISTINCT user_id FROM telegram_accounts WHERE notifications_enabled = TRUE');
      const todayStr = new Date().toISOString().split('T')[0];

      for (const row of users.rows) {
        const todayClasses = await scraper.scrapeTodayClasses(row.user_id, todayStr);
        if (todayClasses.length > 0 && telegramSenderFn) {
          let text = `🌅 *Good Morning! Here is your timetable for today (${todayStr}):*\n\n`;
          todayClasses.forEach((c) => {
            text += `• *${c.period_label || `Period ${c.period_number}`}* (${c.start_time.slice(0, 5)} - ${c.end_time.slice(0, 5)})\n  ${c.subject} (${c.subject_code})\n  Room: *${c.classroom || 'CR-301'}* • ${c.faculty_name}\n\n`;
          });
          text += `_Have an excellent learning day!_ 🚀`;
          await telegramSenderFn(row.user_id, text);
        }
      }
    } catch (err) {
      console.error('[scheduler] Morning job error:', err.message);
    }
  });

  // 2. Live Period Watcher: Every 5 minutes during college hours (08:30–17:00 IST / 03:00–11:30 UTC)
  const watcherJob = cron.schedule('*/5 3-11 * * 1-6', async () => {
    try {
      const users = await db.query('SELECT DISTINCT user_id FROM telegram_accounts WHERE notifications_enabled = TRUE');
      for (const row of users.rows) {
        await watcher.watchLivePeriodAttendance(row.user_id, telegramSenderFn);
      }
    } catch (err) {}
  });

  // 3. Month Register Scan: Every 10 minutes (Backdated changes)
  const monthScanJob = cron.schedule('*/10 * * * *', async () => {
    try {
      const users = await db.query('SELECT DISTINCT user_id FROM telegram_accounts WHERE notifications_enabled = TRUE');
      for (const row of users.rows) {
        await watcher.scanMonthRegisterForBackdated(row.user_id, telegramSenderFn);
      }
    } catch (err) {}
  });

  // 4. Assignment Discovery: Every 30 minutes
  const assignmentJob = cron.schedule('*/30 * * * *', async () => {
    try {
      const users = await db.query('SELECT DISTINCT user_id FROM telegram_accounts WHERE notifications_enabled = TRUE');
      for (const row of users.rows) {
        await assignments.scanAssignmentsForUser(row.user_id, telegramSenderFn);
      }
    } catch (err) {}
  });

  // 5. Deadline Warning: 7:00 PM IST (13:30 UTC) daily
  const deadlineJob = cron.schedule('30 13 * * *', async () => {
    try {
      const users = await db.query('SELECT DISTINCT user_id FROM telegram_accounts WHERE notifications_enabled = TRUE');
      for (const row of users.rows) {
        await assignments.sendUrgentDeadlineAlerts(row.user_id, telegramSenderFn);
      }
    } catch (err) {}
  });

  scheduledJobs = [morningJob, watcherJob, monthScanJob, assignmentJob, deadlineJob];
  console.log('[scheduler] 5 Autonomous Background Schedulers active.');
}

module.exports = {
  initAutonomousSchedulers,
};

