/**
 * Web-based QUMS login (multi-user) — HEADLESS captcha relay.
 *
 * Koi visible browser window nahi khulti — deployment-safe (VPS pe bhi chalta
 * hai jahan display nahi hota). Captcha image dashboard pe dikhti hai:
 *   1. POST /api/qums-login/start
 *      -> headless Chromium login page kholta hai, QID+password auto-fill
 *         (RECONNECT: DB se decrypt karke — user ko dobara nahi poochha jaata;
 *          FIRST-TIME: frontend se aaye creds use + success pe encrypted save),
 *         captcha ka screenshot (base64) return karta hai (browser alive rehta hai)
 *   2. POST /api/qums-login/submit-captcha { captchaText }
 *      -> captcha fill + Login click + URL-change wait; success pe session
 *         data/qums-sessions/<userId>.json me save + browser dispose.
 *         Galat captcha -> page reload + FRESH captcha image return (retry).
 *
 * Pending login 5 min me auto-expires (browser close).
 */
require('dotenv').config();
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}
const fs = require('fs');
const { chromium } = require('playwright');
const db = require('./db');
const { encryptSecret, decryptSecret } = require('./crypto');
const { checkSessionEligibility, acquireSession } = require('./erp-session-registry');
const {
  isLoginLikeUrl,
  findLoginForm,
  autofillCredentials,
  locateCaptchaInput,
  clickLoginButton,
  captureCaptchaImage,
} = require('./login');

const LOGIN_URL =
  process.env.GEU_LOGIN_URL ||
  process.env.QUMS_LOGIN_URL ||
  'https://student.geu.ac.in/N0j5Ha0';
const PENDING_TTL_MS = 3 * 60 * 1000; // 3 min to solve the captcha
const MAX_CONCURRENT_PENDING = parseInt(process.env.MAX_CONCURRENT_PENDING, 10) || 15; // Allow multiple concurrent users
const MAX_CONCURRENT_LAUNCHES = parseInt(process.env.MAX_CONCURRENT_LAUNCHES, 10) || 6;

class ConcurrentLoginError extends Error {
  constructor(message = 'Another GEU reconnect or login is already in progress. Please wait a moment and try again.') {
    super(message);
    this.name = 'ConcurrentLoginError';
    this.code = 'CONCURRENT_LOGIN_LIMIT';
    this.hint = 'High login traffic on the server. Please wait a moment and retry.';
  }
}

/** userId -> { browser, context, page, frame, startedAt, timer } */
const pending = new Map();
const activeLaunchingUsers = new Map(); // userId -> startedAt

function cleanupStalePending() {
  const now = Date.now();
  for (const [id, p] of pending) {
    const isDead = !p || !p.browser || (typeof p.browser.isConnected === 'function' && !p.browser.isConnected()) || (p.page && p.page.isClosed && p.page.isClosed());
    const isExpired = (now - (p.startedAt || 0)) > PENDING_TTL_MS;
    if (isDead || isExpired) {
      disposePending(id).catch(() => {});
    }
  }
}

function cleanupStaleLaunching() {
  const now = Date.now();
  for (const [id, startedAt] of activeLaunchingUsers) {
    if (now - startedAt > 25000) {
      activeLaunchingUsers.delete(id);
    }
  }
}

function isConcurrentBrowserActive(userId) {
  cleanupStalePending();
  cleanupStaleLaunching();
  // Allow same user to refresh or reconnect without blocking themselves
  if (pending.has(userId) || activeLaunchingUsers.has(userId)) {
    return false;
  }
  if (pending.size >= MAX_CONCURRENT_PENDING) {
    return true;
  }
  return false;
}

async function disposePending(userId) {
  const p = pending.get(userId);
  if (!p) return;
  pending.delete(userId);
  if (p.timer) clearTimeout(p.timer);
  // Wipe the in-memory credential copy immediately (never persisted anywhere).
  p.password = '';
  try {
    if (p.page && !p.page.isClosed()) await p.page.close().catch(() => {});
  } catch {}
  try {
    if (p.context) await p.context.close().catch(() => {});
  } catch {}
  try {
    if (p.browser) await p.browser.close().catch(() => {});
  } catch {}
}

