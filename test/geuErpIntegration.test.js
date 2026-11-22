/**
 * Graphic Era University (GEU) Integration Test Suite
 * Validates GUEAttend configuration, single ERP setup, URLs, cloaks, and credentials.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${label} -> ${err.message}`);
    failed++;
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${label} -> ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log('\n=== GRAPHIC ERA UNIVERSITY (GEU) INTEGRATION TEST SUITE ===\n');

  // 1. URLs and Portal Configuration
  check('1a. GEU ERP Portal URLs correctly defined', () => {
    const scraper = require('../src/scraper');
    assert.ok(process.env.GEU_LOGIN_URL || process.env.QUMS_LOGIN_URL, 'Login URL must be set');
    assert.ok(process.env.GEU_DASHBOARD_URL || process.env.QUMS_DASHBOARD_URL, 'Dashboard URL must be set');
    assert.ok(process.env.GEU_TIMETABLE_URL || process.env.QUMS_TIMETABLE_URL, 'Timetable URL must be set');
  });

  // 2. GEU Cloaked URLs verification
  check('1b. GEU Cloaked routes decode to correct Angular endpoints', () => {
    const a = [91, 39, 158, 116, 195, 26, 111, 168, 61, 226];
    function decodeCloak(r) {
      let e = r.replace(/-/g, "+").replace(/_/g, "/");
      while (e.length % 4) e += "=";
      let n = atob(e), t = new Uint8Array(n.length);
      for (let o = 0; o < n.length; o++) t[o] = n.charCodeAt(o) ^ a[o % a.length];
      return new TextDecoder().decode(t);
    }
    assert.strictEqual(decodeCloak('N0j5Ha0'), 'login');
    assert.strictEqual(decodeCloak('P0btHKF1DtpZzThe_BuxfULbSZc_QvAAt3MCzUmDOUv7'), 'dashboard/cyborg-studenttimetable');
    assert.strictEqual(decodeCloak('P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6'), 'dashboard/cyborg-studentdashboard');
  });

  // 3. Admin Authorization
  check('2a. Admin authorization recognizes shavnikumarigue@gmail.com and shavni39@gmail.com', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    assert.ok(
      serverCode.includes('shavnikumarigue@gmail.com') || (process.env.ADMIN_EMAILS && process.env.ADMIN_EMAILS.includes('shavnikumarigue@gmail.com')),
      'Admin check must include shavnikumarigue@gmail.com'
    );
    assert.ok(
      serverCode.includes('shavni39@gmail.com') || (process.env.ADMIN_EMAILS && process.env.ADMIN_EMAILS.includes('shavni39@gmail.com')),
      'Admin check must include shavni39@gmail.com'
    );
  });

  // 4. Firebase Configuration
  check('3a. Firebase client config contains gueattend project details', () => {
    const fbCode = fs.readFileSync(path.join(__dirname, '../public/firebase-config.js'), 'utf8');
    assert.ok(fbCode.includes('gueattend'), 'Firebase config must specify gueattend');
    assert.ok(fbCode.includes('AIzaSyAInddZsCOQ4QRlGH9jEkRUwAh5ZFEGQTI'), 'Firebase apiKey match');
    assert.ok(fbCode.includes('gueattend.firebaseapp.com'), 'Firebase authDomain match');
  });

  check('3b. Firebase Auth module defaults to gueattend project ID', () => {
    const fbAuth = require('../src/firebaseAuth');
    assert.strictEqual(fbAuth.firebaseProjectId(), 'gueattend');
  });

  // 5. Telegram Bot Details
  check('4a. Telegram bot username and token configured for @gue_attendance_bot', () => {
    const envToken = process.env.TELEGRAM_BOT_TOKEN;
    const envUser = process.env.TELEGRAM_BOT_USERNAME;
    assert.strictEqual(envUser, 'gue_attendance_bot');
    assert.ok(Boolean(envToken), 'TELEGRAM_BOT_TOKEN should be set');
  });

  // 6. Single ERP Architecture (No dual ERP exclusivity blocker)
  await checkAsync('5a. Single ERP architecture allows login without Old/New ERP conflict', async () => {
    const sessionRegistry = require('../src/erp-session-registry');
    const result = await sessionRegistry.checkSessionEligibility('GEU12345', 'dummy-user-1', 'OLD');
    assert.strictEqual(result.allowed, true, 'Single ERP should allow login cleanly');
  });

  // 7. Form selectors and URL detection in login.js
  check('6a. Login form helpers support GEU ERP Angular inputs and N0j5Ha0 URL', () => {
    const login = require('../src/login');
    assert.strictEqual(login.isLoginLikeUrl('https://student.geu.ac.in/N0j5Ha0'), true, 'Must recognize N0j5Ha0 as login URL');
    assert.strictEqual(login.isLoginLikeUrl('https://student.geu.ac.in/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6'), false, 'Must not classify dashboard as login URL');
    const loginCode = fs.readFileSync(path.join(__dirname, '../src/login.js'), 'utf8');
    assert.ok(loginCode.includes('formcontrolname="UserID" i') || loginCode.includes('formcontrolname'), 'Must support UserID formcontrol');
    assert.ok(loginCode.includes('formcontrolname="CaptchaText" i') || loginCode.includes('CaptchaText'), 'Must support CaptchaText formcontrol');
    assert.ok(loginCode.includes('img[alt*="CAPTCHA" i]'), 'Must support GEU captcha image');
  });

  // 8. Server GEU aliases and DELETE credential support
  check('7a. Server registers GEU route aliases and credential deletion', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    assert.ok(serverCode.includes("'/geu-setup'"), 'Server must route /geu-setup');
    assert.ok(serverCode.includes("'/api/geu-login/start'"), 'Server must route /api/geu-login/start');
    assert.ok(serverCode.includes("'/api/geu-login/submit-captcha'"), 'Server must route /api/geu-login/submit-captcha');
    assert.ok(serverCode.includes("'/api/user/qums-credentials'"), 'Server must handle DELETE /api/user/qums-credentials');
  });

  check('7b. Server registers /api/status route for setup pages', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    assert.ok(serverCode.includes("'/api/status'"), 'Server must route /api/status');
  });

  // 9. Scraper fast path for GEU endpoints
  check('8a. Scraper implements GEU REST endpoints for attendance and timetable', () => {
    const scraperCode = fs.readFileSync(path.join(__dirname, '../src/scraper.js'), 'utf8');
    assert.ok(scraperCode.includes('GEU_ATTENDANCE_API') && scraperCode.includes('StudentAttendanceAcademic_Fill'), 'Must use StudentAttendanceAcademic_Fill');
    assert.ok(scraperCode.includes('GEU_TIMETABLE_API') && scraperCode.includes('StudentTimeTable_Fill'), 'Must use StudentTimeTable_Fill');
  });

  console.log(`\n=============================================================`);
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`=============================================================\n`);

  if (failed > 0) process.exit(1);
  process.exit(0);
})();
