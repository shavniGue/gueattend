/**
 * Module 6: Telegram Bot Engine
 * gueattend - Bot Daemon, Deep Linking, Auto-Prune & 1-Click Reconnect Button
 */

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database/db');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const POLLING_ENABLED = String(process.env.TELEGRAM_POLLING || '').toLowerCase() === 'on';

let bot = null;

function initTelegram() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token_from_botfather') {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN is not configured. Bot disabled.');
    return null;
  }

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
      polling: POLLING_ENABLED,
    });

    console.log(`[telegram] Bot daemon initialized (polling: ${POLLING_ENABLED}).`);

    if (POLLING_ENABLED) {
      registerBotCommands(bot);
      startPruneWorker(bot);
    }

    return bot;
  } catch (err) {
    console.error('[telegram] Bot initialization error:', err.message);
    return null;
  }
}

/**
 * Schedule automated message deletion to keep student chat clean
 */
async function schedulePrune(chatId, messageId, delaySeconds) {
  if (!bot) return;
  const deleteAt = new Date(Date.now() + delaySeconds * 1000);

  try {
    await db.query(
      'INSERT INTO scheduled_message_deletions (chat_id, message_id, delete_at) VALUES ($1, $2, $3)',
      [String(chatId), String(messageId), deleteAt]
    );
  } catch (err) {}

  setTimeout(() => {
    bot.deleteMessage(chatId, messageId).catch(() => {});
  }, delaySeconds * 1000);
}

/**
 * Sweeper worker: deletes any overdue prune messages on startup
 */
function startPruneWorker(botInstance) {
  setInterval(async () => {
    try {
      const res = await db.query(
        'SELECT id, chat_id, message_id FROM scheduled_message_deletions WHERE delete_at <= NOW() LIMIT 20'
      );
      for (const row of res.rows) {
        await botInstance.deleteMessage(row.chat_id, row.message_id).catch(() => {});
        await db.query('DELETE FROM scheduled_message_deletions WHERE id = $1', [row.id]);
      }
    } catch (err) {}
  }, 30000);
}