// Navigation strategy for the QUMS portal:
//   - The portal keeps long-running network requests open after the document
//     arrives, and from some networks the response can be slow to start —
//     'domcontentloaded' held page.goto for the FULL 60s timeout in that case.
//   - 'commit' resolves as soon as the response starts arriving; we then wait
//     explicitly for the login-form inputs the captcha flow actually needs.
const LOGIN_NAV_TIMEOUT_MS = 45000; // bounded, not "huge"
const LOGIN_FORM_WAIT_MS = 20000; // form may render late / inside an iframe

/**
 * Navigate to the QUMS login page and wait until the login form is REALLY
 * usable (a frame with both a text input and a password input — the same
 * condition findLoginForm requires). Returns the login frame, or throws a
 * user-friendly error (no 60s hangs, no confusing downstream failures).
 */
async function gotoLoginPage(page) {
  try {
    await page.goto(LOGIN_URL, {
      waitUntil: 'commit',
      timeout: LOGIN_NAV_TIMEOUT_MS,
    });
  } catch (err) {
    const e = new Error(
      `GEU portal navigation failed (${String(err.message || '').split('\n')[0]}).`
    );
    e.name = 'ScrapeError'; // server maps this to HTTP 502 + shows the hint
    e.hint = 'Portal down hai ya network se reachable nahi — thodi der baad retry karo.';
    throw e;
  }

  // Fast wait: wait for password input to appear in DOM via browser event
  try {
    await page.waitForSelector('input[type="password"]', { timeout: LOGIN_FORM_WAIT_MS });
    const mainFrame = page.mainFrame();
    const [userCount, passCount] = await Promise.all([
      mainFrame.locator('input[formcontrolname="UserID" i], input[type="text"], input[placeholder*="User ID" i]').count().catch(() => 0),
      mainFrame.locator('input[formcontrolname="Password" i], input[type="password"]').count().catch(() => 0),
    ]);
    if (userCount > 0 && passCount > 0) return mainFrame;
  } catch {}

  // Bounded poll fallback: findLoginForm needs UserID+password inputs in SOME frame
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const frame = await findLoginForm(page);
    try {
      const [userCount, passCount] = await Promise.all([
        frame.locator('input[formcontrolname="UserID" i], input[type="text"], input[placeholder*="User ID" i]').count(),
        frame.locator('input[formcontrolname="Password" i], input[type="password"]').count(),
      ]);
      if (userCount > 0 && passCount > 0) return frame;
    } catch {
      /* frame detached mid-check — retry */
    }
    await page.waitForTimeout(100);
  }

  const e = new Error('GEU ERP login form load nahi hua (page khula par form nahi mila).');
  e.name = 'ScrapeError';
  e.hint = 'Portal slow hai ya markup badal gaya hai — thodi der baad retry karo.';
  throw e;
}

