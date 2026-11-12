/**
 * Database Access Module for gueattend (Supabase PostgreSQL)
 * Provides centralized connection management, transactions, and domain queries.
 */

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL || '';

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[db] Unexpected idle client error:', err.message);
  });
}

/**
 * Diagnostic database health check. Never simulates success.
 */
async function checkDatabaseHealth() {
  const result = {
    configured: Boolean(DATABASE_URL),
    connected: false,
    tablesExist: false,
    missingTables: [],
    projectMismatch: false,
    details: '',
  };

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseRef = supabaseUrl.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i)?.[1] || '';
  const dbRef = DATABASE_URL.match(/postgres\.([a-z0-9-]+):/i)?.[1] || DATABASE_URL.match(/@db\.([a-z0-9-]+)\.supabase\.co/i)?.[1] || '';
  if (supabaseRef && dbRef && supabaseRef !== dbRef) {
    result.projectMismatch = true;
    console.warn(`[db] WARNING: DATABASE_URL points to Supabase project "${dbRef}", while SUPABASE_URL is "${supabaseRef}". Update DATABASE_URL so GUeAttend does not read another project's database.`);
  }

  if (!DATABASE_URL) {
    result.details = 'DATABASE_URL environment variable is missing.';
    return result;
  }

  try {
    const client = await pool.connect();
    try {
      result.connected = true;
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
      `);
      const existing = new Set(res.rows.map((r) => r.table_name));
      const required = [
        'users',
        'students',
        'faculty',
        'departments',
        'courses',
        'semesters',
        'sections',
        'subjects',
        'timetable',
        'attendance_sessions',
        'attendance_records',
        'telegram_accounts',
      ];

      result.missingTables = required.filter((t) => !existing.has(t));
      result.tablesExist = result.missingTables.length === 0;
      result.details = result.projectMismatch
        ? `WARNING: DATABASE_URL (${dbRef}) does not match SUPABASE_URL (${supabaseRef}).`
        : result.tablesExist
          ? 'All required university ERP tables are present.'
          : `Connected, but missing tables: ${result.missingTables.join(', ')}`;
    } finally {
      client.release();
    }
  } catch (err) {
    result.details = `Database connection error: ${err.message}`;
  }

  return result;
}

/**
 * Helper to run query with error interception and automatic transient reconnection retry
 */
async function query(text, params = []) {
  if (!pool) {
    throw new Error('Database connection pool is not initialized. Check DATABASE_URL.');
  }
  try {
    return await pool.query(text, params);
  } catch (err) {
    const isTransient = err.message && (
      err.message.includes('ECONNRESET') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('Connection terminated') ||
      err.message.includes('timeout') ||
      err.code === '57P01'
    );
    if (isTransient) {
      console.warn('[db] Retrying transient database pool query...');
      return await pool.query(text, params);
    }
    throw err;
  }
}

/**
 * Execute callback within an explicit database transaction
 */
async function withTransaction(callback) {
  if (!pool) {
    throw new Error('Database connection pool is not initialized. Check DATABASE_URL.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ====================================================================
// AUTHENTICATION & USERS
// ====================================================================

async function getUserByEmail(email) {
  const res = await query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
  return res.rows[0] || null;
}

async function getUserById(id) {
  const res = await query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function createUser({ id, email, passwordHash, role, fullName, phone = '', avatarUrl = '' }) {
  const userId = id || `usr_${crypto.randomUUID()}`;
  const res = await query(
    `INSERT INTO users (id, email, password_hash, role, full_name, phone, avatar_url, is_active, created_at, updated_at)
     VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
     RETURNING *`,
    [userId, email.trim(), passwordHash, role, fullName, phone, avatarUrl]
  );
  return res.rows[0];
}

async function updateUserPassword(userId, passwordHash) {
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
}

async function updateUserRole(userId, role) {
  const res = await query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [role, userId]);
  return res.rows[0];
}

// ====================================================================
// STUDENTS & PROFILES
// ====================================================================

async function getStudentByUserId(userId) {
  const sql = `
    SELECT 
      s.*,
      u.email,
      u.full_name,
      u.phone,
      u.avatar_url,
      d.name AS department_name,
      d.code AS department_code,
      c.name AS course_name,
      c.code AS course_code,
      sem.semester_number,
      sec.name AS section_name,
      sess.session_name
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN departments d ON s.department_id = d.id
    JOIN courses c ON s.course_id = c.id
    JOIN semesters sem ON s.semester_id = sem.id
    JOIN sections sec ON s.section_id = sec.id
    JOIN academic_sessions sess ON s.academic_session_id = sess.id
    WHERE s.user_id = $1
  `;
  const res = await query(sql, [userId]);
  return res.rows[0] || null;
}

/**
 * Ensures a newly registered or Firebase-provisioned student has a valid profile row
 */
async function ensureStudentProfile(userId, email = '') {
  const existing = await getStudentByUserId(userId);
  if (existing) return existing;

  const hierarchyRes = await query(`
    SELECT
      sec.id AS section_id,
      sem.id AS semester_id,
      c.id AS course_id,
      d.id AS department_id,
      sess.id AS academic_session_id
    FROM sections sec
    JOIN semesters sem ON sec.semester_id = sem.id
    JOIN courses c ON sem.course_id = c.id
    JOIN departments d ON c.department_id = d.id
    JOIN academic_sessions sess ON sem.academic_session_id = sess.id
    ORDER BY sess.is_current DESC, sec.id ASC
    LIMIT 1
  `);

  if (hierarchyRes.rows.length === 0) {
    return null;
  }

  const h = hierarchyRes.rows[0];
  const digits = String(email || '').split('@')[0].replace(/[^0-9]/g, '');
  const uniqueSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const baseQid = digits.length >= 4 ? digits.slice(0, 12) : `GEU${uniqueSuffix}`;
  const studentRowId = `stu_${crypto.randomUUID()}`;
  const studentIdVal = `${baseQid}_${uniqueSuffix}`.slice(0, 24);
  const enrollmentNo = `GEU/2026/${uniqueSuffix}`;

  try {
    await query(
      `INSERT INTO students (
         id, user_id, student_id, enrollment_number,
         department_id, course_id, semester_id, section_id, academic_session_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO NOTHING`,
      [studentRowId, userId, studentIdVal, enrollmentNo, h.department_id, h.course_id, h.semester_id, h.section_id, h.academic_session_id]
    );
  } catch (err) {
    const fallbackId = `GEU_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await query(
      `INSERT INTO students (
         id, user_id, student_id, enrollment_number,
         department_id, course_id, semester_id, section_id, academic_session_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO NOTHING`,
      [studentRowId, userId, fallbackId, `GEU/2026/${fallbackId}`, h.department_id, h.course_id, h.semester_id, h.section_id, h.academic_session_id]
    );
  }

  return getStudentByUserId(userId);
}

async function getStudentById(studentId) {
  const sql = `
    SELECT 
      s.*,
      u.email,
      u.full_name,
      u.phone,
      u.avatar_url,
      d.name AS department_name,
      d.code AS department_code,
      c.name AS course_name,
      c.code AS course_code,
      sem.semester_number,
      sec.name AS section_name,
      sess.session_name
    FROM students s
    JOIN users u ON s.user_id = u.id
    JOIN departments d ON s.department_id = d.id
    JOIN courses c ON s.course_id = c.id
    JOIN semesters sem ON s.semester_id = sem.id
    JOIN sections sec ON s.section_id = sec.id
    JOIN academic_sessions sess ON s.academic_session_id = sess.id
    WHERE s.id = $1
  `;
  const res = await query(sql, [studentId]);
  return res.rows[0] || null;
}

async function getFacultyByUserId(userId) {
  const sql = `
    SELECT 
      f.*,
      u.email,
      u.full_name,
      u.phone,
      u.avatar_url,
      d.name AS department_name,
      d.code AS department_code
    FROM faculty f
    JOIN users u ON f.user_id = u.id
    JOIN departments d ON f.department_id = d.id
    WHERE f.user_id = $1
  `;
  const res = await query(sql, [userId]);
  return res.rows[0] || null;
}

// ====================================================================
// ATTENDANCE MANAGEMENT (Strict Formula: Not Marked != Absent)
// ====================================================================

async function getTodayAttendance(studentId, dateStr) {
  // Returns periods for dateStr with columns:
  // Period, Duration, Subject, Subject Code, Faculty Name, Attendance Status
  const sql = `
    SELECT 
      tp.period_number,
      tp.label AS period_label,
      tp.start_time,
      tp.end_time,
      CONCAT(tp.start_time::text, ' - ', tp.end_time::text) AS duration,
      COALESCE(sub.name, 'No Scheduled Class') AS subject,
      COALESCE(sub.code, '-') AS subject_code,
      COALESCE(u_fac.full_name, '-') AS faculty_name,
      COALESCE(ar.status, 'not_marked') AS status,
      ar.remarks
    FROM timetable_periods tp
    LEFT JOIN timetable tt ON tt.period_number = tp.period_number
      AND tt.section_id = (SELECT section_id FROM students WHERE id = $1)
      AND tt.day_of_week = EXTRACT(ISODOW FROM $2::date)
    LEFT JOIN subjects sub ON tt.subject_id = sub.id
    LEFT JOIN faculty fac ON tt.faculty_id = fac.id
    LEFT JOIN users u_fac ON fac.user_id = u_fac.id
    LEFT JOIN attendance_sessions att_s ON att_s.section_id = tt.section_id
      AND att_s.class_date = $2::date
      AND att_s.period_number = tp.period_number
    LEFT JOIN attendance_records ar ON ar.session_id = att_s.id
      AND ar.student_id = $1
    WHERE tp.is_break = FALSE
    ORDER BY tp.period_number ASC
  `;
  const res = await query(sql, [studentId, dateStr]);
  return res.rows;
}

async function getMonthlyAttendance(studentId, month, year) {
  const sql = `
    SELECT 
      att_s.class_date,
      att_s.period_number,
      tp.label AS period_label,
      sub.id AS subject_id,
      sub.code AS subject_code,
      sub.name AS subject_name,
      u_fac.full_name AS faculty_name,
      ar.status,
      ar.remarks
    FROM attendance_records ar
    JOIN attendance_sessions att_s ON ar.session_id = att_s.id
    JOIN timetable_periods tp ON att_s.period_number = tp.period_number
    JOIN subjects sub ON att_s.subject_id = sub.id
    JOIN faculty fac ON att_s.faculty_id = fac.id
    JOIN users u_fac ON fac.user_id = u_fac.id
    WHERE ar.student_id = $1
      AND EXTRACT(MONTH FROM att_s.class_date) = $2
      AND EXTRACT(YEAR FROM att_s.class_date) = $3
    ORDER BY att_s.class_date ASC, att_s.period_number ASC
  `;
  const res = await query(sql, [studentId, month, year]);
  return res.rows;
}

async function getAttendanceHistory(studentId, startDate, endDate) {
  const sql = `
    SELECT 
      att_s.class_date,
      att_s.period_number,
      sub.code AS subject_code,
      sub.name AS subject_name,
      u_fac.full_name AS faculty_name,
      ar.status,
      ar.remarks
    FROM attendance_records ar
    JOIN attendance_sessions att_s ON ar.session_id = att_s.id
    JOIN subjects sub ON att_s.subject_id = sub.id
    JOIN faculty fac ON att_s.faculty_id = fac.id
    JOIN users u_fac ON fac.user_id = u_fac.id
    WHERE ar.student_id = $1
      AND att_s.class_date BETWEEN $2::date AND $3::date
    ORDER BY att_s.class_date DESC, att_s.period_number ASC
  `;
  const res = await query(sql, [studentId, startDate, endDate]);
  return res.rows;
}

async function getSubjectAttendance(studentId, subjectId) {
  const sql = `
    SELECT 
      att_s.class_date,
      att_s.period_number,
      u_fac.full_name AS faculty_name,
      ar.status,
      ar.remarks
    FROM attendance_records ar
    JOIN attendance_sessions att_s ON ar.session_id = att_s.id
    JOIN faculty fac ON att_s.faculty_id = fac.id
    JOIN users u_fac ON fac.user_id = u_fac.id
    WHERE ar.student_id = $1 AND att_s.subject_id = $2
    ORDER BY att_s.class_date DESC
  `;
  const res = await query(sql, [studentId, subjectId]);
  return res.rows;
}

async function getAttendanceSummary(studentId) {
  // Aggregate subject-wise attendance using the formula:
  // percentage = (present / marked) * 100
  // Marked = present + absent + approved_leave
  const sql = `
    SELECT 
      sub.id AS subject_id,
      sub.code AS subject_code,
      sub.name AS subject_name,
      COUNT(ar.id) FILTER (WHERE ar.status IN ('present', 'absent', 'approved_leave')) AS marked_classes,
      COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS present_classes,
      COUNT(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_classes,
      COUNT(ar.id) FILTER (WHERE ar.status = 'approved_leave') AS leave_classes,
      COUNT(ar.id) FILTER (WHERE ar.status = 'not_marked') AS unmarked_classes,
      CASE 
        WHEN COUNT(ar.id) FILTER (WHERE ar.status IN ('present', 'absent', 'approved_leave')) = 0 THEN 0.00
        ELSE ROUND(
          (COUNT(ar.id) FILTER (WHERE ar.status = 'present')::numeric / 
           COUNT(ar.id) FILTER (WHERE ar.status IN ('present', 'absent', 'approved_leave'))::numeric) * 100.0, 
          2
        )
      END AS percentage
    FROM subjects sub
    JOIN students s ON s.id = $1 AND s.course_id = sub.course_id AND s.semester_id = sub.semester_id
    LEFT JOIN attendance_sessions att_s ON att_s.subject_id = sub.id AND att_s.section_id = s.section_id
    LEFT JOIN attendance_records ar ON ar.session_id = att_s.id AND ar.student_id = s.id
    GROUP BY sub.id, sub.code, sub.name
    ORDER BY sub.name ASC
  `;
  const res = await query(sql, [studentId]);
  const subjects = res.rows;

  let totalMarked = 0;
  let totalPresent = 0;
  let totalAbsent = 0;
  let totalLeave = 0;
  let totalUnmarked = 0;

  function calcBunkMargin(present, total) {
    if (total === 0) {
      return {
        canBunk: 0,
        mustAttend: 0,
        isShortage: false,
        message: 'No classes marked yet',
        guidance: 'Abhi koi class mark nahi hui.',
      };
    }
    const pct = (present / total) * 100;
    if (pct >= 75.0) {
      const canBunk = Math.floor((present - 0.75 * total) / 0.75);
      const safe = Math.max(0, canBunk);
      return {
        canBunk: safe,
        mustAttend: 0,
        isShortage: false,
        message: safe > 0 ? `Can bunk ${safe} class${safe > 1 ? 'es' : ''}` : 'On track (0 margin)',
        guidance: `${safe} classes miss kar sakte ho aur fir bhi 75%+ rahega.`,
      };
    } else {
      const mustAttend = Math.ceil((0.75 * total - present) / 0.25);
      const need = Math.max(1, mustAttend);
      return {
        canBunk: 0,
        mustAttend: need,
        isShortage: true,
        message: `Must attend next ${need} class${need > 1 ? 'es' : ''}`,
        guidance: `${need} classes lagani padegi 75% lane ke liye.`,
      };
    }
  }

  for (const s of subjects) {
    const p = parseInt(s.present_classes, 10);
    const m = parseInt(s.marked_classes, 10);
    totalMarked += m;
    totalPresent += p;
    totalAbsent += parseInt(s.absent_classes, 10);
    totalLeave += parseInt(s.leave_classes, 10);
    totalUnmarked += parseInt(s.unmarked_classes, 10);
    s.bunkMargin = calcBunkMargin(p, m);
    s.guidance = s.bunkMargin.guidance;
    s.status = s.bunkMargin.isShortage ? 'ATTENTION' : 'OK';
    s.attendedDisplay = `${p} / ${m}`;
    s.percentageDisplay = `${s.percentage}%`;
  }

  const overallPercentage = totalMarked > 0 ? Number(((totalPresent / totalMarked) * 100).toFixed(2)) : 0.0;
  const overallBunkMargin = calcBunkMargin(totalPresent, totalMarked);
  const below75Count = subjects.filter((x) => x.bunkMargin.isShortage).length;
  const okCount = subjects.length - below75Count;

  return {
    overallPercentage,
    totalMarked,
    totalPresent,
    totalAbsent,
    totalLeave,
    totalUnmarked,
    shortageAlert: overallPercentage < 75.0 && totalMarked > 0,
    bunkMargin: overallBunkMargin,
    below75Count,
    okCount,
    totalSubjects: subjects.length,
    subjects,
  };
}

// ====================================================================
// TIMETABLE SYSTEM
// ====================================================================

async function getStudentWeeklyTimetable(studentId) {
  const sql = `
    SELECT 
      tt.id AS timetable_id,
      tt.day_of_week,
      tp.period_number,
      tp.label AS period_label,
      tp.start_time,
      tp.end_time,
      sub.id AS subject_id,
      sub.code AS subject_code,
      sub.name AS subject_name,
      tt.class_type,
      cr.room_number AS classroom,
      u_fac.full_name AS faculty_name,
      cs.id AS substitution_id,
      u_sub_fac.full_name AS substitute_faculty_name
    FROM timetable tt
    JOIN timetable_periods tp ON tt.period_number = tp.period_number
    JOIN subjects sub ON tt.subject_id = sub.id
    JOIN faculty fac ON tt.faculty_id = fac.id
    JOIN users u_fac ON fac.user_id = u_fac.id
    LEFT JOIN classrooms cr ON tt.classroom_id = cr.id
    LEFT JOIN class_substitutions cs ON cs.timetable_id = tt.id AND cs.substitution_date = CURRENT_DATE
    LEFT JOIN faculty sub_fac ON cs.substitute_faculty_id = sub_fac.id
    LEFT JOIN users u_sub_fac ON sub_fac.user_id = u_sub_fac.id
    WHERE tt.section_id = (SELECT section_id FROM students WHERE id = $1)
    ORDER BY tt.day_of_week ASC, tp.period_number ASC
  `;
  const res = await query(sql, [studentId]);
  return res.rows;
}

// ====================================================================
// ACADEMICS & LECTURE PLANS
// ====================================================================

async function getLecturePlans(sectionId) {
  const sql = `
    SELECT 
      lp.*,
      sub.code AS subject_code,
      sub.name AS subject_name,
      u_fac.full_name AS faculty_name
    FROM lecture_plans lp
    JOIN subjects sub ON lp.subject_id = sub.id
    JOIN faculty fac ON lp.faculty_id = fac.id
    JOIN users u_fac ON fac.user_id = u_fac.id
    WHERE lp.section_id = $1
    ORDER BY lp.week_number ASC, lp.planned_date ASC
  `;
  const res = await query(sql, [sectionId]);
  return res.rows;
}

async function getCourseProgress(sectionId) {
  const sql = `
    SELECT 
      sub.id AS subject_id,
      sub.code AS subject_code,
      sub.name AS subject_name,
      COUNT(lp.id) AS total_topics,
      COUNT(lp.id) FILTER (WHERE lp.completion_status = 'completed') AS completed_topics,
      COUNT(lp.id) FILTER (WHERE lp.completion_status = 'pending') AS pending_topics,
      COUNT(lp.id) FILTER (WHERE lp.completion_status = 'dropped') AS dropped_topics,
      CASE 
        WHEN COUNT(lp.id) = 0 THEN 0.00
        ELSE ROUND((COUNT(lp.id) FILTER (WHERE lp.completion_status = 'completed')::numeric / COUNT(lp.id)::numeric) * 100.0, 2)
      END AS progress_percentage
    FROM subjects sub
    JOIN lecture_plans lp ON lp.subject_id = sub.id AND lp.section_id = $1
    GROUP BY sub.id, sub.code, sub.name
    ORDER BY sub.name ASC
  `;
  const res = await query(sql, [sectionId]);
  return res.rows;
}

// ====================================================================
// EXAMINATIONS & RESULTS
// ====================================================================

async function getExamSchedules(semesterId) {
  const sql = `
    SELECT 
      es.*,
      e.name AS exam_name,
      e.exam_type,
      sub.code AS subject_code,
      sub.name AS subject_name,
      cr.room_number
    FROM exam_schedules es
    JOIN examinations e ON es.examination_id = e.id
    JOIN subjects sub ON es.subject_id = sub.id
    LEFT JOIN classrooms cr ON es.classroom_id = cr.id
    WHERE e.semester_id = $1
    ORDER BY es.exam_date ASC, es.start_time ASC
  `;
  const res = await query(sql, [semesterId]);
  return res.rows;
}

async function getStudentResults(studentId) {
  const sql = `
    SELECT 
      sr.*,
      sem.semester_number,
      sess.session_name
    FROM student_results sr
    JOIN semesters sem ON sr.semester_id = sem.id
    JOIN academic_sessions sess ON sr.academic_session_id = sess.id
    WHERE sr.student_id = $1
    ORDER BY sem.semester_number DESC
  `;
  const res = await query(sql, [studentId]);
  return res.rows;
}

async function getStudentMarks(studentId, examId = null) {
  let sql = `
    SELECT 
      m.*,
      sub.code AS subject_code,
      sub.name AS subject_name,
      sub.credits,
      e.name AS exam_name,
      e.exam_type
    FROM marks m
    JOIN subjects sub ON m.subject_id = sub.id
    JOIN examinations e ON m.examination_id = e.id
    WHERE m.student_id = $1
  `;
  const params = [studentId];
  if (examId) {
    sql += ` AND m.examination_id = $2`;
    params.push(examId);
  }
  sql += ` ORDER BY sub.code ASC`;
  const res = await query(sql, params);
  return res.rows;
}

// ====================================================================
// FEES & PAYMENTS
// ====================================================================

async function getStudentFees(studentId) {
  const sql = `
    SELECT 
      sf.*,
      fs.tuition_fee,
      fs.examination_fee,
      fs.hostel_fee,
      fs.library_fee,
      fs.other_charges,
      fs.total_amount,
      sem.semester_number,
      sess.session_name
    FROM student_fees sf
    JOIN fee_structures fs ON sf.fee_structure_id = fs.id
    JOIN semesters sem ON fs.semester_id = sem.id
    JOIN academic_sessions sess ON fs.academic_session_id = sess.id
    WHERE sf.student_id = $1
    ORDER BY sf.due_date DESC
  `;
  const res = await query(sql, [studentId]);
  return res.rows;
}

async function getPaymentReceipts(studentId) {
  const sql = `
    SELECT 
      p.*,
      sf.due_date
    FROM payments p
    JOIN student_fees sf ON p.student_fee_id = sf.id
    WHERE p.student_id = $1
    ORDER BY p.payment_date DESC
  `;
  const res = await query(sql, [studentId]);
  return res.rows;
}

// ====================================================================
// CAMPUS LIFE & COMMUNICATIONS
// ====================================================================

async function getStudentGrievances(studentId) {
  const sql = `
    SELECT g.*, u_resp.full_name AS assigned_to_name
    FROM grievances g
    LEFT JOIN users u_resp ON g.assigned_to_user_id = u_resp.id
    WHERE g.student_id = $1
    ORDER BY g.created_at DESC
  `;
  const res = await query(sql, [studentId]);
  return res.rows;
}

async function createGrievance({ studentId, category, subject, description, attachmentUrl = '' }) {
  const id = `grv_${crypto.randomUUID()}`;
  const res = await query(
    `INSERT INTO grievances (id, student_id, category, subject, description, attachment_url, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW())
     RETURNING *`,
    [id, studentId, category, subject, description, attachmentUrl]
  );
  return res.rows[0];
}

async function getCirculars(audience = 'all', limit = 20) {
  const sql = `
    SELECT c.*, u.full_name AS published_by_name
    FROM circulars c
    JOIN users u ON c.published_by_user_id = u.id
    WHERE c.target_audience IN ('all', $1)
    ORDER BY c.is_pinned DESC, c.published_at DESC
    LIMIT $2
  `;
  const res = await query(sql, [audience, limit]);
  return res.rows;
}

async function getHostelDetails(studentId) {
  const sql = `
    SELECT 
      ha.*,
      h.name AS hostel_name,
      h.warden_name,
      h.warden_phone
    FROM hostel_allocations ha
    JOIN hostels h ON ha.hostel_id = h.id
    WHERE ha.student_id = $1 AND ha.status = 'active'
  `;
  const res = await query(sql, [studentId]);
  return res.rows[0] || null;
}

async function getPlacements(studentId) {
  const sql = `
    SELECT 
      p.*,
      pa.status AS application_status,
      pa.applied_at
    FROM placements p
    LEFT JOIN placement_applications pa ON p.id = pa.placement_id AND pa.student_id = $1
    WHERE p.application_deadline >= NOW() - INTERVAL '7 days'
    ORDER BY p.drive_date ASC
  `;
  const res = await query(sql, [studentId]);
  return res.rows;
}

async function getUserNotifications(userId, limit = 30) {
  const sql = `
    SELECT * FROM notifications 
    WHERE user_id = $1 
    ORDER BY COALESCE(sent_at, NOW()) DESC 
    LIMIT $2
  `;
  const res = await query(sql, [userId, limit]);
  return res.rows;
}

async function markNotificationAsRead(notificationId, userId) {
  await query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [notificationId, userId]);
}

