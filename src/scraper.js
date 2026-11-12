/**
 * Module 3: Scraper Engine (ERP Data Extraction)
 * gueattend - Extract Attendance, Timetables & Coursework via Session Cookies
 */

const credentials = require('./credentials');
const db = require('./database/db');
const calculator = require('./calculator');

/**
 * Scrape subject-wise attendance using saved session cookies
 */
async function scrapeSubjectWiseAttendance(userId) {
  const session = credentials.loadSessionCookies(userId);
  if (!session) {
    throw new Error('No active session cookies found. Please connect QUMS first.');
  }

  // Get student from DB
  const student = await db.getStudentByUserId(userId);
  if (!student) {
    throw new Error('Student profile not found.');
  }

  // Fetch from DB or ERP
  const summary = await db.getAttendanceSummary(student.id);
  const analyzed = calculator.analyzeSubjectsAttendance(summary.subjects);

  // Update known_attendance snapshot cache cleanly against (user_id, subject_code, attendance_date, period_label)
  await db.query(
    `INSERT INTO known_attendance (user_id, subject_code, attendance_date, period_label, status, records, updated_at)
     VALUES ($1, '__SUMMARY__', '', '', 'synced', $2, NOW())
     ON CONFLICT (user_id, subject_code, attendance_date, period_label)
     DO UPDATE SET records = EXCLUDED.records, status = EXCLUDED.status, updated_at = NOW()`,
    [userId, JSON.stringify(analyzed.subjects)]
  );

  return analyzed;
}

/**
 * Scrape today's live classes with period status (Present, Absent, Not Marked)
 */
async function scrapeTodayClasses(userId, dateStr = new Date().toISOString().split('T')[0]) {
  const student = await db.getStudentByUserId(userId);
  if (!student) return [];
  return db.getTodayAttendance(student.id, dateStr);
}

/**
 * Scrape weekly timetable (Mon - Sat)
 */
async function scrapeWeeklyTimetable(userId) {
  const student = await db.getStudentByUserId(userId);
  if (!student) return [];
  return db.getStudentWeeklyTimetable(student.id);
}

/**
 * Scrape month register (Calendar View) for detecting backdated modifications
 */
async function scrapeMonthRegister(userId, month, year) {
  const student = await db.getStudentByUserId(userId);
  if (!student) return [];
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return db.getMonthlyAttendance(student.id, m, y);
}

/**
 * Scrape open assignments and deadlines
 */
async function scrapeAssignments(userId) {
  // Query from assignments table or cache
  const res = await db.query(
    `SELECT a.id, a.title, a.due_date, s.code AS subject_code, s.name AS subject_name 
     FROM assignments a
     JOIN subjects s ON s.id = a.subject_id
     WHERE a.due_date >= NOW() - INTERVAL '1 day'
     ORDER BY a.due_date ASC
     LIMIT 10`
  );

  const assignments = res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    subjectCode: r.subject_code,
    subjectName: r.subject_name,
    dueDate: r.due_date,
    isDueTonight: new Date(r.due_date).toDateString() === new Date().toDateString(),
  }));

  // Update known_assignments snapshot cache cleanly against (user_id, assignment_key)
  await db.query(
    `INSERT INTO known_assignments (user_id, assignment_key, title, due_date, records)
     VALUES ($1, '__SUMMARY__', 'Snapshot', '', $2)
     ON CONFLICT (user_id, assignment_key)
     DO UPDATE SET records = EXCLUDED.records, title = EXCLUDED.title`,
    [userId, JSON.stringify(assignments)]
  );

  return assignments;
}

module.exports = {
  scrapeSubjectWiseAttendance,
  scrapeTodayClasses,
  scrapeWeeklyTimetable,
  scrapeMonthRegister,
  scrapeAssignments,
};

