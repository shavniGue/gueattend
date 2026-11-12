/**
 * Module 6: Unified Telegram Bot Engine
 * gueattend - Bot Daemon, Deep Linking, Auto-Prune, Reconnect CAPTCHA & Admin Controls
 */

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database/db');
const qumsWeb = require('./qums-login-web');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const POLLING_ENABLED = String(process.env.TELEGRAM_POLLING || '').toLowerCase() === 'on';

let bot = null;
let pruneTimer = null;
// Tracks chatIds awaiting human-solved CAPTCHA text after /reconnect
const pendingReconnectChats = new Map();

function sanitizeMarkdown(str) {
  return String(str || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, (m) => `\\${m}`);
}

/**
 * Schedule automated message deletion to keep student chat clean
 */
async function schedulePrune(botInstance, chatId, messageId, delaySeconds) {
  if (!botInstance || !messageId) return;
  const deleteAt = new Date(Date.now() + delaySeconds * 1000);

  try {
    await db.query(
      'INSERT INTO scheduled_message_deletions (chat_id, message_id, delete_at) VALUES ($1, $2, $3)',
      [String(chatId), String(messageId), deleteAt]
    );
  } catch (err) {}

  const t = setTimeout(() => {
    botInstance.deleteMessage(chatId, messageId).catch(() => {});
  }, delaySeconds * 1000);
  if (t.unref) t.unref();
}

function startPruneWorker(botInstance) {
  if (pruneTimer) return;
  pruneTimer = setInterval(async () => {
    try {
      const res = await db.query(
        'SELECT id, chat_id, message_id FROM scheduled_message_deletions WHERE delete_at <= NOW() LIMIT 20'
      );
      for (const row of res.rows) {
        await botInstance.deleteMessage(row.chat_id, row.message_id).catch(() => {});
        await db.query('DELETE FROM scheduled_message_deletions WHERE id = $1', [row.id]).catch(() => {});
      }
    } catch (err) {}
  }, 30000);
  if (pruneTimer.unref) pruneTimer.unref();
}

async function formatAttendanceMessage(account) {
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
  return text;
}

async function formatTodayMessage(account) {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayAtt = await db.getTodayAttendance(account.student_id, todayStr);
  let text = `📅 *Today's Schedule & Attendance (${todayStr})*\n👤 *Student:* ${account.full_name}\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (todayAtt.length === 0) {
    text += `No classes scheduled for today.`;
  } else {
    for (const c of todayAtt) {
      const statusIcon =
        c.status === 'present' ? '✅' : c.status === 'absent' ? '❌' : c.status === 'approved_leave' ? '🔷' : '⚪';
      text += `${statusIcon} *${c.period_label || `Period ${c.period_number}`}* (${String(c.duration || '').slice(0, 13)})\n   📖 ${c.subject} (${c.subject_code})\n   👨‍🏫 ${c.faculty_name}\n   Status: *${String(c.status).toUpperCase()}*\n\n`;
    }
  }
  return text;
}

async function formatAdminSummary() {
  const [kpiRes, notifRes] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE qums_session_status IN ('active', 'connected'))::int AS connected,
        COUNT(*) FILTER (WHERE qums_session_status = 'expired')::int AS expired,
        COUNT(*) FILTER (WHERE COALESCE(telegram_chat_id, '') <> '')::int AS tg_linked,
        COUNT(*) FILTER (WHERE is_suspended = TRUE)::int AS suspended
      FROM users
    `),
    db.query('SELECT COUNT(*)::int AS cnt FROM notification_log'),
  ]);
  const r = kpiRes.rows[0] || {};
  return (
    `🛡️ *gueattend Admin Telemetry*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• Total Users: *${r.total_users || 0}*\n` +
    `• GEU Connected: *${r.connected || 0}*\n` +
    `• Sessions Expired: *${r.expired || 0}*\n` +
    `• Telegram Linked: *${r.tg_linked || 0}*\n` +
    `• Suspended Accounts: *${r.suspended || 0}*\n` +
    `• Notifications Sent: *${notifRes.rows[0]?.cnt || 0}*`
  );
}

