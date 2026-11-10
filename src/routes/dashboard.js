/**
 * Student Dashboard Aggregator API Route
 * GUeAttend Unified University ERP
 *
 * Implements the 9 Core Dashboard Widgets inspired by Graphic Era University Cyborg Portal:
 *   1. Classes Today
 *   2. Right Now (active period card with live time progress)
 *   3. Up Next (next scheduled lecture)
 *   4. Today's Timetable
 *   5. Class Substitution Alerts
 *   6. Today's Attendance Table
 *   7. Course Progress
 *   8. Month Register
 *   9. Lecture Plan
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
    const todayClasses = weeklySchedule.filter((r) => r.day_of_week === dayOfWeek);

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

    // 5. Overall and Subject-wise Attendance Summary
    const attendanceSummary = await db.getAttendanceSummary(student.id);

    // 6. Course Progress
    const courseProgress = await db.getCourseProgress(student.section_id);

    // 7. Lecture Plans
    const lecturePlans = await db.getLecturePlans(student.section_id);
    const todayTopics = lecturePlans.filter((p) => {
      const d = p.planned_date instanceof Date ? p.planned_date.toISOString().split('T')[0] : String(p.planned_date);
      return d === todayStr;
    });

    // 8. Month Register (current month)
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthlyAttendance = await db.getMonthlyAttendance(student.id, currentMonth, currentYear);

    // 9. Notifications & Recent Circulars
    const notifications = await db.getUserNotifications(req.session.userId, 5);
    const circulars = await db.getCirculars('students', 5);

    res.json({
      success: true,
      currentDate: todayStr,
      academicSession: student.session_name,
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
        courseProgress,
        lecturePlan: {
          total: lecturePlans.length,
          todayTopics,
          completedCount: lecturePlans.filter((p) => p.completion_status === 'completed').length,
          pendingCount: lecturePlans.filter((p) => p.completion_status === 'pending').length,
          droppedCount: lecturePlans.filter((p) => p.completion_status === 'dropped').length,
          allTopics: lecturePlans,
        },
        monthRegister: {
          month: currentMonth,
          year: currentYear,
          totalMarkedInMonth: monthlyAttendance.length,
          records: monthlyAttendance,
        },
      },
      feed: {
        notifications,
        circulars,
      },
    });
  } catch (err) {
    console.error('[dashboard/student] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to aggregate student dashboard payload.' });
  }
});

module.exports = router;

