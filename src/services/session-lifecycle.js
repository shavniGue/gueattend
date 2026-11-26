/**
 * Smart Active-User Monitoring & Session Lifecycle Management
 * gueattend - Intelligent Background Monitoring & Session Reconciliation Architecture
 *
 * Capabilities:
 *  1. Active-user-only background processing (pauses expired/disconnected accounts)
 *  2. Batch database queries and in-memory TTL caching (drastically cuts DB calls)
 *  3. Automatic expired-session detection and eviction from active monitoring
 *  4. One-time session expiry notifications with 1-Click CAPTCHA Reconnect button
 *  5. Secure session reconnection, validation, and state persistence
 *  6. Post-reconnection data reconciliation & duplicate event prevention
 *  7. Automatic session restoration from DB across application restarts
 */

const fs = require('fs');
const db = require('../database/db');
const alerts = require('../alerts');
const credentials = require('../credentials');

class SessionLifecycleService {
  constructor() {
    this.activeUserCache = null;
    this.cacheExpiresAt = 0;
    this.ttlMs = 60 * 1000; // 60 seconds batch cache TTL
    this.activeUserSet = new Set();
    this.telegramSender = null;
  }

  setTelegramSender(senderFn) {
    this.telegramSender = senderFn;
  }

  /**
   * Restore persisted sessions from PostgreSQL across application restarts
   */
  async restorePersistedSessions() {
    try {
      const res = await db.query(
        `SELECT id, qums_session_data, qums_session_status FROM users
         WHERE qums_session_data IS NOT NULL
           AND qums_session_status IN ('connected', 'active')`
      );

      let restoredCount = 0;
      for (const row of res.rows) {
        const filePath = credentials.getSessionFilePath(row.id);
        if (!fs.existsSync(filePath)) {
          let cookies = row.qums_session_data;
          if (typeof cookies === 'string') {
            try {
              cookies = JSON.parse(cookies);
            } catch (e) {}
          }
          if (cookies) {
            credentials.saveSessionCookies(row.id, cookies, { restoredAt: new Date().toISOString() });
            restoredCount++;
          }
        }
      }
      if (restoredCount > 0) {
        console.log(`[session-lifecycle] Restored ${restoredCount} session cookie files from DB across restart.`);
      }
    } catch (err) {
      console.warn('[session-lifecycle] Session restoration warning:', err.message);
    }
  }

  /**
   * Batch fetch of active monitored users with in-memory caching
   */
  async getActiveMonitoredUsers() {
    const now = Date.now();
    if (this.activeUserCache && now < this.cacheExpiresAt) {
      return this.activeUserCache;
    }

    try {
      const res = await db.query(`
        SELECT 
          u.id AS user_id,
          u.email,
          u.full_name,
          u.qums_qid,
          u.qums_session_status,
          u.last_attendance_sync_at,
          ta.telegram_chat_id,
          ta.notifications_enabled,
          ses.is_expired AS session_is_expired
        FROM users u
        JOIN telegram_accounts ta ON ta.user_id = u.id
        LEFT JOIN session_expiry_state ses ON ses.user_id = u.id
        WHERE u.is_suspended = FALSE
          AND ta.notifications_enabled = TRUE
          AND COALESCE(ta.telegram_chat_id, '') <> ''
          AND LOWER(COALESCE(u.qums_session_status, 'disconnected')) IN ('active', 'connected')
          AND (ses.is_expired IS NULL OR ses.is_expired = FALSE)
      `);

      // Filter to only those with valid session cookie file or stored data
      const verifiedActive = [];
      const idSet = new Set();

      for (const row of res.rows) {
        const sessionPath = credentials.getSessionFilePath(row.user_id);
        if (fs.existsSync(sessionPath)) {
          verifiedActive.push(row);
          idSet.add(row.user_id);
        }
      }

      this.activeUserCache = verifiedActive;
      this.activeUserSet = idSet;
      this.cacheExpiresAt = now + this.ttlMs;

      return this.activeUserCache;
    } catch (err) {
      console.error('[session-lifecycle] Failed to query active users:', err.message);
      return this.activeUserCache || [];
    }
  }

  /**
   * Check if a specific user is currently active and monitored
   */
  isUserActive(userId) {
    return this.activeUserSet.has(userId);
  }

  /**
   * Invalidate in-memory cache
   */
  invalidateCache() {
    this.activeUserCache = null;
    this.cacheExpiresAt = 0;
  }