async function openLoginFormPage() {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--mute-audio',
    ],
  };

  const { launchChromiumSafe } = require('./playwright-helper');
  let browser;
  try {
    browser = await launchChromiumSafe(chromium, launchOptions);
  } catch (launchErr) {
    console.error('[Playwright] Chromium launch error:', launchErr.message);
    const userErr = new Error('Browser engine download ho raha hai. Please 1 minute baad dobara Get Captcha click karein.');
    userErr.name = 'BrowserMissingError';
    userErr.hint = 'Server is installing Chromium dependencies. Please wait 60 seconds and retry.';
    throw userErr;
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1, // 1x saves 4x RAM and GPU compared to 2x
  });
  // Abort non-essential network requests (fonts, media, trackers) to cut bandwidth and speed up page load
  await context.route('**/*', (route) => {
    const url = route.request().url().toLowerCase();
    const type = route.request().resourceType();
    if (type === 'font' || type === 'media') {
      return route.abort();
    }
    if (
      url.includes('google-analytics') ||
      url.includes('googletagmanager') ||
      url.includes('facebook') ||
      url.includes('razorpay') ||
      url.includes('cloudflareinsights') ||
      url.includes('challenges.cloudflare.com')
    ) {
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  try {
    const frame = await gotoLoginPage(page); // commit + explicit form wait
    return { browser, context, page, frame };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

async function captureCaptchaFor(pendingLogin) {
  const image = await captureCaptchaImage(pendingLogin.page, pendingLogin.frame);
  pendingLogin.captchaImage = image;
  return image;
}

/**
 * Step 1: login page kholo (HEADLESS — koi visible window nahi), creds
 * auto-fill karo, captcha ka screenshot (base64) return karo.
 *
 * credsOverride ({ qid, password }) sirf FIRST-TIME setup ke liye — frontend
 * inputs se aata hai. RECONNECT me credsOverride NAHI do: DB se decrypt karke
 * auto-fill hota hai, user ko QID/password dobara nahi poochhe jaate.
 */
async function startQumsLogin(userId, credsInput, log = console) {
  const user = await db.getUserById(userId);
  let qid = String((credsInput && credsInput.qid) || (user && user.qumsQid) || '').trim();
  let password = credsInput && credsInput.password ? String(credsInput.password) : '';

  // If password was not passed, use saved encrypted password from DB
  if (!password && user) {
    const savedEncrypted = user.qumsPasswordEncrypted || (await db.getQumsEncryptedPassword(userId));
    if (savedEncrypted) {
      password = decryptSecret(savedEncrypted) || '';
    }
  }

  const confirmSwitch = Boolean(credsInput && credsInput.confirmSwitch);
  if (!qid || !password) {
    const e = new Error('Please enter your GEU ID and password.');
    e.name = 'QumsCredsRequired';
    e.hint = 'Enter your GEU ID and password once. They will remain securely saved until you reset or delete your connection.';
    throw e;
  }

  // Detect identity change: if current active QID is different, require confirmation
  if (user && user.qumsQid && user.qumsQid !== qid && !confirmSwitch) {
    const err = new Error(`A different GEU student ID was detected (old: ${user.qumsQid}, new: ${qid}). Explicit confirmation required before switching active GEU identity.`);
    err.name = 'IdentityConflictError';
    err.code = 'IdentityConflict';
    err.oldQid = user.qumsQid;
    err.newQid = qid;
    throw err;
  }

  // Pre-save credentials securely so Telegram /reconnect works immediately
  if (credsInput && credsInput.password && qid) {
    try {
      const { encryptSecret } = require('./crypto');
      await db.updateUser(userId, {
        qumsQid: qid,
        qumsPasswordEncrypted: encryptSecret(password),
      });
    } catch {}
  }

  // Enforce One QUMS Account = One Active ERP Session
  const eligibility = await checkSessionEligibility(qid, userId, 'OLD');
  if (!eligibility.allowed) {
    const err = new Error(eligibility.conflictMessage);
    err.name = 'SessionConflictError';
    err.code = 'SESSION_CONFLICT';
    err.activeErp = eligibility.activeErp;
    throw err;
  }

  // If too many users are actively launching browsers right now, wait briefly in queue
  cleanupStaleLaunching();
  const waitStart = Date.now();
  while (activeLaunchingUsers.size >= MAX_CONCURRENT_LAUNCHES && !activeLaunchingUsers.has(userId) && (Date.now() - waitStart < 15000)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    cleanupStaleLaunching();
  }

  if (isConcurrentBrowserActive(userId)) {
    log.log(`[qums-login] Concurrent login limit reached for user ${userId} (${pending.size} active sessions).`);
    throw new ConcurrentLoginError();
  }

  // Fast path: if browser & page are already active for this user, reuse them via single clean navigation (~1s vs ~6s)
  const existing = pending.get(userId);
  if (existing && existing.page && !existing.page.isClosed()) {
    try {
      log.log(`[qums-login] Reusing existing browser page for user ${userId} to refresh captcha...`);
      const frame = await gotoLoginPage(existing.page);
      await autofillCredentials(frame, qid, password);
      existing.frame = frame;
      existing.qid = qid;
      existing.password = password;
      existing.confirmSwitch = confirmSwitch;
      const captchaImage = await captureCaptchaFor(existing);
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        log.log(`[qums-login] pending login timeout for user ${userId} — browser close.`);
        disposePending(userId);
      }, PENDING_TTL_MS);
      return { ok: true, captchaImage };
    } catch (reloadErr) {
      log.log(`[qums-login] page reload failed (${reloadErr.message}), falling back to fresh browser...`);
      await disposePending(userId);
    }
  }

  activeLaunchingUsers.set(userId, Date.now());
  try {
    await disposePending(userId); // koi purana pending ho to clean
    const { browser, context, page, frame } = await openLoginFormPage();
    try {
      await autofillCredentials(frame, qid, password);
      // qid/password sirf IN-MEMORY pending object me (captcha-retry ke liye).
      const pendingLogin = {
        browser,
        context,
        page,
        frame,
        startedAt: Date.now(),
        qid,
        password,
        confirmSwitch,
      };
      const captchaImage = await captureCaptchaFor(pendingLogin);
      pendingLogin.timer = setTimeout(() => {
        log.log(`[qums-login] pending login timeout for user ${userId} — browser close.`);
        disposePending(userId);
      }, PENDING_TTL_MS);
      pending.set(userId, pendingLogin);
      return { ok: true, captchaImage };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  } finally {
    activeLaunchingUsers.delete(userId);
  }
}

/** Step 2: submit the captcha; success -> per-user session file + DB update. */
async function submitQumsCaptcha(userId, rawCaptchaText, log = console, opts = {}) {
  const p = pending.get(userId);
  if (!p) {
    const e = new Error('No pending GEU login — captcha dobara generate karo.');
    e.name = 'NoPendingLogin';
    e.code = 'SESSION_EXPIRED';
    e.hint = 'Captcha 5 min me expire ho jata hai. Start Login dobara dabao.';
    throw e;
  }

  // QUMS captchas are 6 characters uppercase [A-Z0-9]. Auto-trim and uppercase
  // so mobile keyboards or lowercase typing never cause a false "Captcha does not match".
  const captchaText = String(rawCaptchaText || '').trim().toUpperCase();

  const captchaInput = await locateCaptchaInput(p.frame);
  await captchaInput.fill(captchaText);

  // Fast response detection: submit form and wait for POST response & DOM load.
  // This guarantees we evaluate only the response to THIS attempt, eliminating
  // Promise.race background leaks, stale error element matching, and false timeouts.
  let postResponse = null;
  let outcome = 'unknown';
  let portalError = '';
  try {
    const [res] = await Promise.all([
      p.page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          (r.url().includes('login') ||
            r.url().includes('Login') ||
            r.url().includes('api/Auth') ||
            r.url().includes('N0j5Ha0') ||
            r.url().includes('qums') ||
            r.url().includes('/api/')),
        { timeout: 15000 }
      ).catch(() => null),
      clickLoginButton(p.frame),
    ]);
    postResponse = res;
    await p.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  } catch (err) {
    log.log(`[qums-login] POST submission error or timeout for user ${userId}: ${err.message}`);
  }

  // Check JSON API response if present
  let jsonResp = null;
  if (postResponse) {
    try {
      jsonResp = await postResponse.json().catch(() => null);
    } catch {}
  }
  if (jsonResp && typeof jsonResp === 'object') {
    if (jsonResp.Flag === 1 || jsonResp.Token || jsonResp.Status === 1 || jsonResp.Success === true) {
      outcome = 'navigated';
    } else if (jsonResp.Flag === 0 || jsonResp.Msg || jsonResp.Message || jsonResp.error) {
      outcome = 'validation_error';
      portalError = jsonResp.Msg || jsonResp.Message || jsonResp.error;
    }
  }

  if (outcome === 'unknown') {
    // Check if navigation succeeded (redirected to dashboard / away from login URL)
    if (!isLoginLikeUrl(p.page.url())) {
      outcome = 'navigated';
    } else if (!postResponse) {
      outcome = 'timeout';
    } else {
      // If portal uses a short client-side script redirect before navigating, allow up to 3s
      try {
        await p.page.waitForURL((url) => !isLoginLikeUrl(url.toString()), { timeout: 3000 });
        outcome = 'navigated';
      } catch {
        outcome = 'validation_error';
      }
    }
  }

  // Strict verification: Verify authenticated cookies in the active browser context
  if (outcome === 'navigated') {
    const cookies = await p.context.cookies().catch(() => []);
    const hasAuth = cookies.some((c) => c && c.name === 'jwt' && c.value && c.value.length > 20);
    if (!hasAuth && isLoginLikeUrl(p.page.url())) {
      outcome = 'validation_error';
      if (!portalError) {
        portalError = 'Captcha galat lagii ya login nahi hua — nayi captcha le lo, dobara try karo.';
      }
    }
  }

  if (outcome !== 'navigated') {
    // Read the exact error rendered on the portal
    try {
      const domError = await p.page.evaluate(() => {
        const sel = '.toast-message, .alert-danger, .text-danger, .validation-summary-errors, .field-validation-error, [role="alert"], .swal2-html-container';
        const errors = Array.from(document.querySelectorAll(sel))
          .map((el) => el.innerText.trim())
          .filter(Boolean);
        return errors.join('; ');
      });
      if (domError) {
        portalError = portalError ? `${portalError}; ${domError}` : domError;
      }
    } catch {}

    let errorCode = 'UNEXPECTED_RESPONSE';
    let userMessage = portalError || 'Login failed on GEU ERP portal.';

    if (/captcha/i.test(portalError)) {
      errorCode = 'INVALID_CAPTCHA';
      userMessage = 'Captcha galat lagii ya login nahi hua — nayi captcha le lo, dobara try karo.';
    } else if (/user|password|credential|login id|roll/i.test(portalError)) {
      errorCode = 'INVALID_CREDENTIALS';
      userMessage = 'Invalid GEU ID or password. Please verify your credentials and try again.';
    } else if (/expired|timeout|token/i.test(portalError)) {
      errorCode = 'SESSION_EXPIRED';
      userMessage = 'GEU session or CAPTCHA expired. Please try again.';
    } else if (outcome === 'timeout') {
      errorCode = 'PORTAL_TIMEOUT';
      userMessage = 'GEU portal did not respond in time (network timeout). Please try again in a moment.';
    }

    log.log(`[qums-login] Login attempt failed for user ${userId}: [${errorCode}] ${userMessage} (portal: "${portalError}")`);

    if (outcome === 'timeout') {
      await disposePending(userId);
      return {
        ok: false,
        code: errorCode,
        error: userMessage,
        captchaImage: null,
      };
    }

    // Fast in-page captcha capture: the error page already generated a new inline captcha image.
    let captchaImage = '';
    try {
      await p.page.waitForTimeout(500);
      captchaImage = await captureCaptchaFor(p);
    } catch (captureErr) {
      log.log(`[qums-login] in-page captcha capture failed (${captureErr.message}), falling back to fresh browser...`);
      await p.browser.close().catch(() => {});
      activeLaunchingUserId = userId;
      let fresh;
      try {
        fresh = await openLoginFormPage();
      } finally {
        if (activeLaunchingUserId === userId) activeLaunchingUserId = null;
      }
      p.browser = fresh.browser;
      p.context = fresh.context;
      p.page = fresh.page;
      p.frame = fresh.frame;
      await autofillCredentials(p.frame, p.qid, p.password);
      captchaImage = await captureCaptchaFor(p);
    }

    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      log.log(`[qums-login] pending login timeout for user ${userId} — browser close.`);
      disposePending(userId);
    }, PENDING_TTL_MS);

    return {
      ok: false,
      code: errorCode,
      error: userMessage,
      captchaImage,
    };
  }

  await p.page.waitForTimeout(2000); // post-login JS settle

  // Extract student name directly from post-login dashboard DOM
  let inPageStudentName = '';
  try {
    inPageStudentName = await p.page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('app-root div, app-root span, app-root h4, app-root h5, app-root strong'))
        .map((el) => (el.innerText || el.textContent || '').trim())
        .filter((t) => t.length >= 2 && t.length <= 30 && !t.includes('\n'));
      for (const t of candidates) {
        if (/^[A-Z\s]{3,30}$/.test(t) && !/CYBORG|PORTAL|STUDENT|BACHELOR|MASTER|MENU|DASHBOARD|ATTENDANCE|FEE|EXAM/i.test(t)) {
          return t;
        }
      }
      return '';
    }).catch(() => '');
  } catch {}

  const sessionPath = db.sessionPathFor(userId);
  await p.context.storageState({ path: sessionPath });
  const pendingPassword = p.password;
  await disposePending(userId); // also wipes the in-memory password

  const user = await db.getUserById(userId);
  const isDifferentQid = Boolean(user && user.qumsQid && user.qumsQid !== p.qid);
  const isFirstTime = !user || (!user.monitoringStartedDate && !user.monitoringStartedAt) || isDifferentQid;

  // Persist QID + session path + encrypted password
  await completeQumsSetup(userId, p.qid, {
    password: pendingPassword,
    confirmSwitch: p.confirmSwitch,
  });
  if (inPageStudentName) {
    await db.updateUser(userId, { studentName: inPageStudentName }).catch(() => {});
  }
  // Centralized session registry: record active Old ERP session
  await acquireSession({ identity: p.qid, userId, targetErp: 'OLD' }).catch(() => {});
  log.log(`[qums-login] QUMS session saved for user ${userId} -> ${sessionPath}`);

  // Track reconnect channel (Telegram vs Webpage)
  const reconnectSource = (opts && opts.source === 'telegram') ? 'telegram' : 'web';
  await db.recordUserReconnect(userId, reconnectSource, log).catch(() => {});

  // QUMS is the source of truth for identity: fetch the displayed name and the
  // current Year/Sem right after a successful login/reconnect (cache refresh).
  let profile = { studentName: '', yearSem: '' };
  try {
    profile = await require('./scraper').fetchQumsProfile(sessionPath, log);
    const patch = {};
    if (profile.studentName) patch.studentName = profile.studentName;
    if (profile.yearSem) patch.qumsYearSem = profile.yearSem;
    if (Object.keys(patch).length) await db.updateUser(userId, patch);
    await db.touchUserSync(userId, { profile: true, error: '' });
    await db.clearSessionExpiry(userId);
    log.log(`[qums-login] profile synced from QUMS (user ${userId}, yearSem=${profile.yearSem || 'unknown'}).`);
  } catch (err) {
    // Name/YearSem are a cache: a lookup failure must never fail the login.
    log.log(`[qums-login] profile fetch skipped: ${err.name || 'Error'}: ${err.message}`);
  }

  // Baseline vs Reconnect catch-up (run asynchronously in background so response returns immediately):
  try {
    const catchup = require('./catchup');
    if (isFirstTime) {
      log.log(`[qums-login] initializing silent baseline for user ${userId} (QID ${p.qid})...`);
      catchup.initializeSilentBaseline(userId, sessionPath, log).catch((e) => {
        log.log(`[qums-login] background baseline error: ${e.message}`);
      });
    } else {
      log.log(`[qums-login] running reconnect catch-up for user ${userId} (QID ${p.qid})...`);
      catchup.runReconnectCatchup(userId, sessionPath, log).catch((e) => {
        log.log(`[qums-login] background reconnect catch-up error: ${e.message}`);
      });
    }
  } catch (err) {
    log.log(`[qums-login] baseline/catch-up deferred: ${err.message}`);
  }

  return { ok: true, sessionPath, studentName: profile.studentName || '', yearSem: profile.yearSem || '' };
}

