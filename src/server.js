/**
 * gueattend - Smart University Attendance & Timetable System
 * Core Server Application
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const db = require('./database/db');
const { checkSupabaseHealth } = require('./database/supabase');
const { checkFirebaseHealth } = require('./config/firebase');
const { requireAuth, requireAdmin, requireFaculty } = require('./middleware/auth');

// Route modules (Pure Attendance & Timetable Features)
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const attendanceRoutes = require('./routes/attendance');
const timetableRoutes = require('./routes/timetable');
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
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'app-sessions');
const IS_PROD = process.env.NODE_ENV === 'production';

// Ensure local session storage dir exists
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.use(
  session({
    store: new FileStore({
      path: SESSIONS_DIR,
      ttl: 90 * 24 * 60 * 60,
      logFn: () => {},
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-gueattend-2026-fallback-min-32-chars',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 90 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
    },
  })
);

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
  const isHealthy = dbHealth.connected && dbHealth.tablesExist;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    application: 'gueattend smart attendance system',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    supabase: supabaseHealth,
    firebase: firebaseHealth,
    telegram: {
      botUsername: process.env.TELEGRAM_BOT_USERNAME || 'gue_attendance_bot',
      polling: String(process.env.TELEGRAM_POLLING || '').toLowerCase() === 'on',
    },
  });
});

// ====================================================================
// FRONTEND PAGE ROUTES
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
app.get('/dashboard', requireAuth, sendPage('index.html'));
app.get('/qums-setup', requireAuth, sendPage('qums-setup.html'));
app.get('/telegram-setup', requireAuth, sendPage('telegram-setup.html'));
app.get('/attendance-calculator-guide', sendPage('attendance-calculator-guide.html'));
app.get('/faculty', requireFaculty, sendPage('faculty.html'));
app.get('/admin', requireAdmin, sendPage('admin.html'));

// ====================================================================
// REST API ROUTES
// ====================================================================
app.post('/api/login', authRoutes.handleUserLogin);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/qums', qumsRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/admin', adminRoutes);

// ====================================================================
// CENTRALIZED ERROR HANDLING & 404
// ====================================================================
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'API route not found.' });
  }
  res.status(404).redirect('/login');
});

app.use((err, req, res, next) => {
  console.error('[server] Uncaught exception:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error.',
    message: process.env.NODE_ENV !== 'production' ? err.message : undefined,
  });
});

// Initialize Telegram Bot & Autonomous Schedulers
if (process.env.NODE_ENV !== 'test') {
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

