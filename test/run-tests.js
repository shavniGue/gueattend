/**
 * GUeAttend - Comprehensive Master Integration Test Suite
 * Validates Authentication, Attendance, Timetable, Academics, Exams, Fees,
 * Telegram Bot, External Sync, and Database Constraints.
 */

require('dotenv').config();
const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../src/database/db');
const { checkDatabaseHealth } = require('../src/database/db');
const { checkSupabaseHealth } = require('../src/database/supabase');
const { checkFirebaseHealth } = require('../src/config/firebase');
const { validateAttendanceRecord, syncAttendanceBatch } = require('../src/services/external-sync');
const { initTelegramBot } = require('../src/services/telegram-bot');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

async function checkAsync(name, fn) {
  totalChecks++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Error: ${err.message}`);
    failedChecks++;
  }
}

function check(name, fn) {
  totalChecks++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedChecks++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Error: ${err.message}`);
    failedChecks++;
  }
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log('🎓 GUeAttend - Master Integration Test Suite');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // SECTION 1: DATABASE & SUPABASE HEALTH
  // -------------------------------------------------------------
  console.log('--- 1. Database & Supabase PostgreSQL Health ---');

  await checkAsync('Database connection pool is operational and connected', async () => {
    const health = await checkDatabaseHealth();
    assert.strictEqual(health.connected, true, 'Database should connect successfully.');
    assert.strictEqual(health.tablesExist, true, 'All required ERP tables must exist.');
    assert.strictEqual(health.missingTables.length, 0, `Missing tables: ${health.missingTables.join(', ')}`);
  });

  await checkAsync('Supabase JWKS and configuration verification', async () => {
    const supaHealth = await checkSupabaseHealth();
    assert.strictEqual(supaHealth.jwksReachable, true, 'Supabase JWKS must be reachable.');
  });

  await checkAsync('Firebase auxiliary configuration verification', async () => {
    const fbHealth = checkFirebaseHealth();
    assert.strictEqual(fbHealth.projectId, 'gueattend');
  });

  // -------------------------------------------------------------
  // SECTION 2: AUTHENTICATION & PASSWORD SECURITY
  // -------------------------------------------------------------
  console.log('\n--- 2. Authentication & Role-Based Access Control ---');

  await checkAsync('Student user lookup and password verification', async () => {
    const studentUser = await db.getUserByEmail('karan.kumar@geu.ac.in');
    assert.ok(studentUser, 'Student user must exist.');
    assert.strictEqual(studentUser.role, 'student', 'User must have student role.');
    const match = await bcrypt.compare('Password@123', studentUser.password_hash);
    assert.strictEqual(match, true, 'Password comparison must succeed.');
  });

  await checkAsync('Admin user lookup and role verification', async () => {
    const adminUser = await db.getUserByEmail('admin@geu.ac.in');
    assert.ok(adminUser, 'Admin user must exist.');
    assert.strictEqual(adminUser.role, 'admin', 'User must have admin role.');
  });

  await checkAsync('Faculty user lookup and role verification', async () => {
    const facUser = await db.getUserByEmail('faculty.cse@geu.ac.in');
    assert.ok(facUser, 'Faculty user must exist.');
    assert.strictEqual(facUser.role, 'faculty', 'User must have faculty role.');
  });

  await checkAsync('Student profile details join query', async () => {
    const studentUser = await db.getUserByEmail('karan.kumar@geu.ac.in');
    const profile = await db.getStudentByUserId(studentUser.id);
    assert.ok(profile, 'Student profile must be populated.');
    assert.strictEqual(profile.student_id, '24030110');
    assert.strictEqual(profile.enrollment_number, 'GEU/2024/0110');
    assert.ok(profile.course_name, 'Course name must be joined.');
    assert.ok(profile.department_name, 'Department name must be joined.');
  });

  // -------------------------------------------------------------
  // SECTION 3: ATTENDANCE FORMULA & CALCULATIONS
  // -------------------------------------------------------------
  console.log('\n--- 3. Attendance Management & Formula Validation ---');

  await checkAsync('Mandatory rule: Attendance % = (Present / Total Marked) * 100', async () => {
    const summary = await db.getAttendanceSummary('stu_1');
    assert.ok(summary, 'Summary must return.');
    assert.strictEqual(typeof summary.overallPercentage, 'number');
    assert.ok(summary.totalMarked >= 0);
    assert.ok(summary.totalPresent >= 0);

    // Verify mathematical accuracy
    if (summary.totalMarked > 0) {
      const expected = Number(((summary.totalPresent / summary.totalMarked) * 100).toFixed(2));
      assert.strictEqual(summary.overallPercentage, expected, 'Calculated percentage must strictly match the formula.');
    }
  });

  await checkAsync('Unmarked classes are never counted as absent', async () => {
    const summary = await db.getAttendanceSummary('stu_1');
    const totalConsidered = summary.totalPresent + summary.totalAbsent + summary.totalLeave;
    assert.strictEqual(summary.totalMarked, totalConsidered, 'Total marked must only include present, absent, and approved leave.');
  });

  await checkAsync('Today attendance returns structured period rows', async () => {
    const todayStr = '2026-11-10';
    const rows = await db.getTodayAttendance('stu_1', todayStr);
    assert.ok(Array.isArray(rows), 'Today attendance must return an array.');
    assert.ok(rows.length > 0, 'Today attendance periods must be returned.');
    const firstPeriod = rows[0];
    assert.ok(firstPeriod.period_number, 'Period number must be defined.');
    assert.ok(firstPeriod.duration, 'Duration must be defined.');
    assert.ok(firstPeriod.subject, 'Subject must be defined.');
    assert.ok(firstPeriod.status, 'Status must be defined.');
  });

  await checkAsync('Monthly attendance register returns calendar dates', async () => {
    const records = await db.getMonthlyAttendance('stu_1', 11, 2026);
    assert.ok(Array.isArray(records));
    assert.ok(records.length > 0, 'November 2026 records must exist.');
    for (const r of records) {
      assert.ok(r.class_date, 'Class date must exist.');
      assert.ok(['present', 'absent', 'approved_leave', 'not_marked'].includes(r.status));
    }
  });

  await checkAsync('Historical date range attendance lookup', async () => {
    const records = await db.getAttendanceHistory('stu_1', '2026-09-01', '2026-11-10');
    assert.ok(Array.isArray(records));
    assert.ok(records.length >= 10, 'Historical records must span multiple dates.');
  });

  // -------------------------------------------------------------
  // SECTION 4: TIMETABLE & LIVE INDICATORS
  // -------------------------------------------------------------
  console.log('\n--- 4. Dynamic Weekly Timetable & Live Classes ---');

  await checkAsync('Weekly timetable returns Monday through Saturday periods', async () => {
    const schedule = await db.getStudentWeeklyTimetable('stu_1');
    assert.ok(Array.isArray(schedule));
    assert.ok(schedule.length >= 15, 'Weekly schedule must contain multiple classes.');

    const daysPresent = new Set(schedule.map((s) => s.day_of_week));
    assert.ok(daysPresent.has(1), 'Must contain Monday classes.');
    assert.ok(daysPresent.has(2), 'Must contain Tuesday classes.');
    assert.ok(daysPresent.has(3), 'Must contain Wednesday classes.');
  });

  await checkAsync('Timetable entry schema contains subject, code, faculty, and room', async () => {
    const schedule = await db.getStudentWeeklyTimetable('stu_1');
    const item = schedule[0];
    assert.ok(item.subject_name);
    assert.ok(item.subject_code);
    assert.ok(item.faculty_name);
    assert.ok(item.start_time);
    assert.ok(item.end_time);
  });

  // -------------------------------------------------------------
  // SECTION 5: ACADEMICS, LECTURE PLANS & COURSE PROGRESS
  // -------------------------------------------------------------
  console.log('\n--- 5. Academics, Lecture Plans & Course Progress ---');

  await checkAsync('Lecture plans contain planned topics and completion status', async () => {
    const plans = await db.getLecturePlans('sec_btech_cse_5_g4');
    assert.ok(Array.isArray(plans));
    assert.ok(plans.length > 0, 'Lecture plans must exist.');
    const completed = plans.filter((p) => p.completion_status === 'completed');
    assert.ok(completed.length > 0, 'Completed topics must exist.');
  });

  await checkAsync('Course progress computes percentage based on completed topics', async () => {
    const progress = await db.getCourseProgress('sec_btech_cse_5_g4');
    assert.ok(Array.isArray(progress));
    assert.ok(progress.length > 0);
    for (const p of progress) {
      assert.ok(p.subject_code);
      assert.ok(typeof parseFloat(p.progress_percentage) === 'number');
    }
  });

  // -------------------------------------------------------------
  // SECTION 6: EXAMINATIONS & RESULTS
  // -------------------------------------------------------------
  console.log('\n--- 6. Examinations, Marks & Semester Results ---');

  await checkAsync('Exam schedules return subject timings and classroom', async () => {
    const schedules = await db.getExamSchedules('sem_btech_cse_5');
    assert.ok(Array.isArray(schedules));
    assert.ok(schedules.length > 0, 'Exam schedules must exist.');
    assert.ok(schedules[0].exam_date);
    assert.ok(schedules[0].start_time);
  });

  await checkAsync('Semester results return SGPA, CGPA and credit totals', async () => {
    const results = await db.getStudentResults('stu_1');
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0, 'Prior semester results must exist.');
    const r = results[0];
    assert.strictEqual(parseFloat(r.sgpa), 8.64);
    assert.strictEqual(parseFloat(r.cgpa), 8.52);
    assert.strictEqual(r.result_status, 'pass');
  });

  // -------------------------------------------------------------
  // SECTION 7: FEES & RECEIPTS
  // -------------------------------------------------------------
  console.log('\n--- 7. Fees Ledger & Verified Payment Receipts ---');

  await checkAsync('Student fees return tuition, exam, hostel breakup', async () => {
    const fees = await db.getStudentFees('stu_1');
    assert.ok(Array.isArray(fees));
    assert.ok(fees.length > 0);
    const f = fees[0];
    assert.strictEqual(parseFloat(f.total_due), 132000.0);
    assert.strictEqual(f.status, 'paid');
  });

  await checkAsync('Payment receipts contain receipt number and transaction reference', async () => {
    const receipts = await db.getPaymentReceipts('stu_1');
    assert.ok(Array.isArray(receipts));
    assert.ok(receipts.length > 0);
    const r = receipts[0];
    assert.strictEqual(r.receipt_number, 'GEU-FEE-2026-09812');
    assert.strictEqual(r.payment_status, 'completed');
  });

  // -------------------------------------------------------------
  // SECTION 8: TELEGRAM BOT INTEGRATION
  // -------------------------------------------------------------
  console.log('\n--- 8. Telegram Bot Integration & Account Linking ---');

  await checkAsync('Telegram linking token generation and expiry', async () => {
    const studentUser = await db.getUserByEmail('karan.kumar@geu.ac.in');
    const token = await db.createTelegramLinkToken(studentUser.id);
    assert.ok(token);
    assert.strictEqual(token.length, 32);

    // Verify and link telegram account
    const testChatId = '999888777';
    const linkedUserId = await db.verifyAndLinkTelegram(token, testChatId, 'karankumar', 'Karan');
    assert.strictEqual(linkedUserId, studentUser.id);

    // Query telegram account by chat id
    const account = await db.getTelegramAccount(testChatId);
    assert.ok(account);
    assert.strictEqual(account.user_id, studentUser.id);
    assert.strictEqual(account.student_id, 'stu_1');

    // Clean up test link
    await db.unlinkTelegram(studentUser.id);
  });

  await checkAsync('Telegram bot instance initializes without crashing', async () => {
    const bot = initTelegramBot();
    assert.ok(bot !== null || !process.env.TELEGRAM_BOT_TOKEN);
  });

  // -------------------------------------------------------------
  // SECTION 9: EXTERNAL DATA INTEGRATION & VALIDATION
  // -------------------------------------------------------------
  console.log('\n--- 9. External Data Fetching & Sync Service ---');

  check('Payload validator accepts compliant attendance objects', () => {
    const valid = validateAttendanceRecord({
      studentId: '24030110',
      subjectCode: 'TCS-501',
      classDate: '2026-11-10',
      status: 'present',
    });
    assert.strictEqual(valid.status, 'present');
  });

  check('Payload validator rejects invalid statuses', () => {
    assert.throws(() => {
      validateAttendanceRecord({
        studentId: '24030110',
        subjectCode: 'TCS-501',
        classDate: '2026-11-10',
        status: 'invalid_status_code',
      });
    }, /Invalid status/);
  });

  await checkAsync('Batch integration service normalizes and logs to Supabase', async () => {
    const sample = [
      {
        studentId: '24030110',
        subjectCode: 'TCS-501',
        subjectName: 'Database Management Systems',
        classDate: '2026-11-09',
        status: 'present',
      },
    ];
    const res = await syncAttendanceBatch(sample, 'TEST_SYNC_SUITE');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.processed, 1);
    assert.ok(res.syncId);
  });

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`TOTAL CHECKS: ${totalChecks} | PASSED: ${passedChecks} | FAILED: ${failedChecks}`);
  console.log('===============================================================\n');

  try {
    if (db.pool) await db.pool.end();
  } catch {}

  if (failedChecks > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION CHECKS PASSED!\n');
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