/**
 * Persist the QID + session path + encrypted password for the user.
 */
async function completeQumsSetup(userId, qid, { password, confirmSwitch = false } = {}) {
  const user = await db.getUserById(userId);
  const isDifferentQid = Boolean(user && user.qumsQid && user.qumsQid !== qid);
  const isFirstTime = !user || (!user.monitoringStartedDate && !user.monitoringStartedAt) || isDifferentQid;

  const sessionPath = db.sessionPathFor(userId);
  let sessionData = '';
  try {
    if (fs.existsSync(sessionPath)) {
      sessionData = fs.readFileSync(sessionPath, 'utf8');
    }
  } catch {}

  const patch = {
    qumsQid: String(qid || '').trim(),
    qumsSessionPath: sessionPath,
    qumsSessionStatus: 'active',
  };
  if (sessionData) {
    try {
      patch.qumsSessionData = encryptSecret(sessionData);
    } catch {
      patch.qumsSessionData = sessionData;
    }
  }

  if (password && String(password).trim() !== '') {
    try {
      patch.qumsPasswordEncrypted = encryptSecret(String(password).trim());
    } catch (err) {
      console.error('[qums-login] password encryption failed:', err.message);
    }
  } else if (user && user.qumsPasswordEncrypted) {
    patch.qumsPasswordEncrypted = user.qumsPasswordEncrypted;
  }

  if (isFirstTime) {
    patch.monitoringStartedDate = db.getIstDateString();
    patch.monitoringStartedAt = new Date().toISOString();
  }

  await db.updateUser(userId, patch);
  await db.switchQumsIdentity(userId, qid, {
    monitoringStartedDate: patch.monitoringStartedDate || (user && user.monitoringStartedDate) || db.getIstDateString(),
  });
  return db.getUserById(userId);
}

function hasPendingLogin(userId) {
  return pending.has(userId);
}

module.exports = {
  ConcurrentLoginError,
  startQumsLogin,
  submitQumsCaptcha,
  completeQumsSetup,
  hasPendingLogin,
  disposePending,
  isConcurrentBrowserActive,
};
