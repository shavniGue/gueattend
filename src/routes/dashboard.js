/**
 * Student Dashboard Aggregator API Route
 * gueattend - Smart Attendance & Timetable System
 *
 * Implements the core QAttend Dashboard widgets:
 *   1. Classes Today & Timetable
 *   2. Right Now (active period card with live time progress)
 *   3. Up Next (next scheduled lecture)
 *   4. Class Substitutions
 *   5. Today's Attendance Table (Period, Status)
 *   6. Overall Attendance & 75% Bunk Margin Calculator
 *   7. Subject-wise Attendance Breakdown
 *   8. Month Register (Calendar attendance)
 *   9. Notifications Feed
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

router.get('/student', requireAuth, async (req, res) => {
  try {
    const userRow = await db.getUserById(req.session.userId);
    let student = await db.getStudentByUserId(req.session.userId);
    if (!student && userRow) {
      await db.ensureStudentProfile(userRow.id, userRow.email).catch(() => null);
      student = await db.getStudentByUserId(req.session.userId);
    }

    const rawPortalState = String(
      userRow?.qums_session_status || userRow?.new_erp_session_status || 'disconnected'
    ).toLowerCase();
    const isPortalConnected = rawPortalState === 'active' || rawPortalState === 'connected';
    const isPortalExpired = rawPortalState === 'expired';
    const portalLabel = isPortalConnected
      ? 'Connected ✅'
      : isPortalExpired
        ? 'Expired ⚠️'
        : 'Not Connected';

    if (!student) {
      const tgRes = await db.query(
        'SELECT telegram_chat_id AS chat_id, telegram_username AS username FROM telegram_accounts WHERE user_id = $1',
        [req.session.userId]
      );
      const isTgConnected = Boolean(tgRes.rows.length > 0 && tgRes.rows[0].chat_id);
      return res.json({
        success: true,
        currentDate: req.query.date || new Date().toISOString().split('T')[0],
        periodDisplay: '-',
        academicSession: '-',
        qumsStatus: {
          connected: isPortalConnected,
          status: rawPortalState,
          label: portalLabel,
          lastSynced: userRow?.last_attendance_sync_at || null,
        },
        telegramStatus: {
          connected: isTgConnected,
          username: tgRes.rows[0]?.username || null,
          chatId: tgRes.rows[0]?.chat_id || null,
        },
        student: {
          userId: req.session.userId,
          name: userRow?.student_name || userRow?.full_name || 'Student',
          email: userRow?.email || '',
          studentId: userRow?.qums_qid || '',
        },
        widgets: {
          classesTodayCount: 0,
          rightNow: null,
          upNext: null,
          todayTimetable: [],
          classSubstitutions: [],
          todayAttendance: [],
          attendanceSummary: { overallPercentage: null, below75Count: 0, totalSubjects: 0, okCount: 0, subjects: [] },
          monthRegister: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), totalMarkedInMonth: 0, records: [] },
        },
        feed: { notifications: [] },
      });
    }

    const isFresh = req.query.fresh === '1';
    if (isFresh) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    const todayStr = req.query.date || new Date().toISOString().split('T')[0];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // If fresh reload is explicitly requested and portal is connected, trigger live scraper
    if (isFresh && isPortalConnected) {
      try {
        const scraper = require('../scraper');
        await scraper.scrapeSubjectWiseAttendance(req.session.userId).catch(() => {});
      } catch (scrapeErr) {
        console.warn('[dashboard] Fresh live scrape note:', scrapeErr.message);
      }
    }

    // 1. Fetch Weekly Schedule (Timetable)
    const weeklySchedule = isPortalConnected ? await db.getStudentWeeklyTimetable(student.id) : [];
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();

    // 2. Authoritative Source: Today's Attendance Register (Exact Portal Parity)
    // Timetable is ONLY used to enrich Room Number (classroom). No extra/phantom classes injected.
    const todayAttendance = isPortalConnected ? await db.getTodayAttendance(student.id, todayStr) : [];
    const portalClasses = todayAttendance.filter(
      (c) => c.subject && c.subject !== 'No Scheduled Class' && c.subject_code !== '-'
    );

    let todayClasses = [];
    if (portalClasses.length > 0) {
      // Authoritative portal classes: enrich with Room Number & substitution from timetable
      todayClasses = portalClasses.map((att) => {
        const matchedTt = weeklySchedule.find(
          (w) =>
            w.day_of_week === dayOfWeek &&
            (w.period_number === att.period_number ||
             (w.subject_code && att.subject_code && w.subject_code.trim().toUpperCase() === att.subject_code.trim().toUpperCase()))
        );

        return {
          timetable_id: matchedTt?.timetable_id || null,
          day_of_week: dayOfWeek,
          period_number: att.period_number,
          period_label: att.period_label || matchedTt?.period_label || `P${att.period_number}`,
          start_time: att.start_time || matchedTt?.start_time || '09:00:00',
          end_time: att.end_time || matchedTt?.end_time || '09:55:00',
          subject_id: matchedTt?.subject_id || null,
          subject_code: att.subject_code || matchedTt?.subject_code || '-',
          subject_name: att.subject || matchedTt?.subject_name || 'Class',
          class_type: matchedTt?.class_type || 'theory',
          classroom: matchedTt?.classroom || null, // Enriched Room Number
          faculty_name: att.faculty_name || matchedTt?.faculty_name || 'Faculty',
          status: att.status || 'not_marked',
          record_id: att.record_id || null,
          remarks: att.remarks || null,
          substitution_id: matchedTt?.substitution_id || null,
          substitute_faculty_name: matchedTt?.substitute_faculty_name || null,
        };
      });
    } else if (weeklySchedule.length > 0) {
      // Fallback to weekly schedule only if portal attendance has no records (e.g. morning before sync or off-day)
      const scheduledForToday = weeklySchedule.filter((r) => r.day_of_week === dayOfWeek);
      todayClasses = scheduledForToday.map((c) => ({
        ...c,
        status: 'not_marked',
      }));
    }

    // 3. Right Now and Up Next logic (computed directly on authoritative classes)
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    let rightNowClass = null;
    let upNextClass = null;

    for (const cls of todayClasses) {
      const startTime = String(cls.start_time || '09:00:00');
      const endTime = String(cls.end_time || '09:55:00');
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const startMin = (sh || 0) * 60 + (sm || 0);
      const endMin = (eh || 0) * 60 + (em || 0);

      if (currentTimeMinutes >= startMin && currentTimeMinutes < endMin) {
        rightNowClass = {
          ...cls,
          progressPercent: Math.round(((currentTimeMinutes - startMin) / Math.max(1, endMin - startMin)) * 100),
          remainingMinutes: endMin - currentTimeMinutes,
        };
      } else if (currentTimeMinutes < startMin && !upNextClass) {
        upNextClass = {
          ...cls,
          startsInMinutes: startMin - currentTimeMinutes,
        };
      }
    }

    // 4. Class Substitutions
    const substitutions = todayClasses.filter((c) => Boolean(c.substitution_id));

    // 5. Attendance Summary & Month Register
    let attendanceSummary = isPortalConnected
      ? await db.getAttendanceSummary(student.id)
      : { overallPercentage: null, below75Count: 0, totalSubjects: 0, okCount: 0, subjects: [] };

    // If portal is connected but database summary is empty, invoke live Graphic Era scraper
    if (isPortalConnected && (!attendanceSummary.subjects || attendanceSummary.subjects.length === 0)) {
      try {
        const scraper = require('../scraper');
        const scraped = await scraper.scrapeSubjectWiseAttendance(req.session.userId);
        if (scraped && scraped.subjects && scraped.subjects.length > 0) {
          attendanceSummary = scraped;
        }
      } catch (err) {
        console.warn('[dashboard] Scraper invocation note:', err.message);
      }
    }

    const monthlyAttendance = isPortalConnected
      ? await db.getMonthlyAttendance(student.id, currentMonth, currentYear)
      : [];

    // 7. Telegram Status
    const tgRes = await db.query(
      'SELECT telegram_chat_id AS chat_id, telegram_username AS username FROM telegram_accounts WHERE user_id = $1',
      [req.session.userId]
    );
    const isTgConnected = Boolean(tgRes.rows.length > 0 && tgRes.rows[0].chat_id);

    // 8. Notifications
    const notifications = await db.getUserNotifications(req.session.userId, 5);

    res.json({
      success: true,
      currentDate: todayStr,
      periodDisplay: student.session_name || '-',
      academicSession: student.session_name || '-',
      qumsStatus: {
        connected: isPortalConnected,
        status: rawPortalState,
        label: portalLabel,
        lastSynced: userRow?.last_attendance_sync_at || student.updated_at || null,
      },
      telegramStatus: {
        connected: isTgConnected,
        username: tgRes.rows[0]?.username || null,
        chatId: tgRes.rows[0]?.chat_id || null,
      },
      student: {
        id: student.id,
        userId: student.user_id,
        name: student.full_name,
        email: student.email,
        studentId: student.student_id,
        enrollmentNumber: student.enrollment_number,
        rollNumber: student.roll_number,
        courseName: student.course_name,
        courseCode: student.course_code,
        departmentName: student.department_name,
        semesterNumber: student.semester_number,
        sectionName: student.section_name,
        avatarUrl: student.avatar_url,
      },
      widgets: {
        classesTodayCount: todayClasses.length,
        rightNow: rightNowClass,
        upNext: upNextClass,
        todayTimetable: todayClasses,
        classSubstitutions: substitutions,
        todayAttendance,
        attendanceSummary,
        monthRegister: {
          month: currentMonth,
          year: currentYear,
          totalMarkedInMonth: monthlyAttendance.length,
          records: monthlyAttendance,
        },
      },
      feed: {
        notifications,
      },
    });
  } catch (err) {
    console.error('[dashboard/student] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to aggregate student dashboard payload.' });
  }
});

module.exports = router;

