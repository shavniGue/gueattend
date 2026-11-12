/**
 * Module 2: College ERP (QUMS) Headless Browser Relay & CAPTCHA Solving
 * gueattend - Playwright Headless Chromium Engine with Human-in-the-Loop CAPTCHA Stream
 *
 * Supports:
 *   1. First-time login: QID + Password + Live CAPTCHA Stream
 *   2. 1-Click Reconnect: Vaulted AES-256 password auto-fill + Live CAPTCHA Stream
 *   3. Multi-college configurable selectors (Quantum QUMS, Graphic Era, TCS iON, CollPoll)
 *   4. Zero RAM leak: 3-minute auto-termination worker
 *   5. POSIX 0600 session cookie vault
 */

const { chromium } = require('playwright');
const cryptoVault = require('./crypto');
const credentials = require('./credentials');
const db = require('./database/db');

// ====================================================================
// CONFIGURABLE COLLEGE SELECTORS & TARGET SETTINGS
// ====================================================================
const ALLOW_PORTAL_SIMULATION = String(process.env.ALLOW_PORTAL_SIMULATION || '').toLowerCase() === 'true';

const COLLEGE_CONFIG = {
  loginUrl: process.env.COLLEGE_LOGIN_URL || 'https://student.geu.ac.in/N0j5Ha0',
  dashboardUrlMatch: process.env.COLLEGE_DASHBOARD_MATCH || '/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6',
  selectors: {
    username:
      process.env.COLLEGE_SEL_USER ||
      'input[placeholder*="User ID"], #mat-input-0, #txtUserName, input[name="txtUserName"], #txtEmail, #username, input[name="username"]',
    password:
      process.env.COLLEGE_SEL_PASS ||
      'input[placeholder*="Password"], #mat-input-1, #txtPassword, input[name="txtPassword"], #password, input[name="password"]',
    captchaImg:
      process.env.COLLEGE_SEL_CAPTCHA_IMG ||
      'img[alt*="CAPTCHA"], img[alt*="captcha"], #imgCaptcha, #img_captcha, img[src*="captcha"], img.captcha',
    captchaInput:
      process.env.COLLEGE_SEL_CAPTCHA_INPUT ||
      'input[placeholder*="text shown above"], #mat-input-2, #txtCaptcha, input[name="txtCaptcha"], #captcha, input[name="captcha"]',
    submitBtn:
      process.env.COLLEGE_SEL_SUBMIT ||
      'button[type="submit"], #btnSubmit, #btnLogin, input[type="submit"]',
    errorMessage:
      process.env.COLLEGE_SEL_ERROR ||
      '#lblMessage, .mat-mdc-snack-bar-label, .alert-danger, .error-message, [role="alert"]',
  },
  cookieNames: ['ASP.NET_SessionId', 'PHPSESSID', 'JSESSIONID', 'QUMS_AUTH_TOKEN'],
  timeoutMs: Number(process.env.COLLEGE_BROWSER_TIMEOUT_MS) || 15000,
};

// In-Memory Active Relay Browsers (userId -> session object)
// 3-minute TTL to prevent RAM leaks
const pendingSessions = new Map();

// In-memory fallback challenge store (for offline / test simulations)
const fallbackChallenges = new Map();

/**
 * Safely close browser and remove from pending map
 */
async function cleanupPending(userId) {
  const session = pendingSessions.get(userId);
  if (session) {
    if (session.timer) clearTimeout(session.timer);
    try {
      if (session.page && !session.page.isClosed()) await session.page.close().catch(() => {});
      if (session.context) await session.context.close().catch(() => {});
      if (session.browser) await session.browser.close().catch(() => {});
    } catch (err) {}
    pendingSessions.delete(userId);
    console.log(`[qums-relay] Cleaned up headless browser for student ${userId}.`);
  }
}

/**
 * Generate simulated high-fidelity visual CAPTCHA (used when external college portal is offline)
 */
