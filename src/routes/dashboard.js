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
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const todayStr = req.query.date || new Date().toISOString().split('T')[0];
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();

    // 1. Weekly schedule and Today's Timetable
    const weeklySchedule = await db.getStudentWeeklyTimetable(student.id);
    let todayClasses = weeklySchedule.filter((r) => r.day_of_week === dayOfWeek);
    if (todayClasses.length === 0 && weeklySchedule.length > 0) {
      todayClasses = weeklySchedule.filter((r) => r.day_of_week === 1);
    }

    // 2. Right Now and Up Next logic
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    let rightNowClass = null;
    let upNextClass = null;

    for (const cls of todayClasses) {
      const [sh, sm] = cls.start_time.split(':').map(Number);
      const [eh, em] = cls.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      if (currentTimeMinutes >= startMin && currentTimeMinutes < endMin) {
        rightNowClass = {
          ...cls,
          progressPercent: Math.round(((currentTimeMinutes - startMin) / (endMin - startMin)) * 100),
          remainingMinutes: endMin - currentTimeMinutes,
        };
      } else if (currentTimeMinutes < startMin && !upNextClass) {
        upNextClass = {
          ...cls,
          startsInMinutes: startMin - currentTimeMinutes,
        };
      }
    }

    // 3. Class Substitutions
    const substitutions = todayClasses.filter((c) => Boolean(c.substitution_id));

    // 4. Today's Attendance
    const todayAttendance = await db.getTodayAttendance(student.id, todayStr);

    // 5. Overall and Subject-wise Attendance Summary (includes 75% Bunk Margins)
    const attendanceSummary = await db.getAttendanceSummary(student.id);

    // 6. Month Register (current month)
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthlyAttendance = await db.getMonthlyAttendance(student.id, currentMonth, currentYear);

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
      periodDisplay: '26/07/2026 - 09/11/2026',
      academicSession: student.session_name,
      qumsStatus: {
        connected: true,
        label: 'Connected ✔',
        lastSynced: student.updated_at || new Date().toISOString(),
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

