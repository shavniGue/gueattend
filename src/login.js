/**
 * QUMS login form helpers — shared by the HEADLESS web captcha relay
 * (src/qums-login-web.js): captcha image web dashboard pe dikhti hai, user
 * wahan type karta hai, backend headless Chromium me submit karta hai.
 * Koi visible browser window nahi khulti — VPS/headless deployment-safe.
 *
 * (Purana headful `npm run login` CLI flow hata diya gaya hai — ab captcha
 * hamesha web dashboard se solve hota hai.)
 */

function isLoginLikeUrl(urlString) {
  try {
    const { pathname } = new URL(urlString);
    const p = pathname.toLowerCase();
    if (p === '/' || p === '' || p === '/#' || p.endsWith('/index.aspx') || p.endsWith('/default.aspx')) {
      return true;
    }
    return p.includes('login');
  } catch {
    return false;
  }
}

/**
 * The login form may be rendered in the main frame or inside an iframe.
 * Return the first frame that has BOTH a text input and a password input.
 */
async function findLoginForm(page) {
  for (const frame of page.frames()) {
    try {
      const [userCount, passCount] = await Promise.all([
        frame.locator('input[formcontrolname="UserID" i], input[type="text"], input[placeholder*="User ID" i]').count(),
        frame.locator('input[formcontrolname="Password" i], input[type="password"]').count(),
      ]);
      if (userCount > 0 && passCount > 0) return frame;
    } catch {
      /* frame detached mid-check — skip */
    }
  }
  return page.mainFrame();
}

/**
 * Fill User ID + password, leaving the captcha input untouched for the user.
 * The User ID field is picked by formcontrolname/name/id/placeholder hints,
 * skipping hidden honeypot fields.
 * NOTE: no credential value is ever printed to the console.
 */
