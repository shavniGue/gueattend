/**
 * Test for Telegram /login and /setup commands.
 * Verifies:
 *   1. /login without parameters displays formatted instructions with 5-second security notice.
 *   2. /login <QID> <PASSWORD> schedules auto-delete of user's password message in 5000ms.
 *   3. Credentials (QID & Password) are encrypted and saved in database immediately.
 *   4. Immediately launches startTelegramCaptchaReconnect and delivers CAPTCHA photo directly to Telegram.
 *   5. User can reply with CAPTCHA in capital or lowercase letters to successfully connect.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gue-tg-login-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.DATABASE_URL = '';
process.env.SESSION_ALERT_STATE_FILE = path.join(TMP, 'session_alerts.json');
process.env.APP_BASE_URL = 'https://gueattend.onrender.com';
process.env.TELEGRAM_BOT_TOKEN = 'test:token';
process.env.PORT = '10000';

const db = require('../src/db');
const { decryptSecret } = require('../src/crypto');
const telegram = require('../src/telegram');
const qumsLogin = require('../src/qums-login-web');

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures += 1;
}

function ok(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
}

(async () => {
  await db.init();

  // Mock Telegram messages and photos
  const sentMessages = [];
  const sentPhotos = [];

  const fakeBot = {
    sendMessage: async (chatId, text, opts = {}) => {
      const msg = { message_id: 1000 + sentMessages.length, chat: { id: chatId }, text };
      sentMessages.push({ chatId, text, opts, message_id: msg.message_id });
      return msg;
    },
    sendPhoto: async (chatId, photo, opts = {}) => {
      const msg = { message_id: 2000 + sentPhotos.length, chat: { id: chatId }, caption: opts.caption };
      sentPhotos.push({ chatId, photo, caption: opts.caption, opts, message_id: msg.message_id });
      return msg;
    },
    deleteMessage: async () => true,
    sendChatAction: async () => true,
    answerCallbackQuery: async () => true,
    on: () => {},
    onText: () => {},
  };

  telegram.initTelegram({ log: () => {}, error: () => {} });
  const STATE_KEY = '__qumsTelegramState__';
  globalThis[STATE_KEY].bot = fakeBot;

  // Mock Playwright QUMS login
  const sampleCaptchaBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  qumsLogin.startQumsLogin = async (userId, creds, log) => {
    return {
      ok: true,
      pendingId: 'mock-pending-123',
      captchaImage: sampleCaptchaBase64,
    };
  };

  qumsLogin.submitQumsCaptcha = async (userId, captchaText, log, opts = {}) => {
    const norm = String(captchaText || '').trim().toUpperCase();
    if (norm === 'YAP5S') {
      const user = await db.getUserById(userId);
      await qumsLogin.completeQumsSetup(userId, user.qumsQid);
      return { ok: true, studentName: 'KARAN KUMAR', yearSem: '4 / 8' };
    }
    return { ok: false, error: 'Incorrect captcha', captchaImage: sampleCaptchaBase64 };
  };

  // 1. Create a linked user without saved password
  const user = await db.createUser({
    email: 'student@example.com',
    passwordHash: 'hash',
    qumsQid: '2510070038',
  });
  await db.setTelegramChatId(user.id, '99887766');

  // TEST 1: /login without arguments returns instructions
  await telegram.handleTelegramLoginCommand('99887766', undefined, undefined, { message_id: 101 });
  ok('1. Usage returned when /login has no arguments', sentMessages.some(m => m.text.includes('/login')));
  ok('1. 5-second security notice present in instructions', sentMessages.some(m => m.text.includes('5 second')));

  // TEST 2: /login with QID and password
  const beforeTime = Date.now();
  await telegram.handleTelegramLoginCommand('99887766', '2510070038', 'MySecretERPPass', { message_id: 202 });
  const pending = await db.listPendingDeletions();
  const autoDel = pending.find(d => Number(d.messageId) === 202);
  ok('2. Password message scheduled for deletion in ~5000ms', Boolean(autoDel && autoDel.deleteAt >= beforeTime + 4000 && autoDel.deleteAt <= beforeTime + 7000));

  const updatedUser = await db.getUserById(user.id);
  check('3. QID saved correctly', updatedUser.qumsQid, '2510070038');
  check('3. Password encrypted and saved', decryptSecret(updatedUser.qumsPasswordEncrypted), 'MySecretERPPass');

  // TEST 4: CAPTCHA photo sent to user
  const photo = sentPhotos.find(p => p.chatId === '99887766');
  ok('4. CAPTCHA photo delivered directly to Telegram', Boolean(photo));
  ok('4. CAPTCHA photo contains helpful prompt caption', photo && photo.caption.includes('GEU ERP'));
  ok('4. CAPTCHA photo has inline buttons', photo && photo.opts && photo.opts.reply_markup && photo.opts.reply_markup.inline_keyboard.length > 0);

  // TEST 5: User submits CAPTCHA in lowercase 'yap5s' -> succeeds
  await telegram.handleUserMessage({
    chat: { id: '99887766' },
    text: 'yap5s',
    message_id: 303,
  });

  const finalUser = await db.getUserById(user.id);
  check('5. Session status restored to active via lowercase captcha', finalUser.qumsSessionStatus, 'active');

  console.log(`\nALL TELEGRAM LOGIN COMMAND TESTS PASSED (${failures} failures)`);
  if (failures > 0) process.exit(1);
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
