/**
 * Telegram Bot Integration Service
 * gueattend - Smart Attendance & Timetable System
 *
 * Bot Name: GUE Attendance Bot
 * Username: @gue_attendance_bot
 */

const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const POLLING_ENABLED = String(process.env.TELEGRAM_POLLING || '').toLowerCase() === 'on';

let bot = null;

function initTelegramBot() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token_from_botfather') {
    console.warn('[telegram-bot] TELEGRAM_BOT_TOKEN is not configured. Bot service disabled.');
    return null;
  }

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
      polling: POLLING_ENABLED,
    });

    console.log(`[telegram-bot] Bot service initialized (polling: ${POLLING_ENABLED}).`);

    // Setup command listeners if polling is active
    if (POLLING_ENABLED) {
      registerBotCommands(bot);
    }

    return bot;
  } catch (err) {
    console.error('[telegram-bot] Error initializing Telegram bot:', err.message);
    return null;
  }
}

function registerBotCommands(botInstance) {
  // 1. /start command
  botInstance.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match && match[1] ? match[1].trim() : null;

    if (token) {
      // Direct deep-link login: /start <token>
      await handleLinkAccount(chatId, token, msg.from);
      return;
    }

    const welcome = 
      `🎓 *Welcome to gueattend Bot!*\n` +
      `*Smart Attendance & Timetable Assistant for Graphic Era University*\n\n` +
      `To connect your student account:\n` +
      `1. Log into your gueattend web portal.\n` +
      `2. Go to *Telegram & Alerts* and generate a linking code.\n` +
      `3. Send the command: \`/login <YOUR_CODE>\` here.\n\n` +
      `*Available Commands:*\n` +
      `📊 /attendance - View your overall & subject-wise attendance\n` +
      `🎯 /bunk - 75% Criteria status & Safe bunk margin\n` +
      `📅 /today - View today's classes & marked attendance\n` +
      `🗓 /timetable - View your complete weekly schedule\n` +
      `🗓 /month - View your current monthly attendance\n` +
      `❓ /help - View assistance & command list`;

    botInstance.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
  });

  // 2. /login command
  botInstance.onText(/\/login(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match && match[1] ? match[1].trim() : null;

    if (!token) {
      botInstance.sendMessage(
        chatId,
        `⚠️ *Missing Linking Code*\nPlease use: \`/login <CODE>\`\n\nGenerate your code at *gueattend Portal → Telegram & Alerts*.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await handleLinkAccount(chatId, token, msg.from);
  });

  // 3. /attendance command
  botInstance.onText(/\/attendance/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);

    if (!account || !account.student_id) {
      botInstance.sendMessage(
        chatId,
        `🔒 *Account Not Linked*\nPlease connect your gueattend account first using \`/login <code>\`.\nOpen your dashboard to obtain your linking code.`,
        { parse_mode: 'Markdown' }
      );
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
        `🎯 *Status:* *${summary.bunkMargin?.message || 'On Track'}*\n\n`;

      if (summary.shortageAlert) {
        text += `⚠️ *ATTENDANCE SHORTAGE ALERT*\nYour overall attendance is below 75%!\n\n`;
      }

      text += `*Subject-wise Breakdown:*\n`;
      for (const s of summary.subjects) {
        const icon = parseFloat(s.percentage) >= 75.0 ? '🟢' : '🔴';
        text += `${icon} *${s.subject_code}* (${s.percentage}%)\n   ${s.subject_name}\n   Present: ${s.present_classes}/${s.marked_classes} | ${s.bunkMargin?.message || ''}\n\n`;
      }

      botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[telegram] /attendance error:', err.message);
      botInstance.sendMessage(chatId, '❌ Could not retrieve attendance. Please try again later.');
    }
  });

  // 4. /bunk command (Signature QAttend feature)
  botInstance.onText(/\/bunk/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);

    if (!account || !account.student_id) {
      botInstance.sendMessage(chatId, `🔒 Account not linked. Use \`/login <code>\` first.`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const summary = await db.getAttendanceSummary(account.student_id);

      let text = 
        `🎯 *75% Attendance & Bunk Margin (gueattend)*\n` +
        `👤 *Student:* ${account.full_name}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *Overall Attendance:* *${summary.overallPercentage}%*\n` +
        `💡 *Status:* *${summary.bunkMargin?.message}*\n\n` +
        `*Subject Details:*\n`;

      for (const s of summary.subjects) {
        const icon = parseFloat(s.percentage) >= 75.0 ? '✅' : '⚠️';
        text += `${icon} *${s.subject_code}* (${s.percentage}%): ${s.bunkMargin?.message}\n`;
      }

      botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[telegram] /bunk error:', err.message);
      botInstance.sendMessage(chatId, '❌ Could not compute bunk margin.');
    }
  });

  // 4. /today command
  botInstance.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);

    if (!account || !account.student_id) {
      botInstance.sendMessage(chatId, `🔒 Account not linked. Use \`/login <code>\` first.`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayAtt = await db.getTodayAttendance(account.student_id, todayStr);

      let text = `📅 *Today's Schedule & Attendance (${todayStr})*\n👤 *Student:* ${account.full_name}\n━━━━━━━━━━━━━━━━━━━━\n`;

      if (todayAtt.length === 0) {
        text += `No classes scheduled for today. Have a productive day! 🌟`;
      } else {
        for (const c of todayAtt) {
          const statusIcon = c.status === 'present' ? '✅' : c.status === 'absent' ? '❌' : c.status === 'approved_leave' ? '🔷' : '⚪';
          text += `${statusIcon} *${c.period_label}* (${c.duration})\n   📖 ${c.subject} (${c.subject_code})\n   👨‍🏫 ${c.faculty_name}\n   Status: *${c.status.toUpperCase()}*\n\n`;
        }
      }

      botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[telegram] /today error:', err.message);
      botInstance.sendMessage(chatId, '❌ Could not retrieve today timetable.');
    }
  });

  // 5. /timetable command
  botInstance.onText(/\/timetable/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);

    if (!account || !account.student_id) {
      botInstance.sendMessage(chatId, `🔒 Account not linked. Use \`/login <code>\` first.`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const weekly = await db.getStudentWeeklyTimetable(account.student_id);
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      let text = `🗓 *Weekly Timetable – gueattend*\n👤 *Student:* ${account.full_name}\nSection: ${account.section_name || 'G4'}\n━━━━━━━━━━━━━━━━━━━━\n`;

      for (let d = 1; d <= 6; d++) {
        const dayClasses = weekly.filter((w) => w.day_of_week === d);
        if (dayClasses.length > 0) {
          text += `\n*${days[d - 1]}:*\n`;
          for (const c of dayClasses) {
            text += `• ${c.period_label} (${c.start_time.slice(0, 5)}): ${c.subject_code} - ${c.classroom || 'CR-301'}\n`;
          }
        }
      }

      botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[telegram] /timetable error:', err.message);
      botInstance.sendMessage(chatId, '❌ Could not retrieve weekly timetable.');
    }
  });

  // 6. /month command
  botInstance.onText(/\/month/, async (msg) => {
    const chatId = msg.chat.id;
    const account = await db.getTelegramAccount(chatId);

    if (!account || !account.student_id) {
      botInstance.sendMessage(chatId, `🔒 Account not linked. Use \`/login <code>\` first.`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const now = new Date();
      const records = await db.getMonthlyAttendance(account.student_id, now.getMonth() + 1, now.getFullYear());

      const presentCount = records.filter((r) => r.status === 'present').length;
      const absentCount = records.filter((r) => r.status === 'absent').length;
      const totalMarked = presentCount + absentCount;
      const pct = totalMarked > 0 ? ((presentCount / totalMarked) * 100).toFixed(1) : '0.0';

      const monthName = now.toLocaleString('default', { month: 'long' });

      const text = 
        `🗓 *Monthly Attendance Register – ${monthName} ${now.getFullYear()}*\n` +
        `👤 *Student:* ${account.full_name}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Month Attendance:* *${pct}%*\n` +
        `✅ *Present:* ${presentCount} classes\n` +
        `❌ *Absent:* ${absentCount} classes\n` +
        `📚 *Total Conducted:* ${records.length} periods\n\n` +
        `_Log into the gueattend web portal to view full calendar & subject-wise details._`;

      botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[telegram] /month error:', err.message);
      botInstance.sendMessage(chatId, '❌ Could not retrieve monthly attendance.');
    }
  });

  // 7. /help command
  botInstance.onText(/\/help/, (msg) => {
    const text = 
      `❓ *gueattend Bot Help & Guide*\n\n` +
      `Commands:\n` +
      `• /attendance - Check overall % and subject-wise breakdown\n` +
      `• /bunk - 75% Criteria status & Safe bunk margin\n` +
      `• /today - Today's timetable and marked attendance\n` +
      `• /timetable - Weekly classes schedule\n` +
      `• /month - View current monthly register summary\n` +
      `• /login <code> - Connect your gueattend account\n\n` +
      `*Support:* Contact your department ERP administrator.`;
    botInstance.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
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
      `You can now use:\n` +
      `• /attendance to check your live attendance\n` +
      `• /bunk to check your 75% bunk margin\n` +
      `• /today to check today's classes\n` +
      `• /timetable for your weekly timetable`;

    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(
      chatId,
      `❌ *Linking Failed*\n${err.message}\n\nPlease generate a fresh code in your web portal and try again.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Send an outbound message to a specific Telegram chat ID
 */
async function sendTelegramMessage(chatId, text, options = {}) {
  if (!bot) return false;
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
    return true;
  } catch (err) {
    console.error(`[telegram] Failed to send message to ${chatId}:`, err.message);
    return false;
  }
}

module.exports = {
  initTelegramBot,
  sendTelegramMessage,
};

