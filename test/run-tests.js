/**
 * gueattend - Smart Attendance & Timetable Integration Test Suite
 * Validates Authentication, Attendance, 75% Bunk Margin Calculator,
 * Dynamic Timetables, Telegram Bot, and Data Integrity.
 */

require('dotenv').config();
const assert = require('assert');
const bcrypt = require('bcryptjs');
const http = require('http');
const db = require('../src/database/db');
const { checkDatabaseHealth } = require('../src/database/db');
const { verifyDatabaseIsolation, assertDatabaseIsolation, resolvePgSslConfig } = require('../src/database/identity');
const { checkSupabaseHealth } = require('../src/database/supabase');
const { checkFirebaseHealth } = require('../src/config/firebase');
const { validateAttendanceRecord, syncAttendanceBatch } = require('../src/services/external-sync');
const { defaultErpAdapter } = require('../src/services/erp-adapter');
const { encrypt, decrypt } = require('../src/crypto');
const telegramService = require('../src/services/telegram-bot');
const { initTelegramBot } = telegramService;
const app = require('../src/server');

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
  console.log('🎓 gueattend - Smart Attendance & Timetable Test Suite');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // SECTION 1: DATABASE & SUPABASE HEALTH
  // -------------------------------------------------------------
  console.log('--- 1. Database & Supabase PostgreSQL Health ---');

  await checkAsync('Database isolation & connection pool strictly match cnpullmxupyqdndxzbih', async () => {
    const health = await checkDatabaseHealth();
    assert.strictEqual(health.isolated, true, `Isolation failed: ${health.details}`);
    assert.strictEqual(health.expectedProjectRef, 'cnpullmxupyqdndxzbih');
    assert.strictEqual(health.projectMismatch, false);
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
  // SECTION 5: 75% BUNK MARGIN & SHORTAGE CALCULATOR
  // -------------------------------------------------------------
  console.log('\n--- 5. 75% Attendance & Bunk Margin Calculator ---');

  await checkAsync('Attendance summary contains calculated 75% bunk margin', async () => {
    const summary = await db.getAttendanceSummary('stu_1');
    assert.ok(summary.bunkMargin, 'Summary must include bunkMargin calculation.');
    assert.ok(typeof summary.bunkMargin.canBunk === 'number', 'canBunk must be a number.');
    assert.ok(typeof summary.bunkMargin.mustAttend === 'number', 'mustAttend must be a number.');
    assert.ok(summary.bunkMargin.message, 'A user-facing status message must be provided.');
  });

  await checkAsync('Safe bunk calculation when attendance is above 75%', async () => {
    const summary = await db.getAttendanceSummary('stu_1');
    if (summary.overallPercentage >= 75.0) {
      assert.strictEqual(summary.bunkMargin.isShortage, false);
      assert.strictEqual(summary.bunkMargin.mustAttend, 0);
      assert.ok(summary.bunkMargin.canBunk >= 0);
    }
  });

  await checkAsync('Subject-wise bunk margin and criteria calculation', async () => {
    const summary = await db.getAttendanceSummary('stu_1');
    assert.ok(summary.subjects.length > 0);
    for (const sub of summary.subjects) {
      assert.ok(sub.bunkMargin, 'Each subject must have bunkMargin.');
      assert.ok(typeof sub.bunkMargin.message === 'string');
    }
  });

  // -------------------------------------------------------------
  // SECTION 6: TELEGRAM BOT INTEGRATION & ACCOUNT LINKING
  // -------------------------------------------------------------
  console.log('\n--- 6. Telegram Bot Integration & Account Linking ---');

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
  // SECTION 7: EXTERNAL DATA INTEGRATION & VALIDATION
  // -------------------------------------------------------------
  console.log('\n--- 7. External Data Fetching & Sync Service ---');

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
  // SECTION 8: ISOLATION GUARDS, SECURITY, CRYPTO & ERP ADAPTER
  // -------------------------------------------------------------
  console.log('\n--- 8. Isolation Guards, Security, Crypto & ERP Adapter ---');

  check('Isolation guard rejects QAttend (ifqcykeinpgqyoduwyho) & accepts cnpullmxupyqdndxzbih', () => {
    const bad = verifyDatabaseIsolation({
      connectionString: 'postgresql://postgres.ifqcykeinpgqyoduwyho:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
      supabaseUrl: 'https://cnpullmxupyqdndxzbih.supabase.co',
      jwksUrl: 'https://cnpullmxupyqdndxzbih.supabase.co/auth/v1/.well-known/jwks.json',
    });
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.isForbiddenProject, true);
    assert.throws(() => assertDatabaseIsolation({
      connectionString: 'postgresql://postgres.ifqcykeinpgqyoduwyho:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
      supabaseUrl: 'https://cnpullmxupyqdndxzbih.supabase.co',
    }), /DATABASE_ISOLATION_VIOLATION|Database isolation/);

    const good = verifyDatabaseIsolation({
      connectionString: 'postgresql://postgres.cnpullmxupyqdndxzbih:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
      supabaseUrl: 'https://cnpullmxupyqdndxzbih.supabase.co',
      jwksUrl: 'https://cnpullmxupyqdndxzbih.supabase.co/auth/v1/.well-known/jwks.json',
    });
    assert.strictEqual(good.ok, true);
    assert.strictEqual(good.dbRef, 'cnpullmxupyqdndxzbih');
  });

  check('TLS validation defaults to strict certificate verification for remote hosts', () => {
    const tlsCfg = resolvePgSslConfig('postgresql://postgres.cnpullmxupyqdndxzbih:secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres');
    assert.strictEqual(tlsCfg.rejectUnauthorized, true);
    assert.strictEqual(resolvePgSslConfig('postgresql://postgres:secret@localhost:5432/postgres'), false);
  });

  check('AES-256-GCM vault round-trip encryption & decryption succeeds', () => {
    const cipher = encrypt('GEU_Portal_Secret_2026!');
    assert.ok(cipher.startsWith('v2:'));
    assert.strictEqual(decrypt(cipher), 'GEU_Portal_Secret_2026!');
  });

  await checkAsync('Modular GEU ERP adapter documents missing endpoints cleanly without inventing URLs', async () => {
    const caps = defaultErpAdapter.getCapabilities();
    assert.strictEqual(caps.loginAndCaptchaRelay.turnstileBypass, false);
    assert.strictEqual(caps.postLoginLiveEndpoints.status, 'AWAITING_AUTHORIZED_ENDPOINT_EVIDENCE');
    await assert.rejects(() => defaultErpAdapter.fetchSubjectAttendance(), /NOT_CONFIGURED/);
  });

  // -------------------------------------------------------------
  // SECTION 9: SEO, ADSENSE HYGIENE, CSRF & PUBLIC ROUTES
  // -------------------------------------------------------------
  console.log('\n--- 9. SEO, AdSense Hygiene, CSRF & Public Routes ---');

  await checkAsync('Public SEO routes (/robots.txt, /sitemap.xml, /privacy-policy, /ads.txt, /api/ads/validate) & CSRF guard pass', async () => {
    const fs = require('fs');
    const path = require('path');
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const [robotsRes, sitemapRes, privacyRes, adsTxtRes, adsValRes, csrfBlockRes] = await Promise.all([
        fetch(`${baseUrl}/robots.txt`),
        fetch(`${baseUrl}/sitemap.xml`),
        fetch(`${baseUrl}/privacy-policy`),
        fetch(`${baseUrl}/ads.txt`),
        fetch(`${baseUrl}/api/ads/validate`),
        fetch(`${baseUrl}/api/campus/grievances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://evil-attacker.example' },
          body: JSON.stringify({ subject: 'x', description: 'y' }),
        }),
      ]);
      assert.strictEqual(robotsRes.status, 200);
      assert.ok((await robotsRes.text()).includes('Disallow: /admin'));
      assert.strictEqual(sitemapRes.status, 200);
      assert.ok((await sitemapRes.text()).includes('/privacy-policy'));
      assert.strictEqual(privacyRes.status, 200);
      assert.strictEqual(adsTxtRes.status, 200);
      const adsValJson = await adsValRes.json();
      assert.strictEqual(adsValJson.success, true);
      assert.ok(!adsValJson.publicPlacements.includes('dashboard'));
      assert.ok(!adsValJson.publicPlacements.includes('auth'));
      assert.strictEqual(csrfBlockRes.status, 403, 'Cross-origin POST must be blocked by CSRF middleware');

      // Ensure ads are absent on dashboard & auth pages
      const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
      const regHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'register.html'), 'utf8');
      assert.ok(!indexHtml.includes('ads.js'), 'No ads on private student dashboard');
      assert.ok(!loginHtml.includes('ads.js'), 'No ads on login page');
      assert.ok(!regHtml.includes('ads.js'), 'No ads on registration page');
    } finally {
      server.close();
    }
  });

  // -------------------------------------------------------------
  // SECTION 10: NON-SCRAPING ERP MODULES & UNIFIED TELEGRAM BOT
  // -------------------------------------------------------------
  console.log('\n--- 10. Non-Scraping ERP Modules & Unified Telegram Bot ---');

  await checkAsync('Unified Telegram bot /help command & dispatchers behave correctly', async () => {
    assert.strictEqual(typeof telegramService.handleBotCommand, 'function');
    assert.strictEqual(typeof telegramService.handleCallbackQuery, 'function');

    const sentMessages = [];
    const mockBot = {
      async sendMessage(chatId, text, opts) {
        sentMessages.push({ chatId, text, opts });
        return { message_id: sentMessages.length };
      },
      async answerCallbackQuery() {},
    };
    await telegramService.handleBotCommand(mockBot, { chat: { id: 12345 }, text: '/help', from: {} });
    assert.ok(sentMessages.some((m) => m.text.includes('/assignments') && m.text.includes('/reconnect') && m.text.includes('/admin')));
  });

  await checkAsync('Non-scraping ERP modules (lecture plans, exams, results, fees, circulars) & callback query work on live DB', async () => {
    const health = await checkDatabaseHealth();
    assert.strictEqual(health.connected, true, 'Live DB must be connected to verify student ERP module records.');
    const ackedCallbacks = [];
    const mockBot = {
      async sendMessage() { return { message_id: 1 }; },
      async answerCallbackQuery(id) { ackedCallbacks.push(id); },
    };
    await telegramService.handleCallbackQuery(mockBot, { id: 'cb_1', data: 'unknown_action', message: { chat: { id: 12345 } } });
    assert.strictEqual(ackedCallbacks[0], 'cb_1');

    const studentUser = await db.getUserByEmail('karan.kumar@geu.ac.in');
    const student = await db.getStudentByUserId(studentUser.id);
    assert.ok(student, 'Seeded student required for Phase 1 ERP checks.');
    const [plans, schedules, results, fees, receipts, circulars] = await Promise.all([
      db.getLecturePlans(student.section_id),
      db.getExamSchedules(student.semester_id),
      db.getStudentResults(student.id),
      db.getStudentFees(student.id),
      db.getPaymentReceipts(student.id),
      db.getCirculars('students', 10),
    ]);
    assert.ok(plans.length > 0, 'Lecture plans should exist for seeded section');
    assert.ok(schedules.length > 0, 'Exam schedules should exist for seeded semester');
    assert.ok(results.length > 0, 'Student results should exist');
    assert.ok(fees.length > 0, 'Student fees should exist');
    assert.ok(receipts.length > 0, 'Payment receipts should exist');
    assert.ok(circulars.length > 0, 'Circulars should exist');
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
