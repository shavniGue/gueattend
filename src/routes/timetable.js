/**
 * Timetable Management API Routes
 * gueattend Unified University ERP
 */

const express = require('express');
const router = express.Router();

const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/timetable/weekly
 * Returns full weekly timetable Monday to Saturday
 */
router.get('/weekly', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const rows = await db.getStudentWeeklyTimetable(student.id);

    // Group by day of week (1=Monday .. 6=Saturday)
    const scheduleByDay = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    const dayNames = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

    for (const r of rows) {
      if (scheduleByDay[r.day_of_week]) {
        scheduleByDay[r.day_of_week].push(r);
      }
    }

    res.json({
      success: true,
      student: {
        id: student.id,
        course: student.course_name,
        semester: student.semester_number,
        section: student.section_name,
      },
      dayNames,
      scheduleByDay,
      allEntries: rows,
    });
  } catch (err) {
    console.error('[timetable/weekly] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch weekly timetable.' });
  }
});

/**
 * GET /api/timetable/today
 * Today's classes with "Right Now" and "Up Next" live status indicators
 */
router.get('/today', requireAuth, async (req, res) => {
  try {
    const student = await db.getStudentByUserId(req.session.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'Student profile not found.' });
    }

    const now = new Date();
    // Monday is 1 in ISO, Sunday is 7
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const rows = await db.getStudentWeeklyTimetable(student.id);

    // Filter today's rows
    const todayClasses = rows.filter((r) => r.day_of_week === dayOfWeek);

    // Compute "Right Now" and "Up Next" based on current IST time
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

    res.json({
      success: true,
      dayOfWeek,
      totalClassesToday: todayClasses.length,
      classes: todayClasses,
      rightNow: rightNowClass,
      upNext: upNextClass,
    });
  } catch (err) {
    console.error('[timetable/today] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch today timetable.' });
  }
});

module.exports = router;