async function handleLinkAccount(botInstance, chatId, token, from = {}) {
  try {
    const userId = await db.verifyAndLinkTelegram(token, chatId, from.username || '', from.first_name || '');
    const user = await db.getUserById(userId);
    const msg =
      `🎉 *Account Connected Successfully!*\n\n` +
      `Welcome, *${user?.full_name || 'Student'}*!\n` +
      `Your gueattend account is now linked to this Telegram chat.\n\n` +
      `Available commands:\n` +
      `• /attendance — Overall & subject attendance\n` +
      `• /today — Today's schedule & status\n` +
      `• /timetable — Mon–Sat schedule\n` +
      `• /month — Monthly register\n` +
      `• /assignments — Upcoming deadlines\n` +
      `• /reconnect — Refresh GEU session with CAPTCHA`;
    await botInstance.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await botInstance.sendMessage(chatId, `❌ *Linking Failed:*\n${err.message}`, { parse_mode: 'Markdown' });
  }
}

function buildHelpText() {
  return (
    `❓ *gueattend Bot Commands*\n\n` +
    `• /start — Welcome & deep link\n` +
    `• /login <code> — Link your student account\n` +
    `• /attendance — Live attendance & bunk margin\n` +
    `• /bunk — 75% criteria margin breakdown\n` +
    `• /today — Today's classes & marked periods\n` +
    `• /timetable — Full Mon–Sat weekly schedule\n` +
    `• /month — Current monthly attendance register\n` +
    `• /assignments — Upcoming assignments & deadlines\n` +
    `• /reconnect — Reconnect GEU portal using live CAPTCHA\n` +
    `• /admin — Administrator telemetry (admins only)\n` +
    `• \`DD/MM/YYYY\` or \`YYYY-MM-DD\` — Date attendance lookup\n` +
    `• /help — Show this command list`
  );
}

/**
 * Shared command dispatcher (callable both by live polling listener and deterministic tests)
 */