async function autofillCredentials(frame, qid, password) {
  let qidInput = null;
  const fastQid = frame.locator('input[formcontrolname="UserID" i], input#UserName, input[name="UserName" i], input[placeholder*="User ID" i]');
  if ((await fastQid.count().catch(() => 0)) > 0) {
    qidInput = fastQid.first();
  }

  if (!qidInput) {
    const textInputs = frame.locator('input[type="text"], input:not([type])');
    const textCount = await textInputs.count();
    for (let i = 0; i < textCount; i++) {
      const el = textInputs.nth(i);
      const isVisible = await el.isVisible().catch(() => false);
      if (!isVisible) continue;
      const attrs = [
        await el.getAttribute('name'),
        await el.getAttribute('id'),
        await el.getAttribute('placeholder'),
        await el.getAttribute('formcontrolname'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/website|honeypot/.test(attrs)) continue;
      if (/qid|user|loginid|login_id|regd|roll|empid/.test(attrs)) {
        qidInput = el;
        break;
      }
    }
    if (!qidInput && textCount > 0) {
      for (let i = 0; i < textCount; i++) {
        const el = textInputs.nth(i);
        if (await el.isVisible().catch(() => false)) {
          const fc = (await el.getAttribute('formcontrolname') || '').toLowerCase();
          if (fc !== 'website') {
            qidInput = el;
            break;
          }
        }
      }
    }
  }

  if (!qidInput) {
    throw new Error('No User ID input found on the login form — portal markup may have changed.');
  }

  const passwordInput = frame.locator('input[formcontrolname="Password" i], input[type="password"]').first();

  await qidInput.waitFor({ state: 'visible', timeout: 15000 });
  await qidInput.fill(qid);
  await passwordInput.fill(password);

  console.log('[+] User ID + password auto-filled. Captcha field left empty for you.');
}

/**
 * Locate the captcha text input: prefer formcontrolname/name/id/placeholder matching /captcha/i.
 */
async function locateCaptchaInput(frame) {
  const fastCaptcha = frame.locator('input[formcontrolname="CaptchaText" i], input#captcha, input[name="captcha" i], input[placeholder*="text shown above" i], input.captcha');
  if ((await fastCaptcha.count().catch(() => 0)) > 0) {
    return fastCaptcha.first();
  }
  const textInputs = frame.locator('input[type="text"], input:not([type])');
  const count = await textInputs.count();
  for (let i = 0; i < count; i++) {
    const el = textInputs.nth(i);
    const isVis = await el.isVisible().catch(() => false);
    if (!isVis) continue;
    const attrs = [
      await el.getAttribute('name'),
      await el.getAttribute('id'),
      await el.getAttribute('placeholder'),
      await el.getAttribute('formcontrolname'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/captcha/.test(attrs)) return el;
  }
  if (count === 0) throw new Error('No captcha/text input found on the login form.');
  return textInputs.nth(count - 1);
}

/**
 * Click the login/submit button: submit input/button, or one labelled Login.
 */
async function clickLoginButton(frame) {
  const candidates = [
    frame.locator('button[type="submit"]').first(),
    frame.getByRole('button', { name: /login|sign in/i }).first(),
    frame.locator('button.btnSubmit').first(),
    frame.locator('input[type="submit"]').first(),
    frame.locator('a', { hasText: /login|sign in/i }).first(),
  ];
  for (const c of candidates) {
    try {
      if ((await c.count()) > 0 && (await c.isVisible())) {
        await c.click();
        return;
      }
    } catch {
      /* try next candidate */
    }
  }
  throw new Error('Login button not found on the login form.');
}

/**
 * Screenshot the captcha image element -> base64 data URL (web login flow me
 * user ko dikhane ke liye).
 */
async function captureCaptchaImage(page, frame) {
  await frame.waitForSelector('img[alt*="CAPTCHA" i], img[src^="data:image"], img#imgPhoto, img[src*="captcha" i]', { timeout: 15000 }).catch(() => {});
  const imgs = frame.locator('img');
  const n = await imgs.count();
  if (n === 0) throw new Error('No <img> found for the captcha on the login form.');

  let chosen = null;
  const fastImg = frame.locator('img[alt*="CAPTCHA" i], img[src^="data:image/"], img#imgPhoto, img[src*="captcha" i], img[id*="captcha" i]');
  const fastCount = await fastImg.count().catch(() => 0);
  if (fastCount > 0) {
    chosen = fastImg.first();
  }

  if (!chosen) {
    for (let i = 0; i < n; i++) {
      const el = imgs.nth(i);
      const attrs = [
        await el.getAttribute('src'),
        await el.getAttribute('id'),
        await el.getAttribute('name'),
        await el.getAttribute('alt'),
        await el.getAttribute('class'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/captcha/.test(attrs)) {
        chosen = el;
        break;
      }
    }
  }

  if (!chosen) {
    // fallback: imgs with a real size (skip icons/spacers), pick the widest that looks text-ish
    let best = null;
    let bestW = 0;
    for (let i = 0; i < n; i++) {
      const el = imgs.nth(i);
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width >= 80 && box.width <= 400 && box.height >= 25 && box.height <= 120) {
        if (box.width > bestW) {
          best = el;
          bestW = box.width;
        }
      }
    }
    chosen = best || imgs.nth(n - 1);
  }

  try {
    await chosen.waitFor({ state: 'visible', timeout: 10000 });
    // Ensure src attribute is populated with valid image data (not empty and not whitey placeholder)
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const src = await chosen.getAttribute('src').catch(() => '');
      if (src && !src.includes('whitey.jpg') && (src.startsWith('data:image/') || src.startsWith('http') || src.startsWith('/'))) {
        break;
      }
      await (page || frame).waitForTimeout(200);
    }
    await chosen.scrollIntoViewIfNeeded();
  } catch {}
  const buf = await chosen.screenshot({ type: 'png' });
  const rawBase64 = `data:image/png;base64,${buf.toString('base64')}`;

  // Pad the captcha image onto a clean canvas with generous margins so mobile Telegram
  // (especially Android) never clips the letters on the left or right edges.
  try {
    const pageOrFrame = page || frame;
    if (pageOrFrame && typeof pageOrFrame.evaluate === 'function') {
      const padded = await pageOrFrame.evaluate((srcUrl) => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(null), 1500);
          const img = new Image();
          img.onload = () => {
            clearTimeout(timeout);
            const w = img.naturalWidth || img.width || 180;
            const h = img.naturalHeight || img.height || 45;
            const scale = 2; // 2x sharp display
            const padX = 65; // safe horizontal margin so Android Telegram rounded bubbles never clip the edge letters
            const padY = 28; // safe vertical margin so Telegram bottom-right timestamp badge never covers the captcha text
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale + padX * 2);
            canvas.height = Math.round(h * scale + padY * 2);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, padX, padY, w * scale, h * scale);
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = () => {
            clearTimeout(timeout);
            resolve(null);
          };
          img.src = srcUrl;
        });
      }, rawBase64).catch(() => null);

      if (padded && typeof padded === 'string' && padded.startsWith('data:image/png;base64,')) {
        return padded;
      }
    }
  } catch {}

  return rawBase64;
}

module.exports = {
  isLoginLikeUrl,
  findLoginForm,
  autofillCredentials,
  locateCaptchaInput,
  clickLoginButton,
  captureCaptchaImage,
};
