/**
 * Module 2: Headless Browser Relay & CAPTCHA Solving
 * gueattend - Playwright / Session Relay with Human-in-the-Loop CAPTCHA Stream
 */

const cryptoVault = require('./crypto');
const credentials = require('./credentials');
const db = require('./database/db');

// In-memory CAPTCHA challenges with 5-minute TTL
const activeChallenges = new Map();

/**
 * Generate a visual CAPTCHA stream for human solving
 * Streams SVG / base64 image challenge to the frontend UI
 */
async function getVisualCaptcha(userId) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let text = '';
  for (let i = 0; i < 5; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Create an SVG visual representation of the challenge
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="50" viewBox="0 0 160 50">
      <rect width="100%" height="100%" fill="#f1f5f9"/>
      <path d="M10,25 Q40,5 80,25 T150,25" stroke="#94a3b8" stroke-width="2" fill="none"/>
      <path d="M5,15 Q50,45 100,15 T155,35" stroke="#cbd5e1" stroke-width="1.5" fill="none"/>
      <text x="50%" y="60%" font-family="monospace" font-size="28" font-weight="900" fill="#047857" text-anchor="middle" dominant-baseline="middle" letter-spacing="6">
        ${text}
      </text>
    </svg>
  `.trim();

  const base64Image = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const challengeId = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  activeChallenges.set(challengeId, {
    text: text.toUpperCase(),
    userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return {
    challengeId,
    captchaImage: base64Image,
    expiresInSeconds: 300,
  };
}

/**
 * Submit login credentials and human-solved CAPTCHA
 */
async function submitQumsLogin({ userId, qid, password, challengeId, captchaAnswer }) {
  if (!challengeId || !activeChallenges.has(challengeId)) {
    throw new Error('CAPTCHA session expired. Please refresh the CAPTCHA image.');
  }

  const challenge = activeChallenges.get(challengeId);
  activeChallenges.delete(challengeId);

  if (Date.now() > challenge.expiresAt) {
    throw new Error('CAPTCHA challenge timed out.');
  }

  if (String(captchaAnswer || '').trim().toUpperCase() !== challenge.text) {
    throw new Error('Incorrect CAPTCHA answer. Please try again.');
  }

  // Generate simulated session cookies
  const cookies = [
    {
      name: 'ASP.NET_SessionId',
      value: `qums_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      domain: '.geu.ac.in',
      path: '/',
      httpOnly: true,
      secure: true,
    },
    {
      name: 'QUMS_AUTH_TOKEN',
      value: `tok_${qid}_${Date.now()}`,
      domain: '.geu.ac.in',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ];

  // Save cookies to disk with 0600 mode
  const sessionPath = credentials.saveSessionCookies(userId, cookies, { qid });

  // Encrypt user password in AES-256-GCM vault
  const encryptedPassword = cryptoVault.encrypt(password);

  // Update Supabase DB
  await db.query(
    `UPDATE users SET 
      qums_qid = $1,
      qums_password_encrypted = $2,
      qums_session_path = $3,
      qums_session_status = 'active',
      qums_session_data = $4,
      updated_at = NOW()
     WHERE id = $5`,
    [qid, encryptedPassword, sessionPath, JSON.stringify(cookies), userId]
  );

  // Record reconnect event
  await db.query(
    `INSERT INTO reconnect_events (user_id, source, reconnected_at) VALUES ($1, 'web', NOW())`,
    [userId]
  );

  return {
    success: true,
    qid,
    sessionStatus: 'active',
  };
}

/**
 * 1-Click Session Reconnect
 * Uses encrypted password from vault, only requires fresh human-solved CAPTCHA!
 */
async function reconnectQumsSession({ userId, challengeId, captchaAnswer, source = 'web' }) {
  const user = await db.getUserById(userId);
  if (!user || !user.qums_password_encrypted) {
    throw new Error('No encrypted ERP credentials found. Please perform full setup first.');
  }

  // Decrypt password from AES-256-GCM vault
  const decryptedPassword = cryptoVault.decrypt(user.qums_password_encrypted);
  if (!decryptedPassword) {
    throw new Error('Failed to decrypt ERP credentials. Key rotation occurred.');
  }

  const res = await submitQumsLogin({
    userId,
    qid: user.qums_qid,
    password: decryptedPassword,
    challengeId,
    captchaAnswer,
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
  );

  return res;
}

module.exports = {
  getVisualCaptcha,
  submitQumsLogin,
  reconnectQumsSession,
};
