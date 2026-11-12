# QAttend → GUeAttend Feature & Architecture Mapping

**Source Reference:** QAttend (`/Users/karankumar/Desktop/Projects/qattend  copy`, Quantum University — `QID`)  
**Target Project:** GUeAttend (`/Users/karankumar/Desktop/Gueattend`, Graphic Era University — `GUeID`)  
**Target Infrastructure:** Firebase Project `gueattend` | Supabase Project `cnpullmxupyqdndxzbih` | Render `https://gueattend.onrender.com` | GitHub `https://github.com/shavniGue/gueattend.git`

> **Strict Separation Rule:** GUeAttend and QAttend share zero runtime infrastructure, Firebase users, Supabase databases, university credentials, ERP sessions, or Telegram bots.  
> **Current Blocker Found During Audit:** `GUeAttend/.env` currently sets `SUPABASE_URL=https://cnpullmxupyqdndxzbih.supabase.co`, **but `DATABASE_URL` still points to `postgres.ifqcykeinpgqyoduwyho` (QAttend's Supabase DB)**, and `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `FIREBASE_API_KEY`, and `FIREBASE_SERVICE_ACCOUNT_KEY` are unset. This MUST be updated to `cnpullmxupyqdndxzbih` before running migrations or integration tests.

---

## 1. Identity, Infrastructure & Configuration Mapping

| Area | QAttend (Reference) | GUeAttend Current State (`/Users/karankumar/Desktop/Gueattend`) | Status | Required Action / Next Step |
|---|---|---|---|---|
| **University ID** | `QID` (`qums_qid`, `qums_identities`) | UI/auth uses `GUeID` (`verifyAuthorizedGueidMapping` in `src/qums-login-web.js`); DB columns still named `qums_qid`, `qums_session_*` | Partial | Keep column compatibility during transition or add clean alias/migration if renaming DB columns; finish UI cleanup of internal `qums` file/endpoint aliases if desired |
| **Firebase Project** | `qums-forgot-password-test` | `gueattend` (`src/config/firebase.js`, `public/js/firebase-config.js`) + `firebase-functions/index.js` | Implemented (Needs Env Keys) | Provide `FIREBASE_API_KEY` & `FIREBASE_SERVICE_ACCOUNT_KEY` in `.env` and Render |
| **Supabase Project** | `ifqcykeinpgqyoduwyho` (no Supabase JS client, no RLS) | Configured for `cnpullmxupyqdndxzbih` (`src/database/supabase.js`, `public/js/supabase-firebase.js`), **but `.env` `DATABASE_URL` points to `ifqcykeinpgqyoduwyho`** | **BLOCKED (Misconfigured `.env`)** | Update `DATABASE_URL` to `cnpullmxupyqdndxzbih` + set `SUPABASE_PUBLISHABLE_KEY` & `SUPABASE_SECRET_KEY`, then run `npm run migrate` & `seed.js` |
| **Session Store** | `express-session` + `session-file-store` (`data/app-sessions/`) | `express-session` + `session-file-store` (`data/app-sessions/`, `src/server.js`) | Works (Dev/Single-instance) | Replace with PostgreSQL session store (`user_sessions` / `connect-pg-simple`) for Render multi-restart persistence |
| **Credential Encryption** | AES-256-GCM (`src/crypto.js` via `ENCRYPTION_KEY`) | AES-256-GCM (`src/crypto.js` keyed from `SESSION_SECRET`) | Implemented | Optionally support dedicated `ENCRYPTION_KEY` fallback to `SESSION_SECRET` with safe key rotation plan |

---

## 2. Authentication & Authorization Mapping

| Feature | QAttend Implementation | GUeAttend Current Implementation | Status | Required Action |
|---|---|---|---|---|
| **Email + Password Registration** | Firebase Web SDK `createUserWithEmailAndPassword` + `sendEmailVerification` + `/api/register` | `public/register.html` + `POST /api/auth/register` (`src/routes/auth.js`): handles fresh registration, incomplete resume, duplicate verification & identity-conflict (`409`), enforces `role = 'student'` | Implemented | Verify end-to-end once `FIREBASE_API_KEY` and `cnpullmxupyqdndxzbih` DB are active |
| **Google Sign-In** | Not implemented | `public/login.html` (`googleSignInBtn`), `public/register.html` (`googleRegisterBtn`), `establishSessionFromIdToken()` in `src/firebaseAuth.js` | Implemented (Frontend + Backend) | Enable Google provider in Firebase Console (`gueattend`) + add `FIREBASE_API_KEY` to `.env` |
| **Email Verification Enforcement** | Checked on login (`email_verified`) + `/verify-email` | Checked in `establishSessionFromIdToken()` & `handleUserLogin()` (`403` + `emailNotVerified`); resend via Firebase SDK + `POST /api/auth/resend-verification` | Implemented | Verify flow with live Firebase project `gueattend` |
| **Password Reset** | `public/forgot.html` + Firebase `sendPasswordResetEmail` (`/reset` redirected) | `public/forgot.html` (`sendPasswordResetEmail`); `POST /api/auth/forgot-password` & `/reset-password` reject Firebase-managed accounts cleanly | Implemented | Optionally add `/reset` handler page if custom action URL is configured in Firebase |
| **Firebase JWT Verification & Custom Claims** | RS256 public cert verification (`src/firebaseAuth.js`), no RLS custom claim | `verifyFirebaseToken()` & `setAuthenticatedUserClaim()` (`src/config/firebase.js`), `POST /api/auth/sync-claims`, `GET /api/auth/firebase-session`, `firebase-functions/index.js` assigns `role='authenticated'` + `app_role` | Implemented | Deploy `firebase-functions/` OR set `FIREBASE_SERVICE_ACCOUNT_KEY` + run `npm run firebase:set-claims` |
| **Supabase Third-Party Firebase Integration + RLS** | Not implemented (0 RLS policies) | `src/database/migrations/008_firebase_third_party_rls.sql` + `createFirebaseScopedSupabaseClient` (`src/database/supabase.js`, `public/js/supabase-firebase.js`) | Implemented in Code/SQL | Configure Firebase as Third-Party Auth provider in Supabase (`cnpullmxupyqdndxzbih`) and apply Migration `008` |
| **RBAC (Student / Faculty / Admin)** | Only `student` and `admin` | `users.role IN ('student','faculty','admin')` + `users.is_admin`, `requireAuth`, `requireStudent`, `requireFaculty`, `requireAdmin` (`src/middleware/auth.js`), `scripts/bootstrap-admin.js` | Implemented | Test role enforcement across all routes & new ERP modules |

---

## 3. University ERP Integration Mapping (`QID` → `GUeID`)

| Feature | QAttend Implementation | GUeAttend Current Implementation | Status | Required Action |
|---|---|---|---|---|
| **ERP Login & CAPTCHA Relay** | Old ERP (`qums.quantumuniversity.edu.in` Playwright CAPTCHA relay) + New ERP (`my.quantumuniversity.edu.in`) | Single unified Playwright CAPTCHA relay targeting `https://student.geu.ac.in/N0j5Ha0` (`src/qums-login-web.js`, `src/routes/qums.js`, `public/qums-setup.html`), Cloudflare Turnstile detector (`cf-turnstile-response`), `verifyAuthorizedGueidMapping()` | Implemented (Login Relay) | Verify Playwright login against `student.geu.ac.in`; note Turnstile anti-bot check blocks automated login when active (never bypass) |
| **Vaulted Password & 1-Click Reconnect** | AES-256-GCM password + `POST /api/qums-login/*` + Telegram `/reconnect` | AES-256-GCM (`src/crypto.js`) + `reconnectQumsSession()` + `POST /api/geu/reconnect` | Implemented (Web) | Wire Telegram `/reconnect` to `qums-login-web.js` (missing in `src/telegram.js`) |
| **ERP Live Data Scraping (`student.geu.ac.in`)** | `src/scraper.js` calls Cyborg `Cyborg_S_Dashboard` APIs (`GetYearSemWiseAttendance`, `GetTodayAttendance`, `GetMonthRegister`, `FillStudentTimeTable`, `GetStudentDetailOnRegID`, `GetStudentAssignment`) | **`src/scraper.js` does NOT call `student.geu.ac.in`!** It only queries local Supabase/PG tables. `src/services/external-sync.js` validates & upserts external attendance batches into `attendance_records` | **GAP / MISSING LIVE ENDPOINTS** | Document authorized post-login `student.geu.ac.in` endpoints/DOM responses (user-supplied or inspected in an authorized session) before writing live scrapers (see `GRAPHIC_ERA_ERP_INTEGRATION.md`) |

---

## 4. Database Schema Mapping

| Domain | QAttend Tables (19 tables) | GUeAttend Schema (`001`–`009`, 30+ tables) | Notes & Known Bugs Found |
|---|---|---|---|
| **Core & Auth** | `schema_migrations`, `users`, `resets` | `schema_migrations`, `users`, `user_sessions`, `password_resets`, `academic_sessions`, `departments`, `courses`, `semesters`, `sections`, `students`, `faculty` | Normalized university hierarchy added in `001`; `009` enforces `firebase_uid` & `qums_qid` partial unique indexes & drops `password_hash NOT NULL` |
| **Timetable & Academics** | `weekly_schedule`, `new_erp_timetable`, `known_assignments`, `assignments` | `subjects`, `faculty_subjects`, `classrooms`, `timetable_periods`, `timetable`, `class_substitutions`, `lecture_plans`, `study_materials`, `assignments`, `assignment_submissions` | **Bug:** `src/scraper.js` inserts `(user_id, records) ON CONFLICT (user_id)` into `known_assignments` & `known_attendance`, but Migration `007` defines `known_attendance(user_id, subject_code, attendance_date, ...)` and `known_assignments(user_id, assignment_key, ...)` with NO `records` column |
| **Attendance** | `known_attendance`, `attendance_records`, `new_erp_attendance_cache` | `attendance_sessions`, `attendance_records`, `attendance_summaries`, `attendance_corrections`, `known_attendance` | **Bug:** `ON CONFLICT (user_id, qid, subject_code, class_date)` in `external-sync.js` and `faculty.js` requires a matching UNIQUE constraint/index on `attendance_records` — verify `attendance_records` unique constraint in migrations (`003`/`007` do NOT create that unique index!) |
| **Exams & Results** | Not in QAttend | `examinations`, `exam_schedules`, `marks`, `student_results`, `backlogs` (`004`) | Tables & DB helpers exist (`db.js`), **no API routes or UI pages yet** |
| **Fees & Payments** | Not in QAttend | `fee_structures`, `student_fees`, `payments` (`004`) | Tables & DB helpers exist (`db.js`), **no API routes or UI pages yet** |
| **Campus & Comms** | `notifications`, `notification_log`, `scheduled_message_deletions`, `reconnect_events`, `session_expiry_state`, `admin_audit_logs`, `system_settings`, `qums_identities`, `active_erp_sessions` | `grievances`, `grievance_responses`, `circulars`, `hostels`, `hostel_allocations`, `placements`, `placement_applications`, `notifications`, `telegram_accounts`, `telegram_link_tokens`, `external_sync_logs`, `audit_logs`, `application_settings` + `007` monitoring tables | **Bug:** `src/alerts.js` writes `NOW()` into `session_expiry_state.expired_at` & `last_alert_at`, which are `BIGINT` in Migration `007` (type mismatch!) |

---

## 5. Features, UI Pages & Backend API Mapping

| Feature Area | QAttend Status | GUeAttend Current State | Status | Needed Implementation |
|---|---|---|---|---|
| **Landing, Login, Register, Forgot, Guide** | Implemented | `landing.html`, `login.html`, `register.html`, `forgot.html`, `attendance-calculator-guide.html` (with password eye toggles & Google Sign-In) | Implemented | Add working backend `/api/contact` form handler (currently `landing.html` uses client-side `alert()`) |
| **Student Dashboard** | Implemented | `public/index.html` + `public/js/app.js` + `GET /api/dashboard/student` | Partial | Add UI widgets/tabs or pages for: **Right Now / Up Next** cards (computed by backend, not rendered in `app.js`), **Class Substitutions**, **Notifications feed**, **Profile**, and the ERP modules below |
| **Today's & Subject-Wise Attendance + 75% Calc** | Implemented | `GET /api/attendance/today`, `/summary`, `src/calculator.js`, rendered in `public/index.html` | Implemented | Fix SQL/bug issues & verify against `cnpullmxupyqdndxzbih` |
| **Monthly Attendance & Backdated History** | API + DB + Telegram only | `GET /api/attendance/monthly`, `GET /api/attendance/history`, `POST /api/attendance/correction` exist in backend (`src/routes/attendance.js`) | Partial (Backend only) | Add Monthly Calendar Register + Date Range History + Correction Request UI in student dashboard |
| **Timetable, Upcoming Classes & Substitutions** | Timetable implemented; upcoming/substitutions missing | `GET /api/timetable/weekly`, `GET /api/timetable/today` (`rightNow`, `upNext`), `class_substitutions` joined in `db.getStudentWeeklyTimetable()` | Partial | Render `rightNow`, `upNext`, and `classSubstitutions` cards in `public/js/app.js`; add Faculty/Admin Substitution management API & UI |
| **Academic Records / Lecture Plans / Assignments** | Partial (`assignments.js`, no web UI) | Tables (`lecture_plans`, `study_materials`, `assignments`, `assignment_submissions`) + `db.getLecturePlans/getCourseProgress` exist | **Missing API & UI** | Add `/api/academics/*` routes + student/faculty UI for Lecture Plans, Study Materials, Assignments & Submissions |
| **Examination Management & Results** | Not implemented | Tables (`examinations`, `exam_schedules`, `marks`, `student_results`, `backlogs`) + `db.getExamSchedules/getStudentResults/getStudentMarks` exist | **Missing API & UI** | Add `/api/exams/*` & `/api/results/*` routes + Student view + Faculty marks entry + Admin exam scheduler |
| **Fees & Payment Receipts** | Not implemented | Tables (`fee_structures`, `student_fees`, `payments`) + `db.getStudentFees/getPaymentReceipts` exist | **Missing API & UI** | Add `/api/fees/*` routes + Student fee ledger & printable receipt view + Admin fee structure management |
| **Circulars & Grievances (+ Hostel/Placements)** | Not implemented | Tables (`circulars`, `grievances`, `grievance_responses`, `hostels`, `placements`) + DB helpers + `POST /api/admin/circulars/create` exist | **Missing Routes & UI** | Add `/api/circulars/*`, `/api/grievances/*`, `/api/campus/*` routes + Student & Admin UI |
| **Faculty Portal** | Not implemented | `public/faculty.html` + `src/routes/faculty.js` (`assigned-classes`, `students`, `attendance/mark`, `corrections`) | Implemented (Core) | Expand to cover lecture plans, assignments grading, exam marks, and substitution requests |
| **Admin Portal** | Implemented (`public/admin.html` + `/api/admin/*`) | `public/admin.html` + `src/routes/admin.js` (`overview`, `metrics`, `users`, `export.xlsx`, `suspend`, `delete`, `circulars/create`, `import/excel`, `audit-logs`) | Implemented (Core) | Wire UI tabs for Circulars, Grievances review, Excel import, Audit logs, Academic structure & Role management |
| **Telegram Bot** | `telegram.js` + `telegram-admin.js` (polling lock, all student + admin cmds, CAPTCHA reconnect) | **Two conflicting files:** `src/server.js` loads `src/telegram.js` (`/start`, `/login`, `/attendance`, `/bunk`, date lookup + auto-prune); `test/run-tests.js` loads `src/services/telegram-bot.js` (`/start`, `/login`, `/attendance`, `/bunk`, `/today`, `/timetable`, `/month`, `/help`) | Partial & Split | Unify into one complete Telegram module implementing `/start`, `/login`, `/attendance`, `/bunk`, `/today`, `/timetable`, `/month`, `/assignments`, `/status`, `/reconnect` (with live CAPTCHA), `/notices`, date lookup, auto-prune, polling lock & admin commands |
| **Google AdSense & SEO** | `ads.txt`, `robots.txt`, `sitemap.xml`, AdSense snippets | `GET /ads.txt`, `GET /api/ads/config`, `public/js/ads.js` exist; **`public/robots.txt` & `public/sitemap.xml` are missing**; landing/dashboard/guide/login need meta SEO tags verified | Partial | Add `public/robots.txt`, `public/sitemap.xml`, OpenGraph/meta descriptions, and confirm `data-ad-placement` slots |
| **Security Controls** | Helmet missing, XSS `innerHTML` sinks in `index.html`, no CSRF | Parameterized `pg` queries, `bcrypt`, `rateLimit`, server-side RBAC, RLS migration `008`, `escapeHtml` in `admin.html` | Partial | Fix `innerHTML` XSS risks in `public/js/app.js` & `qums-setup.html`, add security headers (`helmet` or manual CSP/XFO headers), add CSRF origin checks, fix `alert.js`/`scraper.js`/`attendance_records` unique index bugs |

---

## 6. Phased Execution Plan

1. **Phase 0 — Environment & Database Isolation (Prerequisite Blocker):**
   - Point `DATABASE_URL` in `GUeAttend/.env` to Supabase project `cnpullmxupyqdndxzbih` (never `ifqcykeinpgqyoduwyho`).
   - Add `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `FIREBASE_API_KEY`, and `FIREBASE_SERVICE_ACCOUNT_KEY`.
   - Apply SQL migrations (`001`–`009`) + fix schema/constraint mismatches (`010_fixes.sql` for `attendance_records` unique constraint, `known_attendance`/`known_assignments`, `session_expiry_state`).
2. **Phase 1 — Core Bug Fixes & Database Integrity:**
   - Fix `src/alerts.js` timestamp (`Date.now()` BIGINT vs `NOW()`), `src/scraper.js` `known_*` queries, and `attendance_records` conflict index; verify all `npm test` checks pass cleanly against `cnpullmxupyqdndxzbih`.
3. **Phase 2 — Auth & Third-Party Supabase RLS Verification:**
   - Verify Email/Password signup, Email verification, Google Sign-In, Password Reset, `sync-claims`, `firebase-session`, and `scripts/bootstrap-admin.js` against `gueattend` + `cnpullmxupyqdndxzbih`.
4. **Phase 3 — Graphic Era University ERP Data Integration:**
   - Complete authorized post-login `student.geu.ac.in` integration (dependent on verified portal endpoint/DOM spec — see `GRAPHIC_ERA_ERP_INTEGRATION.md`).
5. **Phase 4 — Student ERP Modules & Full UI:**
   - Add API routes + UI views for: Monthly/Backdated Register, Attendance Corrections, Upcoming Classes & Substitutions, Academic Records & Lecture Plans, Assignments & Submissions, Examinations & Results, Fees & Receipts, Circulars, Grievances, Profile & Notifications.
6. **Phase 5 — Unified Telegram Bot, Watchers & Schedulers:**
   - Merge `src/telegram.js` and `src/services/telegram-bot.js`, add `/reconnect` CAPTCHA flow, `/assignments`, `/notices`, `/status`, `/admin`, and single-instance polling lock; verify cron schedulers (`08:30` IST morning timetable, 5m watcher, 10m month register scan, 30m assignments, 7 PM deadline alert).
7. **Phase 6 — Admin Portal Completion, SEO, AdSense & Security Hardening:**
   - Add Admin management UI for circulars, grievances, academics/substitutions, exams/fees, Excel import, audit logs; add `robots.txt`, `sitemap.xml`, security headers, XSS cleanup in `public/js/app.js`; re-run full test suite.

