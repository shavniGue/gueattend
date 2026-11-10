# GUeAttend – Unified University ERP & Smart Attendance System

[![Build & Test Status](https://img.shields.io/badge/integration--tests-25%2F25%20passing-10b981.svg)]()
[![Database](https://img.shields.io/badge/database-Supabase%20PostgreSQL-3ecf8e.svg)]()
[![Security](https://img.shields.io/badge/security-RLS%20%2B%20bcrypt-blue.svg)]()
[![Bot](https://img.shields.io/badge/telegram-@gue__attendance__bot-0088cc.svg)](https://t.me/gue_attendance_bot)

**GUeAttend** is an enterprise-grade university Enterprise Resource Planning (ERP) and Smart Attendance Management system designed for students, faculty members, and administrators. 

Inspired by the information hierarchy and design of **Graphic Era University's Cyborg ERP / Student Portal**, GUeAttend consolidates attendance tracking, dynamic timetables, academic course progress, examination records, fees management, grievances redressal, university circulars, hostel allocations, placement drives, and automated Telegram bot notifications into **one single, unified platform**.

---

## 🏛️ Key Architectural Principles

1. **Strictly ONE Unified ERP:**
   - No "Old" vs "New" ERP duality.
   - Unified authentication, single relational PostgreSQL database schema, and distinct role-based dashboard views (`/dashboard`, `/faculty`, `/admin`).

2. **Supabase PostgreSQL as Primary Source of Truth:**
   - All university entities (Users, Students, Faculty, Timetable, Attendance Sessions & Records, Exams, Fees, Grievances, Circulars) reside in **Supabase PostgreSQL**.
   - Row Level Security (RLS) policies enforce strict data isolation between students and administrative entities.

3. **Strict Attendance Calculation Standard:**
   $$\text{Attendance Percentage} = \left(\frac{\text{Present Classes}}{\text{Total Marked Classes}}\right) \times 100$$
   $$\text{Total Marked Classes} = \text{Present} + \text{Absent} + \text{Approved Leave}$$
   *Unmarked classes are strictly never counted as absent.*

4. **Zero Client-Side Secret Exposure:**
   - Supabase Service Role keys, Telegram bot tokens, database credentials, and session secrets are managed strictly through server-side environment variables.

---

## 🚀 Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, CSS3 (Custom Responsive Design System), Modern Vanilla JavaScript |
| **Backend** | Node.js (>=18), Express.js (REST API Architecture) |
| **Primary Database** | Supabase PostgreSQL (`pg` Connection Pool + RLS) |
| **Authentication** | Session-based (`express-session` + `session-file-store`), `bcryptjs` (Cost factor 10) |
| **Auxiliary Services** | Firebase Admin SDK (Push Notifications, Storage attachments, Analytics) |
| **Messaging & Bot** | Telegram Bot API (`node-telegram-bot-api`) for `@gue_attendance_bot` |
| **Data Ingestion** | `xlsx` for Excel/CSV batch ingestion and report exports |

---

## 📦 Directory Structure

```
Gueattend/
├── .env.example                     # Environment template (safe for commits)
├── .gitignore                       # Excludes .env, node_modules, sessions
├── DATABASE_SCHEMA.md               # Detailed entity & RLS documentation
├── PROJECT_ANALYSIS.md              # Initial audit & roadmap
├── package.json                     # Dependencies & scripts
├── public/                          # Frontend Static Assets
│   ├── css/
│   │   └── style.css                # GEU-inspired unified responsive styling
│   ├── js/
│   │   ├── app.js                   # Client dashboard router & API bridge
│   │   └── firebase-config.js       # Client-side Firebase auxiliary config
│   ├── login.html                   # Professional ERP glass-panel login
│   ├── forgot.html                  # Password recovery portal
│   ├── index.html                   # Unified Student Dashboard (9 widgets)
│   ├── faculty.html                 # Faculty Attendance & Grading Console
│   └── admin.html                   # Administrator Management Console
├── src/
│   ├── server.js                    # Express Application Entry Point
│   ├── config/
│   │   └── firebase.js              # Server-side Firebase Admin SDK setup
│   ├── database/
│   │   ├── db.js                    # Database connection pool & query helpers
│   │   ├── supabase.js              # Supabase API client & diagnostic health check
│   │   ├── migrate.js               # Idempotent migration runner
│   │   ├── seed.js                  # Graphic Era sample data seeder
│   │   └── migrations/
│   │       ├── 001_core_schema.sql
│   │       ├── 002_academics_timetable.sql
│   │       ├── 003_attendance_system.sql
│   │       ├── 004_exams_and_fees.sql
│   │       ├── 005_campus_and_comms.sql
│   │       └── 006_rls_policies.sql
│   ├── middleware/
│   │   ├── auth.js                  # Authentication & RBAC (Student/Faculty/Admin)
│   │   └── rate-limiter.js          # In-memory brute force rate limiter
│   ├── routes/                      # Modular REST API Controllers
│   │   ├── auth.js                  # /api/auth (Login, Logout, Me, Reset)
│   │   ├── dashboard.js             # /api/dashboard (Aggregated 9 widgets)
│   │   ├── attendance.js            # /api/attendance (Today, Monthly, History, Summary)
│   │   ├── timetable.js             # /api/timetable (Weekly, Today)
│   │   ├── academic.js              # /api/academic (Lecture plans, Syllabus, Notes)
│   │   ├── examinations.js          # /api/examinations (Schedules, Marks, Results)
│   │   ├── fees.js                  # /api/fees (Dues, Breakup, Receipts)
│   │   ├── grievances.js            # /api/grievances (Submit & Track)
│   │   ├── circulars.js             # /api/circulars (Campus Notices)
│   │   ├── hostel.js                # /api/hostel (Room Allocation)
│   │   ├── placement.js             # /api/placement (Placement Drives)
│   │   ├── notifications.js         # /api/notifications (In-app alerts)
│   │   ├── telegram.js              # /api/telegram (Link token & status)
│   │   ├── faculty.js               # /api/faculty (Rosters, Attendance marking)
│   │   └── admin.js                 # /api/admin (Metrics, Users, Bulk Excel import)
│   └── services/
│       ├── telegram-bot.js          # Telegram bot handlers & commands
│       └── external-sync.js         # Authorized external sync & validation layer
└── test/
    └── run-tests.js                 # 25-Point Master Integration Test Suite
```

---

## ⚙️ Setup & Installation Instructions

### 1. Prerequisites
- Node.js (version 18 or higher)
- PostgreSQL / Supabase project access

### 2. Clone Repository & Install Dependencies
```bash
git clone https://github.com/shavniGue/gueattend.git
cd gueattend
npm install
```

### 3. Environment Configuration
Copy the template and configure your local credentials:
```bash
cp .env.example .env
```

Edit `.env` with your parameters:
```env
PORT=3000
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=your-secure-random-session-secret-min-32-chars

# Supabase PostgreSQL Configuration
SUPABASE_URL=https://cnpullmxupyqdndxzbih.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_public_key
SUPABASE_SECRET_KEY=your_supabase_service_role_secret_key
DATABASE_URL=postgresql://postgres.cnpullmxupyqdndxzbih:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres

# Telegram Bot Integration (@gue_attendance_bot)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_from_botfather
TELEGRAM_BOT_USERNAME=gue_attendance_bot
TELEGRAM_POLLING=on
```

### 4. Run Database Migrations
Apply all 6 SQL schema migrations to Supabase:
```bash
npm run migrate
```

### 5. Seed Demonstration Records (Optional)
Populate realistic Graphic Era University ERP sample records (CSE department, B.Tech courses, students, faculty, timetables, attendance history, exam schedules, and circulars):
```bash
node src/database/seed.js
```

### 6. Start Server
```bash
npm start
```
Access the application at: `http://localhost:3000`

---

## 🎓 Default Demonstration Accounts

| Role | Email / User ID | Password | Access Path |
|---|---|---|---|
| **Student** | `karan.kumar@geu.ac.in` (ID: `24030110`) | `Password@123` | `/dashboard` |
| **Faculty** | `faculty.cse@geu.ac.in` (EMP: `EMP-1001`) | `Password@123` | `/faculty` |
| **Administrator** | `admin@geu.ac.in` | `Password@123` | `/admin` |

---

## 🤖 Telegram Bot Integration (`@gue_attendance_bot`)

GUeAttend features seamless 2-way Telegram synchronization:

1. **Secure Linking Protocol:**
   - Log into the GUeAttend web dashboard.
   - Navigate to **Settings → Telegram & Settings**.
   - Click **Generate 1-Click Link Code** (generates a cryptographic token valid for 15 minutes).
   - In Telegram, message `@gue_attendance_bot` with `/login <CODE>` or tap the deep link.
   - Chat ID is securely associated with the student profile in Supabase.

2. **Available Commands:**
   - `/attendance` - Overall percentage, present/absent counts, and subject-wise breakdown.
   - `/today` - Today's class schedule and live attendance marks.
   - `/timetable` - Complete weekly Monday-to-Saturday schedule.
   - `/month` - Current month attendance register summary.
   - `/notices` - Official university circulars and notices.
   - `/help` - Command guide and assistance.

---

## 🧪 Testing & Verification

Run the master integration test suite:
```bash
npm test
```

### Test Coverage Highlights:
- **Database & Supabase Connectivity:** Confirms pooler access, table schemas, and JWKS endpoints.
- **Authentication & Security:** bcrypt comparison, multi-role redirect, session persistence, rate limiting.
- **Attendance Mathematics:** Strictly enforces `Attendance % = (Present / Total Marked) * 100`, verifying that unmarked classes are excluded from absent counts.
- **Timetable Dynamics:** Weekly Monday-Saturday period slots, classroom assignments, "Right Now" and "Up Next" time calculations.
- **Academics & Syllabus:** Lecture plan progress, completed topics, study materials download.
- **Examinations & Fees:** Schedules, SGPA/CGPA result verification, fee ledgers, payment receipt generation.
- **Telegram Account Linking:** Token generation, verification, chat ID association, command response.
- **Batch Data Integration:** Validation, schema normalization, duplicate prevention, and sync audit logging.

---

## 🔒 Security & Data Privacy Highlights

- **Row Level Security (RLS):** Enforced on sensitive PostgreSQL tables (`users`, `students`, `attendance_records`, `marks`, `student_fees`, `grievances`).
- **Brute Force Protection:** Sliding-window in-memory rate limiter on `/api/auth/*` endpoints.
- **Session Protection:** `HttpOnly`, `SameSite=Lax`, and `Secure` (in production) cookies.
- **Audit Logs:** Administrative actions (suspension, grading, attendance marking, imports) logged to `audit_logs`.

---

## 📄 License
This project is licensed under the MIT License.
