/**
 * gueattend - Smart University Attendance & Timetable System
 * Core Server Application
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');

const db = require('./database/db');
const { PostgresSessionStore } = require('./database/session-store');
const { checkSupabaseHealth } = require('./database/supabase');
const { checkFirebaseHealth } = require('./config/firebase');
const { requireAuth, requireAdmin, requireFaculty } = require('./middleware/auth');
const { attachCsrfCookie, csrfProtection } = require('./middleware/csrf');

// Route modules
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const attendanceRoutes = require('./routes/attendance');
const timetableRoutes = require('./routes/timetable');
const academicsRoutes = require('./routes/academics');
const examsRoutes = require('./routes/exams');
const feesRoutes = require('./routes/fees');
const campusRoutes = require('./routes/campus');
const notificationRoutes = require('./routes/notifications');
const telegramRoutes = require('./routes/telegram');
const qumsRoutes = require('./routes/qums');
const facultyRoutes = require('./routes/faculty');
const adminRoutes = require('./routes/admin');
const { initTelegram, sendTelegramAlert } = require('./telegram');
const { initAutonomousSchedulers } = require('./scheduler');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1);

// HTTP Security Hardening Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://pagead2.googlesyndication.com https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.googleusercontent.com https://pagead2.googlesyndication.com",
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://cnpullmxupyqdndxzbih.supabase.co wss://*.firebaseio.com",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://googleads.g.doubleclick.net",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );
  next();
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// PostgreSQL-Backed Persistent Session Store
const sessionStore = new PostgresSessionStore({
  db,
  ttlSeconds: 90 * 24 * 60 * 60,
});

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev-secret-gueattend-2026-fallback-min-32-chars',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 90 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD ? 'auto' : false,
    },
  })
);

app.use(attachCsrfCookie);
app.use(csrfProtection);

// Protect authenticated HTML pages from direct unauthenticated static access
app.use(['/index.html', '/qums-setup.html', '/telegram-setup.html'], requireAuth);
app.use('/faculty.html', requireFaculty);
app.use('/admin.html', requireAdmin);

// Serve Static Frontend Assets (disable automatic index.html on root so landing page can be served)
app.use(express.static(PUBLIC_DIR, { index: false }));

// ====================================================================
// HEALTH-CHECK ENDPOINT
// ====================================================================
app.get('/health', async (req, res) => {
  const [dbHealth, supabaseHealth] = await Promise.all([
    db.checkDatabaseHealth(),
    checkSupabaseHealth(),
  ]);

  const firebaseHealth = checkFirebaseHealth();
  const isHealthy = dbHealth.isolated && dbHealth.connected && dbHealth.tablesExist;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    application: 'gueattend smart attendance system',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    supabase: supabaseHealth,
    firebase: firebaseHealth,
    telegram: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      polling: String(process.env.TELEGRAM_POLLING || '').toLowerCase() === 'on',
    },
  });
});

// ====================================================================
// FRONTEND PAGE ROUTES (Public SEO + Role-Protected Portals)
// ====================================================================
const sendPage = (fileName) => (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, fileName));
};

app.get('/', (req, res) => {
  if (req.session?.userId) {
    if (req.session.role === 'admin') return res.redirect('/admin');
    if (req.session.role === 'faculty') return res.redirect('/faculty');
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(PUBLIC_DIR, 'landing.html'));
});

app.get('/login', sendPage('login.html'));
app.get('/register', sendPage('register.html'));
app.get('/forgot', sendPage('forgot.html'));
app.get('/privacy-policy', sendPage('privacy-policy.html'));
app.get('/privacy', (req, res) => res.redirect(301, '/privacy-policy'));
app.get('/attendance-calculator-guide', sendPage('attendance-calculator-guide.html'));

app.get('/dashboard', requireAuth, sendPage('index.html'));
app.get(['/qums-setup', '/geu-setup'], requireAuth, sendPage('qums-setup.html'));
app.get('/telegram-setup', requireAuth, sendPage('telegram-setup.html'));
app.get('/faculty', requireFaculty, sendPage('faculty.html'));
app.get('/admin', requireAdmin, sendPage('admin.html'));

// ====================================================================
// SEO & ADSENSE VALIDATION (Public Pages Only)
// ====================================================================
function getAdSenseState() {
  const enabled = !['false', 'off', '0'].includes(String(process.env.ADS_ENABLED || 'true').toLowerCase());
  const clientId = String(process.env.ADSENSE_CLIENT_ID || '').trim();
  const validClientId = /^ca-pub-\d{10,20}$/.test(clientId);
  const pubId = validClientId ? clientId.replace(/^ca-/, '') : '';
  const slots = {
    landing: String(process.env.ADSENSE_SLOT_LANDING || '').trim(),
    guide: String(process.env.ADSENSE_SLOT_GUIDE || '').trim(),
    privacy: String(process.env.ADSENSE_SLOT_PRIVACY || '').trim(),
  };
  return { enabled, clientId, validClientId, pubId, slots };
}

app.get('/robots.txt', (req, res) => {
  const baseUrl = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res
    .type('text/plain')
    .send(
      [
        'User-agent: *',
        'Allow: /',
        'Allow: /attendance-calculator-guide',
        'Allow: /privacy-policy',
        'Allow: /ads.txt',
        'Disallow: /dashboard',
        'Disallow: /admin',
        'Disallow: /faculty',
        'Disallow: /geu-setup',
        'Disallow: /qums-setup',
        'Disallow: /telegram-setup',
        'Disallow: /api/',
        `Sitemap: ${baseUrl}/sitemap.xml`,
        '',
      ].join('\n')
    );
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const urls = [
    { loc: `${baseUrl}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${baseUrl}/attendance-calculator-guide`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${baseUrl}/privacy-policy`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${baseUrl}/login`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${baseUrl}/register`, changefreq: 'monthly', priority: '0.5' },
  ];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`)
      .join('\n') +
    `\n</urlset>\n`;
  res.type('application/xml').send(xml);
});

app.get('/ads.txt', (req, res) => {
  const state = getAdSenseState();
  if (state.validClientId && state.pubId) {
    return res.type('text/plain').send(`google.com, ${state.pubId}, DIRECT, f08c47fec0942fa0\n`);
  }
  return res.type('text/plain').send('# Set valid ADSENSE_CLIENT_ID (ca-pub-xxxxxxxxxxxxxxxx) to publish ads.txt\n');
});

app.get('/api/ads/config', (req, res) => {
  const state = getAdSenseState();
  res.json({
    enabled: state.enabled,
    clientId: state.validClientId ? state.clientId : '',
    slots: state.slots,
  });
});

app.get('/api/ads/validate', (req, res) => {
  const state = getAdSenseState();
  res.json({
    success: true,
    enabled: state.enabled,
    validClientId: state.validClientId,
    adsTxtReady: state.enabled && state.validClientId && Boolean(state.pubId),
    publicPlacements: Object.keys(state.slots),
    configuredSlots: Object.fromEntries(
      Object.entries(state.slots).map(([k, v]) => [k, /^\d+$/.test(v)])
    ),
  });
});

// ====================================================================
// REST API ROUTES
// ====================================================================
app.post('/api/login', authRoutes.handleUserLogin);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/results', examsRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/campus', campusRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/telegram', telegramRoutes);
app.use(['/api/qums', '/api/geu'], qumsRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/admin', adminRoutes);

// ====================================================================
// CENTRALIZED ERROR HANDLING & 404
// ====================================================================
app.use((req, res) => {
  if (res.headersSent) return;
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API route not found.' });
  }
  return res.status(404).redirect('/login');
});

app.use((err, req, res, next) => {
  console.error('[server] Uncaught exception:', err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({
    success: false,
    error: 'Internal server error.',
    message: process.env.NODE_ENV !== 'production' ? err.message : undefined,
  });
});

// Initialize Session Table, Telegram Bot & Autonomous Schedulers
if (process.env.NODE_ENV !== 'test') {
  sessionStore.ensureTable().catch((err) => {
    console.error('[server] Startup session-store initialization failed:', err.code || err.message);
  });
  initTelegram();
  initAutonomousSchedulers(sendTelegramAlert);
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🎓 gueattend - Smart Attendance & Timetable System`);
    console.log(`🚀 Server operational at: http://localhost:${PORT}`);
    console.log(`🔒 Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