function generateFallbackCaptcha(userId, qid) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let text = '';
  for (let i = 0; i < 5; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="50" viewBox="0 0 160 50">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <path d="M10,25 Q40,5 80,25 T150,25" stroke="#94a3b8" stroke-width="2" fill="none"/>
      <path d="M5,15 Q50,45 100,15 T155,35" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
      <text x="50%" y="60%" font-family="monospace" font-size="28" font-weight="900" fill="#047857" text-anchor="middle" dominant-baseline="middle" letter-spacing="6">
        ${text}
      </text>
    </svg>
  `.trim();

  const base64Image = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const challengeId = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  fallbackChallenges.set(userId, {
    challengeId,
    text: text.toUpperCase(),
    qid,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return {
    challengeId,
    captchaImage: base64Image,
    isFallback: true,
  };
}

/**
 * 1. Start QUMS Login / Captcha Stream
 * Launches Headless Chromium with Playwright, navigates to college portal, fills credentials,
 * takes screenshot of visual CAPTCHA, and streams it to the user.
 */
async function startQumsLogin({ userId, qid = '', password = '', isReconnect = false, previewOnly = false }) {
  // If reconnecting, retrieve and decrypt password from AES-256-GCM vault
  let effectiveQid = qid;
  let effectivePassword = password;

  if (isReconnect) {
    const user = await db.getUserById(userId);
    if (!user || !user.qums_password_encrypted) {
      throw new Error('No vaulted ERP credentials found. Please perform initial setup first.');
    }
    effectivePassword = cryptoVault.decrypt(user.qums_password_encrypted);
    effectiveQid = effectiveQid || user.qums_qid || '';
    if (!effectivePassword) {
      throw new Error('Failed to decrypt vaulted ERP password. Key mismatch.');
    }
  } else if (!previewOnly && !password) {
    const user = await db.getUserById(userId);
    if (user && user.qums_password_encrypted) {
      effectivePassword = cryptoVault.decrypt(user.qums_password_encrypted) || '';
      effectiveQid = effectiveQid || user.qums_qid || '';
    }
  }

  // Clean any existing pending session for this user
  await cleanupPending(userId);

  try {
    console.log(`[qums-relay] Launching Playwright Chromium for user ${userId} (reconnect: ${isReconnect})...`);

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Navigate to college login URL and wait for Angular/DOM CAPTCHA rendering
    await page.goto(COLLEGE_CONFIG.loginUrl, {
      waitUntil: 'networkidle',
      timeout: COLLEGE_CONFIG.timeoutMs,
    }).catch(() =>
      page.goto(COLLEGE_CONFIG.loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: COLLEGE_CONFIG.timeoutMs,
      })
    );

    await page.waitForSelector(COLLEGE_CONFIG.selectors.captchaImg, { timeout: 8000 }).catch(() => {});

    // Fill username and password into portal form fields if provided
    const userLoc = page.locator(COLLEGE_CONFIG.selectors.username).first();
    const passLoc = page.locator(COLLEGE_CONFIG.selectors.password).first();

    if (effectiveQid && effectivePassword && await userLoc.count() > 0 && await passLoc.count() > 0) {
      await userLoc.fill(effectiveQid);
      await passLoc.fill(effectivePassword);
      console.log(`[qums-relay] Form fields pre-filled for student GUeID: ${effectiveQid}`);
    }

    // Capture screenshot of live visual CAPTCHA element
    const captchaLoc = page.locator(COLLEGE_CONFIG.selectors.captchaImg).first();
    let captchaBase64 = null;

    if (await captchaLoc.count() > 0) {
      const buffer = await captchaLoc.screenshot();
      captchaBase64 = `data:image/png;base64,${buffer.toString('base64')}`;
      console.log(`[qums-relay] Captured live visual CAPTCHA screenshot (${buffer.length} bytes).`);
    } else if (ALLOW_PORTAL_SIMULATION) {
      const fallback = generateFallbackCaptcha(userId, effectiveQid);
      captchaBase64 = fallback.captchaImage;
    } else {
      await browser.close().catch(() => {});
      throw new Error('Could not find live CAPTCHA image on student.geu.ac.in. Please try again.');
    }

    // Set 3-minute auto-termination timer
    const timer = setTimeout(() => {
      console.log(`[qums-relay] 3-minute TTL reached. Auto-closing browser for ${userId}.`);
      cleanupPending(userId);
    }, 3 * 60 * 1000);

    // Save active browser session in memory
    pendingSessions.set(userId, {
      browser,
      context,
      page,
      qid: effectiveQid,
      password: effectivePassword,
      isReconnect,
      startedAt: Date.now(),
      timer,
    });

    return {
      ok: true,
      success: true,
      challengeId: `relay_${userId}_${Date.now()}`,
      captcha: captchaBase64,
      captchaImage: captchaBase64,
      isReconnect,
      expiresInSeconds: 180,
    };
  } catch (err) {
    if (!ALLOW_PORTAL_SIMULATION) {
      console.warn(`[qums-relay] Live portal CAPTCHA unavailable (${err.message}).`);
      return {
        ok: false,
        success: false,
        error: 'Unable to load live CAPTCHA from student.geu.ac.in right now. Please try again.',
      };
    }

    console.warn(`[qums-relay] Simulation mode fallback enabled (${err.message}).`);
    const fallback = generateFallbackCaptcha(userId, effectiveQid);

    // Store credentials in fallback pending
    pendingSessions.set(userId, {
      browser: null,
      context: null,
      page: null,
      qid: effectiveQid,
      password: effectivePassword,
      isReconnect,
      isFallback: true,
      startedAt: Date.now(),
      timer: setTimeout(() => cleanupPending(userId), 3 * 60 * 1000),
    });

    return {
      ok: true,
      success: true,
      challengeId: fallback.challengeId,
      captcha: fallback.captchaImage,
      captchaImage: fallback.captchaImage,
      isReconnect,
      expiresInSeconds: 180,
    };
  }
}

/**
 * 2. Submit Human-Solved CAPTCHA
 * Submits student's solved CAPTCHA to the active Playwright session, checks login outcome,
 * extracts session cookies, encrypts password in PostgreSQL, and closes the browser.
 */
async function submitQumsCaptcha({ userId, captchaAnswer, captchaText, qid, password }) {
  const answer = String(captchaAnswer || captchaText || '').trim();
  if (!answer) {
    throw new Error('Please enter the CAPTCHA answer.');
  }

  const session = pendingSessions.get(userId);
  if (!session) {
    throw new Error('Login session timed out or not started. Please reload the CAPTCHA.');
  }

  if (qid) session.qid = String(qid).trim();
  if (password) session.password = password;

  // --- PATH A: Real Headless Browser Active ---
  if (session.page && !session.page.isClosed()) {
    try {
      console.log(`[qums-relay] Submitting CAPTCHA "${answer}" into active portal page for ${userId}...`);

      if (session.qid && session.password) {
        const userLoc = session.page.locator(COLLEGE_CONFIG.selectors.username).first();
        const passLoc = session.page.locator(COLLEGE_CONFIG.selectors.password).first();
        if (await userLoc.count() > 0 && await passLoc.count() > 0) {
          await userLoc.fill(session.qid);
          await passLoc.fill(session.password);
        }
      }

      const captchaInputLoc = session.page.locator(COLLEGE_CONFIG.selectors.captchaInput).first();
      const submitBtnLoc = session.page.locator(COLLEGE_CONFIG.selectors.submitBtn).first();

      await captchaInputLoc.fill(answer);
      await Promise.all([
        session.page.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {}),
        submitBtnLoc.click().catch(() => {}),
      ]);

      const currentUrl = session.page.url();
      console.log(`[qums-relay] Post-submit URL: ${currentUrl}`);

      // Check if login failed (error message or stayed on login page)
      const errLoc = session.page.locator(COLLEGE_CONFIG.selectors.errorMessage).first();
      const hasErrorText = (await errLoc.count()) > 0 ? await errLoc.textContent().catch(() => '') : '';

      const isStillOnLogin = currentUrl.includes('N0j5Ha0') || currentUrl.includes('login') || currentUrl.includes('Login');

      if (isStillOnLogin) {
        const turnstileVal = await session.page
          .locator('input[name="cf-turnstile-response"]')
          .first()
          .inputValue()
          .catch(() => null);
        const turnstileMsg = turnstileVal === ''
          ? 'College portal anti-bot verification (Cloudflare Turnstile) is active on student.geu.ac.in; automated login cannot proceed.'
          : '';
        console.warn(`[qums-relay] Login did not advance past login URL: ${(hasErrorText || turnstileMsg || 'invalid credentials or CAPTCHA').trim()}`);

        const captchaLoc = session.page.locator(COLLEGE_CONFIG.selectors.captchaImg).first();
        let newCaptchaBase64 = null;
        if ((await captchaLoc.count()) > 0) {
          const buf = await captchaLoc.screenshot();
          newCaptchaBase64 = `data:image/png;base64,${buf.toString('base64')}`;
        }

        return {
          ok: false,
          success: false,
          error: (hasErrorText && hasErrorText.trim()) || turnstileMsg || 'Invalid GUeID, password, or CAPTCHA code.',
          refreshCaptcha: true,
          captcha: newCaptchaBase64,
          captchaImage: newCaptchaBase64,
        };
      }

      // Success: Extract session cookies from browser context
      const cookies = await session.context.cookies();
      console.log(`[qums-relay] Successfully captured ${cookies.length} session cookies from university portal!`);

      // Save cookies to disk with POSIX mode 0600 (owner-only)
      const sessionPath = credentials.saveSessionCookies(userId, cookies, {
        qid: session.qid,
        connectedAt: new Date().toISOString(),
      });

      // Encrypt user password in AES-256-GCM vault
      const encryptedPassword = cryptoVault.encrypt(session.password);

      // Persist in Supabase PostgreSQL
      await db.query(
        `UPDATE users SET 
          qums_qid = $1,
          qums_password_encrypted = $2,
          qums_session_path = $3,
          qums_session_status = 'connected',
          qums_session_data = $4,
          updated_at = NOW()
         WHERE id = $5`,
        [session.qid, encryptedPassword, sessionPath, JSON.stringify(cookies), userId]
      );

      // Record reconnect / sync event
      await db.query(
        `INSERT INTO reconnect_events (user_id, source, reconnected_at) VALUES ($1, $2, NOW())`,
        [userId, session.isReconnect ? 'reconnect' : 'initial_setup']
      );

      // Close browser cleanly
      await cleanupPending(userId);

      return {
        ok: true,
        success: true,
        message: 'Successfully connected to Graphic Era University portal!',
        qid: session.qid,
        redirect: '/dashboard',
      };
    } catch (err) {
      console.error('[qums-relay] Submit error:', err.message);
      await cleanupPending(userId);
      throw err;
    }
  }

  // --- PATH B: Explicit Test Simulation Only ---
  if (!ALLOW_PORTAL_SIMULATION) {
    await cleanupPending(userId);
    throw new Error('Live GEU portal browser session is required. Reload CAPTCHA and try again.');
  }
  const challenge = fallbackChallenges.get(userId);
  if (challenge) {
    if (Date.now() > challenge.expiresAt) {
      throw new Error('CAPTCHA challenge timed out.');
    }
    if (answer.toUpperCase() !== challenge.text) {
      // Regenerate fresh captcha
      const fresh = generateFallbackCaptcha(userId, session.qid);
      return {
        ok: false,
        success: false,
        error: 'Incorrect CAPTCHA answer. Please try again.',
        refreshCaptcha: true,
        captcha: fresh.captchaImage,
        captchaImage: fresh.captchaImage,
      };
    }
    fallbackChallenges.delete(userId);
  }

  // Generate authentic simulated session cookies
  const cookies = [
    {
      name: 'ASP.NET_SessionId',
      value: `geu_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      domain: '.geu.ac.in',
      path: '/',
      httpOnly: true,
      secure: true,
    },
    {
      name: 'QUMS_AUTH_TOKEN',
      value: `tok_${session.qid}_${Date.now()}`,
      domain: '.geu.ac.in',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ];

  const sessionPath = credentials.saveSessionCookies(userId, cookies, { qid: session.qid });
  const encryptedPassword = cryptoVault.encrypt(session.password);

  await db.query(
    `UPDATE users SET 
      qums_qid = $1,
      qums_password_encrypted = $2,
      qums_session_path = $3,
      qums_session_status = 'connected',
      qums_session_data = $4,
      updated_at = NOW()
     WHERE id = $5`,
    [session.qid, encryptedPassword, sessionPath, JSON.stringify(cookies), userId]
  );

  await db.query(
    `INSERT INTO reconnect_events (user_id, source, reconnected_at) VALUES ($1, $2, NOW())`,
    [userId, session.isReconnect ? 'reconnect' : 'initial_setup']
  );

  await cleanupPending(userId);

  return {
    ok: true,
    success: true,
    message: 'Successfully connected to Graphic Era University portal!',
    qid: session.qid,
    redirect: '/dashboard',
  };
}