async function handleBotCommand(botInstance, msg) {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  if (!text) return null;

  // Handle pending CAPTCHA text reply during /reconnect flow
  if (!text.startsWith('/') && pendingReconnectChats.has(String(chatId))) {
    const pendingUserId = pendingReconnectChats.get(String(chatId));
    pendingReconnectChats.delete(String(chatId));
    try {
      const outcome = await qumsWeb.reconnectQumsSession({
        userId: pendingUserId,
        captchaAnswer: text,
        source: 'telegram',
      });
      if (outcome.success || outcome.ok) {
        return botInstance.sendMessage(
          chatId,
          `✅ *GEU Portal Reconnected!*\nGUeID \`${outcome.qid || ''}\` session refreshed via Telegram.`,
          { parse_mode: 'Markdown' }
        );
      }
      return botInstance.sendMessage(chatId, `⚠️ Reconnect failed: ${outcome.error || 'Please run /reconnect again.'}`);
    } catch (err) {
      return botInstance.sendMessage(chatId, `❌ Reconnect error: ${err.message}`);
    }
  }

  // /start [token]
  const startMatch = text.match(/^\/start(?:\s+(.+))?/i);
  if (startMatch) {
    const token = startMatch[1] ? startMatch[1].trim() : null;
    if (token) {
      await handleLinkAccount(botInstance, chatId, token, msg.from);
      return;
    }
    const welcome =
      `🎓 *Welcome to gueattend!*\n` +
      `Connect your account from the web dashboard under *Telegram* using \`/login <CODE>\`.\n\n` +
      buildHelpText();
    return botInstance.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
  }

  // /login <code>
  const loginMatch = text.match(/^\/login(?:\s+(.+))?/i);
  if (loginMatch) {
    const token = loginMatch[1] ? loginMatch[1].trim() : null;
    if (!token) {
      return botInstance.sendMessage(
        chatId,
        `⚠️ *Missing Linking Code*\nPlease send: \`/login <CODE>\``,
        { parse_mode: 'Markdown' }
      );
    }
    return handleLinkAccount(botInstance, chatId, token, msg.from);
  }

  // /help
  if (/^\/help\b/i.test(text)) {
    return botInstance.sendMessage(chatId, buildHelpText(), { parse_mode: 'Markdown' });
  }

  // Commands below require linked Telegram account
  const account = await db.getTelegramAccount(chatId);
  if (!account) {
    return botInstance.sendMessage(
      chatId,
      `🔒 *Account Not Linked*\nOpen your gueattend dashboard to generate a code, then send \`/login <code>\`.`,
      { parse_mode: 'Markdown' }
    );
  }

  // /admin (strict DB admin check)
  if (/^\/admin\b/i.test(text)) {
    const dbUser = await db.getUserById(account.user_id);
    if (!dbUser || dbUser.role !== 'admin' || dbUser.is_admin !== true) {
      await db.recordAuditLog({
        userId: account.user_id,
        action: 'TELEGRAM_ADMIN_DENIED',
        resource: 'telegram:/admin',
        details: { chatId: String(chatId) },
      });
      return botInstance.sendMessage(chatId, '⛔ Access denied. Administrator privileges required.');
    }
    const summary = await formatAdminSummary();
    return botInstance.sendMessage(chatId, summary, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔄 Refresh Admin Metrics', callback_data: 'tg_admin_kpis' }]],
      },
    });
  }

  if (!account.student_id) {
    return botInstance.sendMessage(chatId, 'ℹ️ No student profile linked to this account yet.');
  }

  // /attendance
  if (/^\/attendance\b/i.test(text)) {
    const out = await formatAttendanceMessage(account);
    const sent = await botInstance.sendMessage(chatId, out, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Refresh Attendance', callback_data: 'tg_refresh_attendance' },
            { text: "📅 Today's Classes", callback_data: 'tg_refresh_today' },
          ],
        ],
      },
    });
    if (sent?.message_id) await schedulePrune(botInstance, chatId, sent.message_id, 120);
    return sent;
  }

  // /bunk
  if (/^\/bunk\b/i.test(text)) {
    const summary = await db.getAttendanceSummary(account.student_id);
    let out =
      `🎯 *75% Bunk Margin Report*\n` +
      `Overall: *${summary.overallPercentage}%*\n` +
      `Status: *${summary.bunkMargin?.message || '-'}*\n\n*Subject Guidance:*\n`;
    summary.subjects.forEach((s) => {
      out += `• *${s.subject_code}* (${s.percentage}%): ${s.guidance || s.bunkMargin?.message || '-'}\n`;
    });
    const sent = await botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
    if (sent?.message_id) await schedulePrune(botInstance, chatId, sent.message_id, 120);
    return sent;
  }

  // /today
  if (/^\/today\b/i.test(text)) {
    const out = await formatTodayMessage(account);
    return botInstance.sendMessage(chatId, out, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔄 Refresh Today', callback_data: 'tg_refresh_today' }]],
      },
    });
  }

  // /timetable
  if (/^\/timetable\b/i.test(text)) {
    const weekly = await db.getStudentWeeklyTimetable(account.student_id);
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let out = `🗓 *Weekly Timetable – gueattend*\n👤 *Student:* ${account.full_name}\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (let d = 1; d <= 6; d++) {
      const dayClasses = weekly.filter((w) => w.day_of_week === d);
      if (dayClasses.length > 0) {
        out += `\n*${days[d - 1]}:*\n`;
        for (const c of dayClasses) {
          out += `• ${c.period_label} (${String(c.start_time).slice(0, 5)}): ${c.subject_code} - ${c.classroom || 'CR-301'}\n`;
        }
      }
    }
    return botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }

  // /month
  if (/^\/month\b/i.test(text)) {
    const now = new Date();
    const records = await db.getMonthlyAttendance(account.student_id, now.getMonth() + 1, now.getFullYear());
    const presentCount = records.filter((r) => r.status === 'present').length;
    const absentCount = records.filter((r) => r.status === 'absent').length;
    const marked = presentCount + absentCount;
    const pct = marked > 0 ? ((presentCount / marked) * 100).toFixed(1) : '0.0';
    const monthName = now.toLocaleString('default', { month: 'long' });

    const out =
      `🗓 *Monthly Register – ${monthName} ${now.getFullYear()}*\n` +
      `👤 *Student:* ${account.full_name}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *Month Attendance:* *${pct}%*\n` +
      `✅ *Present:* ${presentCount}  |  ❌ *Absent:* ${absentCount}\n` +
      `📚 *Marked Entries:* ${records.length}`;
    return botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }

  // /assignments
  if (/^\/assignments\b/i.test(text)) {
    const resAsgn = await db.query(
      `SELECT a.title, a.due_date, s.code AS subject_code, s.name AS subject_name
       FROM assignments a
       LEFT JOIN subjects s ON a.subject_id = s.id
       LEFT JOIN students st ON st.id = $1
       WHERE (a.section_id = st.section_id OR a.section_id IS NULL OR a.user_id = st.user_id)
         AND (a.due_date IS NULL OR a.due_date >= NOW() - INTERVAL '1 day')
       ORDER BY a.due_date ASC NULLS LAST
       LIMIT 10`,
      [account.student_id]
    );
    let out = `📚 *Upcoming Assignments*\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (resAsgn.rows.length === 0) {
      out += `No pending assignments found.`;
    } else {
      for (const a of resAsgn.rows) {
        const due = a.due_date ? new Date(a.due_date).toLocaleDateString() : 'TBD';
        out += `• *${a.subject_code || 'COURSE'}* — ${a.title}\n   ⏳ Due: *${due}*\n`;
      }
    }
    return botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }

  // /reconnect (Human-in-the-loop CAPTCHA flow)
  if (/^\/reconnect\b/i.test(text)) {
    const userRow = await db.getUserById(account.user_id);
    if (!userRow || !userRow.qums_password_encrypted) {
      return botInstance.sendMessage(
        chatId,
        '⚠️ No saved GEU portal credentials found. Connect your GUeID once from the web dashboard (/geu-setup).'
      );
    }
    try {
      const challenge = await qumsWeb.startQumsLogin({
        userId: account.user_id,
        qid: userRow.qums_qid || '',
        isReconnect: true,
      });
      if (!challenge || !challenge.success || !challenge.captchaImage) {
        return botInstance.sendMessage(chatId, `⚠️ ${challenge?.error || 'Could not load CAPTCHA from student.geu.ac.in.'}`);
      }
      pendingReconnectChats.set(String(chatId), account.user_id);
      const base64Body = challenge.captchaImage.replace(/^data:image\/[a-z+]+;base64,/, '');
      const buf = Buffer.from(base64Body, 'base64');
      if (typeof botInstance.sendPhoto === 'function') {
        return botInstance.sendPhoto(chatId, buf, {
          caption: '🔐 Reply to this message with the exact CAPTCHA code shown above to reconnect your GEU session.',
        });
      }
      return botInstance.sendMessage(chatId, '🔐 CAPTCHA generated. Reply with the code to complete reconnect.');
    } catch (err) {
      return botInstance.sendMessage(chatId, `❌ Could not initiate reconnect: ${err.message}`);
    }
  }

  // Date Lookup: DD/MM/YYYY or YYYY-MM-DD
  const dateMatch = text.match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})$/);
  if (dateMatch) {
    let rawDate = dateMatch[1];
    let normalizedDate = rawDate;
    if (rawDate.includes('/')) {
      const [d, m, y] = rawDate.split('/');
      normalizedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    } else if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
      const [d, m, y] = rawDate.split('-');
      normalizedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const dayClasses = await db.getTodayAttendance(account.student_id, normalizedDate);
    let out = `🗓 *Date Breakdown: ${normalizedDate}*\n👤 *Student:* ${account.full_name}\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (dayClasses.length === 0) {
      out += `No attendance records marked on this date.`;
    } else {
      dayClasses.forEach((c) => {
        const icon = c.status === 'present' ? '✅' : c.status === 'absent' ? '❌' : '⚪';
        out += `${icon} *${c.period_label || `Period ${c.period_number}`}*: ${c.subject} (${String(c.status).toUpperCase()})\n`;
      });
    }
    out += `\n⏱ _Auto-deletes in 60s._`;
    const sent = await botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
    if (sent?.message_id) await schedulePrune(botInstance, chatId, sent.message_id, 60);
    return sent;
  }

  return null;
}

/**
 * Shared inline keyboard callback query handler
 */
async function handleCallbackQuery(botInstance, query) {
  const callbackId = query.id;
  const chatId = query.message?.chat?.id;
  const data = String(query.data || '').trim();

  if (typeof botInstance.answerCallbackQuery === 'function') {
    await botInstance.answerCallbackQuery(callbackId).catch(() => {});
  }
  if (!chatId) return null;

  const account = await db.getTelegramAccount(chatId);
  if (!account) {
    return botInstance.sendMessage(chatId, '🔒 Account not linked. Use `/login <code>` first.', { parse_mode: 'Markdown' });
  }

  if (data === 'tg_refresh_attendance' && account.student_id) {
    const out = await formatAttendanceMessage(account);
    return botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }
  if (data === 'tg_refresh_today' && account.student_id) {
    const out = await formatTodayMessage(account);
    return botInstance.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }
  if (data === 'tg_start_reconnect') {
    return handleBotCommand(botInstance, { chat: { id: chatId }, text: '/reconnect', from: query.from });
  }
  if (data === 'tg_admin_kpis') {
    const dbUser = await db.getUserById(account.user_id);
    if (!dbUser || dbUser.role !== 'admin' || dbUser.is_admin !== true) {
      return botInstance.sendMessage(chatId, '⛔ Access denied.');
    }
    const summary = await formatAdminSummary();
    return botInstance.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
  }

  return null;
}

function registerBotCommands(botInstance) {
  botInstance.on('message', (msg) => {
    if (msg && msg.text) {
      handleBotCommand(botInstance, msg).catch((err) => {
        console.error('[telegram] Command error:', err.message);
      });
    }
  });

  botInstance.on('callback_query', (query) => {
    handleCallbackQuery(botInstance, query).catch((err) => {
      console.error('[telegram] Callback error:', err.message);
    });
  });

  botInstance.on('polling_error', (err) => {
    const msg = err?.message || '';
    if (msg.includes('409 Conflict')) {
      console.warn('[telegram] Another bot instance is polling (409 Conflict). Stopping duplicate poller.');
      botInstance.stopPolling().catch(() => {});
    } else {
      console.warn('[telegram] Polling warning:', msg);
    }
  });
}

function initTelegram() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token_from_botfather') {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN is not configured. Bot disabled.');
    return null;
  }

  if (bot) return bot;

  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
      polling: POLLING_ENABLED,
    });

    console.log(`[telegram] Unified bot initialized (polling: ${POLLING_ENABLED}).`);

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

async function sendTelegramAlert(userId, messageText, options = {}) {
  if (!bot) return false;
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
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[telegram] Failed to send alert to user ${userId}:`, err.message);
    return false;
  }
}

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
  initTelegram,
  initTelegramBot: initTelegram,
  sendTelegramAlert,
  sendTelegramMessage,
  handleBotCommand,
  handleCallbackQuery,
  registerBotCommands,
  sanitizeMarkdown,
  getBotInstance: () => bot,
};