function registerBotCommands(botInstance) {
  // 1. /start [code] deep link handler
  botInstance.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match && match[1] ? match[1].trim() : null;

    if (token) {
      await handleLinkAccount(chatId, token, msg.from);
      return;
    }

    const welcome = 
      `🎓 *Welcome to gueattend!*\n` +
      `*Smart Attendance & Timetable Assistant*\n\n` +
      `To connect your student account:\n` +
      `1. Log in to your web dashboard.\n` +
      `2. Click *Telegram* to get your 1-click linking code.\n` +
      `3. Send: \`/login <YOUR_CODE>\` here.\n\n` +
      `*Commands:*\n` +
      `📊 /attendance - Live overall % & subject-wise breakdown\n` +
      `🎯 /bunk - 75% Bunk Margin status\n` +
      `📅 /today - Today's schedule and marked attendance\n` +
      `🗓 /timetable - Complete weekly schedule\n` +
      `🗓 /month - Current month register\n` +
      `🔎 Send any date (e.g. \`14/10/2026\`) for historic breakdown\n` +
      `❓ /help - Command list & support`;

    botInstance.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
  });

  // 2. /login command
  botInstance.onText(/\/login(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match && match[1] ? match[1].trim() : null;

    if (!token) {
      botInstance.sendMessage(
        chatId,
        `⚠️ *Missing Linking Code*\nPlease use: \`/login <CODE>\`\nGenerate code on your web portal.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await handleLinkAccount(chatId, token, msg.from);
  });

  // 3. /attendance command (Auto-prunes after 2 minutes)
  botInstance.onText(/\/attendance/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);

    if (!account || !account.student_id) {
      botInstance.sendMessage(chatId, `🔒 Account not linked. Use \`/login <code>\` first.`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const summary = await db.getAttendanceSummary(account.student_id);

      let text = 
        `📊 *gueattend – Attendance Summary*\n` +
        `👤 *Student:* ${account.full_name}\n` +
        `🆔 *Enrollment:* ${account.enrollment_number || '-'}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *Overall Attendance:* *${summary.overallPercentage}%*\n` +
        `✅ *Present:* ${summary.totalPresent}  |  ❌ *Absent:* ${summary.totalAbsent}  |  ⚪ *Unmarked:* ${summary.totalUnmarked}\n` +
        `💡 *Status:* *${summary.bunkMargin?.message || 'On Track'}*\n\n`;

      for (const s of summary.subjects) {
        const icon = parseFloat(s.percentage) >= 75.0 ? '🟢' : '🔴';
        text += `${icon} *${s.subject_code}* (${s.percentage}%)\n   ${s.subject_name}\n   Attended: ${s.present_classes}/${s.marked_classes}\n   ${s.bunkMargin?.guidance || ''}\n\n`;
      }

      text += `⏱ _This message will auto-delete in 2 minutes._`;

      const sent = await botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      schedulePrune(chatId, sent.message_id, 120); // 2-min auto-prune
    } catch (err) {
      botInstance.sendMessage(chatId, '❌ Could not retrieve attendance.');
    }
  });

  // 4. /bunk command
  botInstance.onText(/\/bunk/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);
    if (!account || !account.student_id) return;

    try {
      const summary = await db.getAttendanceSummary(account.student_id);
      let text = 
        `🎯 *75% Bunk Margin Report*\n` +
        `Overall: *${summary.overallPercentage}%*\n` +
        `Status: *${summary.bunkMargin.guidance}*\n\n` +
        `*Subject Guidance:*\n`;

      summary.subjects.forEach((s) => {
        text += `• *${s.subject_code}* (${s.percentage}%): ${s.guidance}\n`;
      });

      const sent = await botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      schedulePrune(chatId, sent.message_id, 120);
    } catch (err) {}
  });

  // 5. Date Query Command (e.g. "14/10/2026" or "2026-10-14")
  botInstance.onText(/(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/, async (msg, match) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);
    if (!account || !account.student_id) return;

    let rawDate = match[1];
    // Normalize DD/MM/YYYY to YYYY-MM-DD
    let normalizedDate = rawDate;
    if (rawDate.includes('/')) {
      const [d, m, y] = rawDate.split('/');
      normalizedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    try {
      const dayClasses = await db.getTodayAttendance(account.student_id, normalizedDate);
      let text = `🗓 *Date Breakdown: ${normalizedDate}*\n👤 *Student:* ${account.full_name}\n━━━━━━━━━━━━━━━━━━━━\n`;

      if (dayClasses.length === 0) {
        text += `No attendance records marked on this date.`;
      } else {
        dayClasses.forEach((c) => {
          const icon = c.status === 'present' ? '✅' : c.status === 'absent' ? '❌' : '⚪';
          text += `${icon} *${c.period_label || `Period ${c.period_number}`}*: ${c.subject} (${c.status.toUpperCase()})\n`;
        });
      }

      text += `\n⏱ _This lookup will auto-delete in 60s._`;
      const sent = await botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      schedulePrune(chatId, sent.message_id, 60); // 60s auto-prune
    } catch (err) {}
  });
}

async function handleLinkAccount(chatId, token, from) {
  try {
    const userId = await db.verifyAndLinkTelegram(token, chatId, from.username || '', from.first_name || '');
    const user = await db.getUserById(userId);

    const msg = 
      `🎉 *Account Connected Successfully!*\n\n` +
      `Welcome, *${user.full_name}*!\n` +
      `Your gueattend student account is now linked to this Telegram chat.\n\n` +
      `You will receive:\n` +
      `• 08:30 AM Morning Timetables\n` +
      `• Real-time period attendance alerts\n` +
      `• Retroactive attendance modifications`;

    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ *Linking Failed:*\n${err.message}`, { parse_mode: 'Markdown' });
  }
}

/**
 * Send alert to student by userId (used by schedulers)
 */
async function sendTelegramAlert(userId, messageText, options = {}) {
  if (!bot) return;
  try {
    const res = await db.query(
      'SELECT telegram_chat_id FROM telegram_accounts WHERE user_id = $1 AND notifications_enabled = TRUE',
      [userId]
    );
    if (res.rows.length > 0 && res.rows[0].telegram_chat_id) {
      await bot.sendMessage(res.rows[0].telegram_chat_id, messageText, {
        parse_mode: 'Markdown',
        ...options,
      });
    }
  } catch (err) {
    console.error(`[telegram] Failed to send alert to user ${userId}:`, err.message);
  }
}

module.exports = {
  initTelegram,
  sendTelegramAlert,
  getBotInstance: () => bot,
};