/**
 * 3. 1-Click Session Reconnect
 * Uses vaulted AES-256 password; only prompts student for fresh CAPTCHA
 */
async function reconnectQumsSession({ userId, captchaAnswer, captchaText, source = 'web' }) {
  const outcome = await submitQumsCaptcha({
    userId,
    captchaAnswer: captchaAnswer || captchaText,
  });

  // Track analytics for web vs telegram reconnect
  const column = source === 'telegram' ? 'reconnect_count_telegram' : 'reconnect_count_web';
  await db.query(
    `UPDATE users SET 
      ${column} = COALESCE(${column}, 0) + 1,
      last_reconnect_source = $1,
      last_reconnected_at = NOW()
     WHERE id = $2`,
    [source, userId]
  ).catch(() => {});

  return outcome;
}

/**
 * Wrapper for backward compatibility with GET /api/qums/captcha
 */
async function getVisualCaptcha(userId) {
  // Check if student has vaulted credentials for reconnect
  const user = await db.getUserById(userId).catch(() => null);
  const isReconnect = Boolean(user && user.qums_password_encrypted);
  return startQumsLogin({
    userId,
    qid: user?.qums_qid || '',
    isReconnect,
    previewOnly: !isReconnect,
  });
}

module.exports = {
  COLLEGE_CONFIG,
  startQumsLogin,
  submitQumsCaptcha,
  reconnectQumsSession,
  getVisualCaptcha,
  cleanupPending,
};
