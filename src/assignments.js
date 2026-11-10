/**
 * Module 5: Coursework Discovery & Deadline Schedulers
 * gueattend - 30-min Assignment Scanner & 7:00 PM Urgent Warning
 */

const scraper = require('./scraper');
const alerts = require('./alerts');
const db = require('./database/db');

/**
 * 30-Minute Assignment Discovery Scanner
 */
async function scanAssignmentsForUser(userId, sendTelegramFn) {
  try {
    const list = await scraper.scrapeAssignments(userId);
    for (const item of list) {
      const dedupeKey = `${userId}:assignment:${item.id}`;
      const canSend = await alerts.shouldSendAlert(userId, dedupeKey, 'assignment_new');
      if (canSend && sendTelegramFn) {
        const msg = 
          `📚 *New Assignment Discovered!*\n` +
          `*Subject:* ${item.subjectName} (${item.subjectCode})\n` +
          `*Topic:* ${item.title}\n` +
          `⏳ *Due Date:* ${new Date(item.dueDate).toLocaleDateString()}\n\n` +
          `_Check your coursework portal to view instructions._`;
        await sendTelegramFn(userId, msg);
      }
    }
  } catch (err) {
    // Non-blocking
  }
}

/**
 * 7:00 PM IST Urgent Deadline Reminder
 */
async function sendUrgentDeadlineAlerts(userId, sendTelegramFn) {
  try {
    const list = await scraper.scrapeAssignments(userId);
    const dueTonight = list.filter((a) => a.isDueTonight);

    for (const item of dueTonight) {
      const dedupeKey = `${userId}:deadline_tonight:${item.id}:${new Date().toISOString().split('T')[0]}`;
      const canSend = await alerts.shouldSendAlert(userId, dedupeKey, 'assignment_due_tonight');
      if (canSend && sendTelegramFn) {
        const msg = 
          `🚨 *URGENT DEADLINE WARNING*\n` +
          `*Assignment Due Tonight!*\n` +
          `*Subject:* ${item.subjectName} (${item.subjectCode})\n` +
          `*Topic:* ${item.title}\n\n` +
          `⚠️ _Submit before 11:59 PM to avoid penalty._`;
        await sendTelegramFn(userId, msg);
      }
    }
  } catch (err) {}
}

module.exports = {
  scanAssignmentsForUser,
  sendUrgentDeadlineAlerts,
};
