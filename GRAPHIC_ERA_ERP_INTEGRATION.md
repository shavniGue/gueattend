# Graphic Era University ERP Integration Specification (GUeAttend)

**Target Portal:** Graphic Era University Student Portal (`https://student.geu.ac.in`)  
**University Identifier:** `GUeID`  
**Audit Date:** 2026-11-12

---

## 1. Authorized Integration Observed in GUeAttend Repository

Inspection of `/Users/karankumar/Desktop/Gueattend` found the following **implemented** ERP components and security controls:

### 1.1 Portal Login & Live CAPTCHA Relay (`src/qums-login-web.js`, `src/routes/qums.js`)
- **Configured Portal URLs (`COLLEGE_CONFIG`):**
  - Login URL: `https://student.geu.ac.in/N0j5Ha0` (overridable via `COLLEGE_LOGIN_URL`)
  - Dashboard URL Match: `/P0btHKF1DtpZzThe_BuxfULbSZc_QvAAp3scwF-NOlX6` (overridable via `COLLEGE_DASHBOARD_MATCH`)
- **DOM Selectors Configured:**
  - Username (`GUeID`): `input[placeholder*="User ID"], #mat-input-0, #txtUserName, input[name="txtUserName"], #txtEmail, #username, input[name="username"]`
  - Password: `input[placeholder*="Password"], #mat-input-1, #txtPassword, input[name="txtPassword"], #password, input[name="password"]`
  - Visual CAPTCHA Image: `img[alt*="CAPTCHA"], img[alt*="captcha"], #imgCaptcha, #img_captcha, img[src*="captcha"], img.captcha`
  - CAPTCHA Input: `input[placeholder*="text shown above"], #mat-input-2, #txtCaptcha, input[name="txtCaptcha"], #captcha, input[name="captcha"]`
  - Submit Button: `button[type="submit"], #btnSubmit, #btnLogin, input[type="submit"]`
  - Error Indicator: `#lblMessage, .mat-mdc-snack-bar-label, .alert-danger, .error-message, [role="alert"]`
- **Human-in-the-Loop Authentication Flow:**
  1. Student opens `/geu-setup` (`public/qums-setup.html`), calling `GET /api/geu/captcha`.
  2. Server launches headless Chromium (`playwright`), navigates to `https://student.geu.ac.in/N0j5Ha0`, waits for visible CAPTCHA image, captures a PNG screenshot, encodes it as `data:image/png;base64,...`, and caches the active `Browser`/`Page` in `pendingSessions` with a 3-minute TTL (`cleanupPending`).
  3. Student submits `GUeID`, password, and human-solved CAPTCHA to `POST /api/geu/login` or `POST /api/geu/submit-captcha`.
  4. **GUeID Ownership Verification (`verifyAuthorizedGueidMapping`):** Validates 4–32 alphanumeric/underscore/hyphen characters (rejects emails), enforces immutability once bound, and prevents another GUeAttend user or student record from claiming the same `GUeID` (`409 Conflict` + `GUEID_OWNERSHIP_CONFLICT` audit log).
  5. **Anti-Bot / Turnstile Compliance:** If login does not navigate past `/N0j5Ha0`, checks `input[name="cf-turnstile-response"]`. When an empty Turnstile challenge field is present, stops and informs the user (`"College portal anti-bot verification (Cloudflare Turnstile) is active on student.geu.ac.in; automated login cannot proceed."`). No anti-bot or CAPTCHA bypass is performed.
  6. **Session Persistence (`persistVerifiedPortalSession`):** Captures authenticated browser cookies (`ASP.NET_SessionId`, etc.), saves them to `data/sessions/qums_<userId>.json` with `0600` POSIX permissions (`src/credentials.js`), stores AES-256-GCM encrypted password in `users.qums_password_encrypted` (`src/crypto.js`), saves serialized cookies in `users.qums_session_data`, updates `users.qums_session_status = 'connected'`, and logs `GUEID_VERIFIED_AND_CONNECTED` + `reconnect_events`.
  7. **1-Click Reconnect (`POST /api/geu/reconnect`):** Decrypts vaulted ERP password server-side and prompts the student only for a fresh human-solved CAPTCHA from `student.geu.ac.in`.

### 1.2 Authorized External Batch Sync Layer (`src/services/external-sync.js`)
- `validateAttendanceRecord(rec)` validates `studentId | qid | userId`, `subjectCode`, `classDate`, and `status IN ('present','absent','approved_leave','not_marked')`.
- `syncAttendanceBatch(records, sourceName, syncedByUserId)` maps students by `student_id / id / user_id`, upserts into `attendance_records`, and writes an immutable entry to `external_sync_logs`.
- Note: **No HTTP route currently exposes `syncAttendanceBatch`**; it is currently invoked only by `test/run-tests.js`.

---

## 2. Missing Specification Before Live GEU Data Fetching Can Be Implemented

During audit of `src/scraper.js`, we verified that **no post-login `student.geu.ac.in` data-fetching endpoints or HTML/API parsers exist yet**:
- `scrapeSubjectWiseAttendance`, `scrapeTodayClasses`, `scrapeWeeklyTimetable`, `scrapeMonthRegister`, and `scrapeAssignments` in `src/scraper.js` currently **only query local Supabase PostgreSQL tables** (`db.getAttendanceSummary`, `db.getTodayAttendance`, `db.getStudentWeeklyTimetable`, `db.getMonthlyAttendance`, `assignments`), without making any authenticated HTTP or Playwright requests to `student.geu.ac.in`.

To implement authorized live fetching from Graphic Era University's portal without inventing undocumented endpoints or violating university access controls, the following details from an authorized `student.geu.ac.in` session are still needed:
1. Confirmed post-login URLs / Angular XHR API endpoints (and request methods/payloads) on `student.geu.ac.in` for:
   - Student profile & enrollment details (`GUeID`, course, semester, section)
   - Subject-wise overall attendance summary
   - Today's period-by-period attendance & timetable
   - Monthly register / backdated attendance calendar
   - Weekly timetable & substitutions
   - Assignments, Exam schedules, Marks/Results, Fee ledger, and Circulars
2. Exact JSON response schemas or rendered DOM table structures for each endpoint.
3. Confirmation on whether Cloudflare Turnstile allows headless Chromium session reuse with captured cookies or requires browser-extension / CSV-Excel export sync (`/api/admin/import/excel` & `external-sync.js`) when Turnstile is active.

---

## 3. Compliance Rules
- Never reuse Quantum University (`qums.quantumuniversity.edu.in` / `my.quantumuniversity.edu.in`) URLs or Cyborg QUMS endpoints unless officially verified on `student.geu.ac.in`.
- Never solve, automate, or bypass visual CAPTCHAs or Cloudflare Turnstile challenges.
- Unmarked classes (`not_marked`) must never be counted as absent in attendance percentage formulas.