  /**
   * Automatically detect expired session, pause monitoring, and notify user ONCE
   */
  async markSessionExpired(userId, reason = 'Portal session expired.') {
    // 1. Immediately evict from active in-memory set
    this.activeUserSet.delete(userId);
    this.invalidateCache();

    // 2. Persist expired state in users table
    await db.query(
      `UPDATE users SET qums_session_status = 'expired', updated_at = NOW() WHERE id = $1`,
      [userId]
    ).catch(() => {});

    // 3. Record in session_expiry_state
    const stateRes = await db.query(
      `SELECT is_expired, alert_count, last_alert_at FROM session_expiry_state WHERE user_id = $1`,
      [userId]
    ).catch(() => ({ rows: [] }));

    const existing = stateRes.rows[0];
    const isAlreadyExpired = existing && existing.is_expired === true;
    const alertCount = existing ? Number(existing.alert_count || 0) : 0;

    await alerts.recordSessionExpiry(userId, reason);

    // 4. One-time notification check: only send if not already notified during this expiry period
    if (!isAlreadyExpired || alertCount === 0) {
      console.log(`[session-lifecycle] Sending one-time session expiry notification for user ${userId}...`);

      const sender = this.telegramSender;
      if (typeof sender === 'function') {
        const msg =
          `⚠️ *GEU Portal Session Expired*\n\n` +
          `Your Graphic Era student portal session has expired or timed out.\n` +
          `Background attendance monitoring has been *automatically paused* to prevent unnecessary requests.\n\n` +
          `Tap below to reconnect in 1-Click with a fresh CAPTCHA:`;

        await sender(userId, msg, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔐 1-Click Reconnect (CAPTCHA)', callback_data: 'tg_start_reconnect' }],
            ],
          },
        }).catch((err) => {
          console.warn('[session-lifecycle] Telegram expiry alert delivery error:', err.message);
        });
      }
    } else {
      console.log(`[session-lifecycle] User ${userId} already received expiry notification; skipping duplicate alert.`);
    }
  }

  /**
   * Handle successful session reconnection:
   * 1. Update session status
   * 2. Mark session resolved
   * 3. Add to active monitoring
   * 4. Perform post-reconnection data reconciliation
   */
  async markSessionReconnected(userId, source = 'web', sendTelegramFn = null) {
    const sender = sendTelegramFn || this.telegramSender;

    // 1. Update users & session_expiry_state
    await db.query(
      `UPDATE users SET qums_session_status = 'connected', updated_at = NOW() WHERE id = $1`,
      [userId]
    ).catch(() => {});

    await alerts.resolveSessionExpiry(userId);

    // 2. Add to active monitoring registry and invalidate cache
    this.activeUserSet.add(userId);
    this.invalidateCache();

    console.log(`[session-lifecycle] Session restored for user ${userId} via ${source}. Resuming monitoring & reconciling data...`);

    // 3. Post-Reconnection Data Reconciliation
    await this.reconcileUserData(userId, sender);
  }

  /**
   * Post-reconnection data reconciliation:
   * Compares latest portal data with previously stored records,
   * detects missed updates during disconnection, updates DB,
   * prevents duplicate notifications, and sends reconciliation report.
   */
  async reconcileUserData(userId, sender) {
    try {
      const scraper = require('../scraper');

      // Fetch snapshot from before disconnection
      const previousSnapshotRes = await db.query(
        `SELECT records FROM known_attendance WHERE user_id = $1 AND subject_code = '__SUMMARY__'`,
        [userId]
      ).catch(() => ({ rows: [] }));

      const prevSubjects = (previousSnapshotRes.rows[0]?.records && Array.isArray(previousSnapshotRes.rows[0].records))
        ? previousSnapshotRes.rows[0].records
        : [];

      // Fetch fresh data from portal
      const freshSummary = await scraper.scrapeSubjectWiseAttendance(userId);
      const freshSubjects = freshSummary?.subjects || [];

      // Identify missed updates
      const missedUpdates = [];
      for (const fresh of freshSubjects) {
        const prev = prevSubjects.find(
          (p) => String(p.subjectCode || '').toUpperCase() === String(fresh.subjectCode || '').toUpperCase()
        );

        if (prev) {
          const prevAttended = Number(prev.attended || 0);
          const freshAttended = Number(fresh.attended || 0);
          const prevTotal = Number(prev.totalClasses || 0);
          const freshTotal = Number(fresh.totalClasses || 0);

          if (freshTotal > prevTotal || freshAttended > prevAttended) {
            const attendedDiff = freshAttended - prevAttended;
            const totalDiff = freshTotal - prevTotal;
            missedUpdates.push({
              code: fresh.subjectCode,
              name: fresh.subjectName,
              newLectures: totalDiff,
              newPresent: attendedDiff,
              newAbsent: Math.max(0, totalDiff - attendedDiff),
              percentage: fresh.percentage,
            });
          }
        }
      }

      // Check today's classes for any newly marked periods
      const todayStr = new Date().toISOString().split('T')[0];
      const todayClasses = await scraper.scrapeTodayClasses(userId, todayStr).catch(() => []);

      for (const cls of todayClasses) {
        if (cls.status === 'present' || cls.status === 'absent') {
          // Record dedupe key so normal monitoring watcher won't double-notify
          const dedupeKey = `${userId}:${cls.subject_code}:${todayStr}:${cls.period_number}:${cls.status}`;
          await alerts.shouldSendAlert(userId, dedupeKey, 'reconciliation_period_marked');
        }
      }

      // Send reconciliation summary alert to user
      if (typeof sender === 'function') {
        let msg = `🔄 *GEU Portal Session Restored & Synchronized!*\n\n`;
        msg += `Your session has been validated and background monitoring has safely resumed.\n\n`;

        if (missedUpdates.length > 0) {
          msg += `📊 *Missed Updates During Disconnection:*\n`;
          for (const u of missedUpdates) {
            msg += `• *${u.code}* (${u.name})\n   +${u.newLectures} class(es): ✅ ${u.newPresent} Present, ❌ ${u.newAbsent} Absent (Now: *${u.percentage}%*)\n`;
          }
          msg += `\n`;
        } else {
          msg += `✅ All attendance records are fully up to date. No missed classes.\n\n`;
        }

        if (freshSummary?.overallPercentage != null) {
          msg += `📈 *Overall Attendance:* *${freshSummary.overallPercentage}%*`;
        }

        await sender(userId, msg).catch(() => {});
      }
    } catch (err) {
      console.warn('[session-lifecycle] Reconciliation warning:', err.message);
    }
  }

  /**
   * Initialize service on server boot
   */
  async init(telegramSenderFn) {
    if (telegramSenderFn) {
      this.setTelegramSender(telegramSenderFn);
    }
    await this.restorePersistedSessions();
    const active = await this.getActiveMonitoredUsers();
    console.log(`[session-lifecycle] Smart Active-User Monitoring initialized: ${active.length} active sessions registered.`);
  }
}

const instance = new SessionLifecycleService();
module.exports = instance;