// ====================================================================
// TELEGRAM BOT INTEGRATION
// ====================================================================

async function createTelegramLinkToken(userId) {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry
  await query(
    `INSERT INTO telegram_link_tokens (token, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [token, userId, expiresAt]
  );
  return token;
}

async function verifyAndLinkTelegram(token, chatId, username = '', firstName = '') {
  const res = await query(
    `SELECT user_id, expires_at 
     FROM telegram_link_tokens 
     WHERE token = $1`,
    [token]
  );

  if (res.rows.length === 0) {
    throw new Error('Invalid or expired linking token.');
  }

  const { user_id, expires_at } = res.rows[0];
  if (new Date(expires_at) < new Date()) {
    throw new Error('Linking token has expired. Please generate a new one from your dashboard.');
  }

  // Link account
  await query(
    `INSERT INTO telegram_accounts (user_id, telegram_chat_id, telegram_username, first_name, is_verified, notifications_enabled, linked_at)
     VALUES ($1, $2, $3, $4, TRUE, TRUE, NOW())
     ON CONFLICT (user_id) 
     DO UPDATE SET 
       telegram_chat_id = EXCLUDED.telegram_chat_id,
       telegram_username = EXCLUDED.telegram_username,
       first_name = EXCLUDED.first_name,
       is_verified = TRUE,
       linked_at = NOW()`,
    [user_id, String(chatId), username, firstName]
  );

  // Consume token
  await query('DELETE FROM telegram_link_tokens WHERE token = $1', [token]);
  return user_id;
}

async function getTelegramAccount(chatId) {
  const sql = `
    SELECT 
      ta.*,
      u.email,
      u.full_name,
      u.role,
      s.id AS student_id,
      s.enrollment_number,
      c.code AS course_code,
      sem.semester_number,
      sec.name AS section_name
    FROM telegram_accounts ta
    JOIN users u ON ta.user_id = u.id
    LEFT JOIN students s ON s.user_id = u.id
    LEFT JOIN courses c ON s.course_id = c.id
    LEFT JOIN semesters sem ON s.semester_id = sem.id
    LEFT JOIN sections sec ON s.section_id = sec.id
    WHERE ta.telegram_chat_id = $1
  `;
  const res = await query(sql, [String(chatId)]);
  return res.rows[0] || null;
}

async function getTelegramAccountByUserId(userId) {
  const res = await query('SELECT * FROM telegram_accounts WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

async function unlinkTelegram(userId) {
  await query('DELETE FROM telegram_accounts WHERE user_id = $1', [userId]);
}

// ====================================================================
// AUDIT LOGGING & SYSTEM LOGS
// ====================================================================

async function recordAuditLog({ userId, action, resource, details = {}, ip = '', userAgent = '' }) {
  const id = `aud_${crypto.randomUUID()}`;
  try {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, resource, details, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [id, userId || null, action, resource, JSON.stringify(details), ip, userAgent]
    );
  } catch (err) {
    console.error('[audit] Failed to record audit log:', err.message);
  }
}

async function recordSyncLog({ source, entityType, processed = 0, inserted = 0, updated = 0, errors = 0, status = 'success', details = {}, userId = null }) {
  const id = `syn_${crypto.randomUUID()}`;
  const res = await query(
    `INSERT INTO external_sync_logs (id, source, entity_type, records_processed, records_inserted, records_updated, errors_count, status, details, synced_by_user_id, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     RETURNING *`,
    [id, source, entityType, processed, inserted, updated, errors, status, JSON.stringify(details), userId]
  );
  return res.rows[0];
}

module.exports = {
  pool,
  query,
  withTransaction,
  checkDatabaseHealth,
  // Auth & User
  getUserByEmail,
  getUserById,
  createUser,
  updateUserPassword,
  updateUserRole,
  // Profiles
  getStudentByUserId,
  ensureStudentProfile,
  getStudentById,
  getFacultyByUserId,
  // Attendance
  getTodayAttendance,
  getMonthlyAttendance,
  getAttendanceHistory,
  getSubjectAttendance,
  getAttendanceSummary,
  // Timetable
  getStudentWeeklyTimetable,
  // Academics
  getLecturePlans,
  getCourseProgress,
  // Exams & Fees
  getExamSchedules,
  getStudentResults,
  getStudentMarks,
  getStudentFees,
  getPaymentReceipts,
  // Campus Life
  getStudentGrievances,
  createGrievance,
  getCirculars,
  getHostelDetails,
  getPlacements,
  getUserNotifications,
  markNotificationAsRead,
  // Telegram
  createTelegramLinkToken,
  verifyAndLinkTelegram,
  getTelegramAccount,
  getTelegramAccountByUserId,
  unlinkTelegram,
  // Audit
  recordAuditLog,
  recordSyncLog,
};
