/**
 * Module 3: Scraper Engine (ERP Data Extraction)
 * gueattend - Extract Attendance, Timetables & Coursework via Session Cookies
 */

const fs = require('fs');
const { request: playwrightRequest } = require('playwright');
const credentials = require('./credentials');
const db = require('./database/db');
const calculator = require('./calculator');

const COLLEGE_BASE_URL = process.env.COLLEGE_BASE_URL || 'https://student.geu.ac.in';
const COLLEGE_DASHBOARD_URL = process.env.COLLEGE_DASHBOARD_URL || 'https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6';
const ATTENDANCE_API = '/Web_StudentAcademic/GetYearSemWiseAttendance';
const STUDENT_DETAIL_API = '/Web_StudentAcademic/GetStudentDetailOnRegID';

/**
 * Scrape subject-wise attendance using saved session cookies
 */
async function scrapeSubjectWiseAttendance(userId) {
  const sessionPath = credentials.getSessionFilePath(userId);
  const sessionExists = fs.existsSync(sessionPath);

  // Get student from DB
  let student = await db.getStudentByUserId(userId);
  if (!student) {
    const user = await db.getUserById(userId);
    if (user) {
      await db.ensureStudentProfile(user.id, user.email).catch(() => {});
      student = await db.getStudentByUserId(userId);
    }
  }

  // 1. If live session cookies exist, query Graphic Era University Cyborg ERP
  if (sessionExists) {
    let apiContext = null;
    try {
      apiContext = await playwrightRequest.newContext({
        storageState: sessionPath,
        baseURL: COLLEGE_BASE_URL,
        extraHTTPHeaders: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: COLLEGE_DASHBOARD_URL,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });

      // Probe Dashboard to extract RegID and Student Name
      let regId = null;
      let studentName = null;
      try {
        const dashResp = await apiContext.get(COLLEGE_DASHBOARD_URL, { timeout: 25000 });
        if (dashResp.ok()) {
          const html = await dashResp.text();
          if (html.includes('N0j5Ha0') || (html.includes('password') && !html.includes('RegID'))) {
            try {
              const sessionLifecycle = require('./services/session-lifecycle');
              await sessionLifecycle.markSessionExpired(userId, 'College portal session expired or redirected to login.');
            } catch (slErr) {
              await db.query(`UPDATE users SET qums_session_status = 'expired' WHERE id = $1`, [userId]).catch(() => {});
            }
            console.warn(`[scraper] Portal session expired for user ${userId}`);
          } else {
            const regMatch = html.match(/var\s+RegID\s*=\s*['"](\d+)['"]/i) || html.match(/\bRegID\s*[:=]\s*['"]?(\d+)['"]?/i);
            if (regMatch) regId = regMatch[1];
            const nameMatch = html.match(/id=["'](?:lblStudentName|lblUserName|spnStudentName)["'][^>]*>([^<]+)</i) ||
                              html.match(/Student:\s*<b>([^<]+)<\/b>/i);
            if (nameMatch) studentName = nameMatch[1].trim();
          }
        }
      } catch (dashErr) {
        console.warn('[scraper] Dashboard probe warning:', dashErr.message);
      }

      // If studentName found, sync to users & students table
      if (studentName) {
        await db.query(
          `UPDATE users SET student_name = $1, updated_at = NOW() WHERE id = $2`,
          [studentName, userId]
        ).catch(() => {});
        if (student) {
          await db.query(
            `UPDATE students SET student_name = $1 WHERE user_id = $2`,
            [studentName, userId]
          ).catch(() => {});
        }
      }

      // If regId found or student has user.qums_qid, probe attendance for semesters
      const effectiveRegId = regId || student?.student_id || student?.enrollment_number;
      if (effectiveRegId) {
        let attendanceRows = null;
        const candidateSems = [1, 2, 3, 4, 5, 6, 7, 8];

        for (const sem of candidateSems) {
          try {
            const attResp = await apiContext.post(ATTENDANCE_API, {
              form: { RegID: String(effectiveRegId), YearSem: String(sem) },
              timeout: 15000,
            });
            if (attResp.ok()) {
              const resText = await attResp.text();
              if (resText && !resText.trim().startsWith('<')) {
                const parsed = JSON.parse(resText);
                const dataRows = typeof parsed.data === 'string' ? JSON.parse(parsed.data || '[]') : (parsed.data || []);
                if (Array.isArray(dataRows) && dataRows.length > 0 && dataRows.some(r => r.Subject || r.SubjectCode)) {
                  attendanceRows = dataRows;
                  break;
                }
              }
            }
          } catch (semErr) {}
        }

        if (attendanceRows && attendanceRows.length > 0) {
          console.log(`[scraper] Successfully scraped ${attendanceRows.length} subjects from Graphic Era ERP for student ${userId}!`);
          const mappedSubjects = attendanceRows.map((r) => {
            const code = String(r.SubjectCode || r.subjectCode || '').trim();
            const name = String(r.Subject || r.subjectName || code).trim();
            const total = Number(r.TotalLecture || r.totalClasses || 0);
            const present = Number(r.TotalPresent || r.attended || 0);
            const absent = Number(r.TotalAbsent || r.totalAbsent || 0);
            const leave = Number(r.TotalLeave || r.totalLeave || 0);
            const pct = total > 0 ? Math.round((present / total) * 1000) / 10 : Number(r.Percentage || 0);
            return {
              subjectCode: code,
              subjectName: name,
              totalClasses: total,
              attended: present,
              totalAbsent: absent,
              totalLeave: leave,
              percentage: pct,
              status: pct >= 75 ? 'normal' : 'low',
            };
          });

          // Sync into database snapshot
          await db.query(
            `INSERT INTO known_attendance (user_id, subject_code, attendance_date, period_label, status, records, updated_at)
             VALUES ($1, '__SUMMARY__', '', '', 'synced', $2, NOW())
             ON CONFLICT (user_id, subject_code, attendance_date, period_label)
             DO UPDATE SET records = EXCLUDED.records, status = EXCLUDED.status, updated_at = NOW()`,
            [userId, JSON.stringify(mappedSubjects)]
          );

          await db.query(
            `UPDATE users SET last_attendance_sync_at = NOW(), qums_session_status = 'connected' WHERE id = $1`,
            [userId]
          ).catch(() => {});

          const analyzed = calculator.analyzeSubjectsAttendance(mappedSubjects);
          return analyzed;
        }
      }
    } catch (scrapeErr) {
      console.warn('[scraper] Live ERP scrape note:', scrapeErr.message);
    } finally {
      if (apiContext) {
        await apiContext.dispose().catch(() => {});
      }
    }
  }

  // Fallback: Read from Supabase PostgreSQL snapshot cache
  const snapshotRes = await db.query(
    `SELECT records FROM known_attendance WHERE user_id = $1 AND subject_code = '__SUMMARY__'`,
    [userId]
  ).catch(() => ({ rows: [] }));

  if (snapshotRes.rows.length > 0 && Array.isArray(snapshotRes.rows[0].records) && snapshotRes.rows[0].records.length > 0) {
    return calculator.analyzeSubjectsAttendance(snapshotRes.rows[0].records);
  }

  if (student) {
    const summary = await db.getAttendanceSummary(student.id);
    if (summary && summary.subjects && summary.subjects.length > 0) {
      return calculator.analyzeSubjectsAttendance(summary.subjects);
    }
  }

  return {
    overallPercentage: null,
    below75Count: 0,
    totalSubjects: 0,
    okCount: 0,
    subjects: [],
  };
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

