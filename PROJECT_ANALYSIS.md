# PROJECT ANALYSIS & ARCHITECTURAL AUDIT
## Project: GUeAttend – Unified University ERP & Smart Attendance System
**Target Repository:** `https://github.com/shavniGue/gueattend.git`  
**Reference Architecture:** Graphic Era University ERP / Cyborg Student Portal  
**Date of Audit:** November 10, 2026  
**Auditor:** Senior Full-Stack Software Architect, Security Engineer & Systems Architect  

---

### Executive Summary

GUeAttend is a next-generation, unified university Enterprise Resource Planning (ERP) platform designed for students, faculty, and administrators. The platform incorporates comprehensive modules for attendance tracking, dynamic timetables, academic management, examinations and results, fee records, grievance handling, university circulars, hostel management, placement drives, notifications, and automated Telegram bot integration.

This document presents a comprehensive audit of existing codebases (`/Projects/qattend` and `/Projects/QAttend-Portal`), identifies critical architectural flaws and security risks, documents database requirements for Supabase PostgreSQL, and outlines the 12-phase development execution roadmap for GUeAttend.

---

### 1. Existing Architecture & Codebase Inspection

Inspection of the developer environment revealed two distinct predecessor codebases:

#### 1.1 `qattend` (`qums-attendance-bot`)
- **Backend:** Node.js, Express.js (v4.19.2), `express-session` with `session-file-store`.
- **Database:** PostgreSQL (`pg` v8.23.0) pointing to a previous Supabase project (`ifqcykeinpgqyoduwyho`).
- **Scraping / Sync:** Headless browser automation via Playwright (`scraper.js`, `qums-login-web.js`, `new-erp-client.js`).
- **Communication:** `node-telegram-bot-api` (`telegram.js`, `telegram-admin.js`).
- **Authentication:** Dual implementation (Express session + Firebase Admin token verification in `firebaseAuth.js`).
- **Scheduled Tasks:** `node-cron` running morning schedules and watcher loops.

#### 1.2 `QAttend-Portal`
- **Frontend:** Static HTML files (`login.html`, `index.html`, `admin.html`, `teacher.html`, `cr.html`), CSS (`style.css`), and JavaScript (`script.js`).
- **Architecture:** Client-side Firebase Firestore SDK direct access.
- **Issues:** Security rules (`firestore.rules`) vulnerable to privilege bypass; business logic executed client-side; multiple duplicate portals violating the single unified ERP rule.

#### 1.3 Target Repository: `gueattend.git`
- Cloned freshly at `/Users/karankumar/Desktop/Gueattend`.
- Initial state: Empty repository on branch `main`.

---

### 2. Identified Bugs & Architectural Anti-Patterns

1. **Dual-ERP Confusion & Fragmented Logic:**
   - Previous code contained separate paths: `active_erp_type ('OLD' | 'NEW')`, `/api/qums-login/*`, and `/api/new-erp/*`.
   - Fragmented session registries and multiple conflicting login flows.
   - **Violation of Master Rule:** The project must have ONLY ONE unified ERP named **GUeAttend**.

2. **Dual Database Inconsistency:**
   - Predecessor systems attempted to write to both Google Firebase Firestore and Supabase PostgreSQL.
   - Risk of desynchronization, duplicate student records, and untracked mutations.
   - **Remedy:** Supabase PostgreSQL is the sole primary source of truth for all ERP data. Firebase is restricted strictly to optional auxiliary services (Push notifications, file attachments).

3. **Client-Side Authorization Vulnerabilities (in QAttend-Portal):**
   - Admin and faculty authorization checks performed via client-side JavaScript (`script.js`).
   - Anyone could load `admin.html` and invoke sensitive actions if API authorization wasn't strictly enforced on every backend endpoint.

4. **Missing University ERP Modules:**
   - Predecessor repositories lacked complete implementations of:
     - Examination schedules, admit cards, internal/external marks, SGPA/CGPA result calculation.
     - Fee structures, dues tracking, payment receipt generation.
     - Grievance submission and tracking workflow.
     - Official circulars and notices management.
     - Hostel room allocation and notices.
     - Placement drives, eligible branches, and student application status.
     - Faculty attendance marking, attendance correction workflows, and lecture plans.
     - University structure management (Departments, Courses, Semesters, Sections, Academic Sessions).

5. **Fragile Attendance Calculations:**
   - Earlier scrapers risked treating "Not Marked" / blank periods as "Absent", artificially depressing student attendance percentages.
   - Formula must strictly enforce:
     $$\text{Attendance Percentage} = \left(\frac{\text{Present Classes}}{\text{Total Marked Classes}}\right) \times 100$$
     where $\text{Total Marked Classes} = \text{Present} + \text{Absent}$. Unmarked classes must NEVER be counted as absent.

6. **Telegram Bot Token & Session Leak Risks:**
   - Bot tokens previously stored in plaintext `.env` and committed files.
   - Bot sessions lacked cryptographic link tokens and audit logs for administrative actions.

---

### 3. Database Requirements (Supabase PostgreSQL)

A fully normalized, relational schema must be established in Supabase PostgreSQL (`https://cnpullmxupyqdndxzbih.supabase.co`) with Row Level Security (RLS) enabled on all sensitive tables:

1. **Core & Authentication:**
   - `users`: ID, email, password_hash, role (`student`, `faculty`, `admin`), is_active, created_at, updated_at.
   - `user_sessions`: Session token, user ID, IP address, user agent, expires_at.
   - `user_roles`: Role definitions and administrative permissions.

2. **University Hierarchy:**
   - `departments`: ID, name, code, head_of_department.
   - `courses`: ID, department_id, name, code, duration_years.
   - `academic_sessions`: ID, session_name (e.g., `2026-2027`), is_current, start_date, end_date.
   - `semesters`: ID, course_id, semester_number, academic_session_id.
   - `sections`: ID, semester_id, section_name.

3. **Students & Faculty:**
   - `students`: ID, user_id, student_id, enrollment_no, roll_no, department_id, course_id, semester_id, section_id, admission_date, profile_pic_url.
   - `faculty`: ID, user_id, employee_id, designation, department_id, qualification.

4. **Academics & Timetable:**
   - `subjects`: ID, course_id, semester_id, code, name, credits, subject_type (`theory`, `practical`).
   - `classrooms`: ID, room_number, building, capacity.
   - `timetable_periods`: Period number, start_time, end_time, label.
   - `timetable`: ID, academic_session_id, section_id, subject_id, faculty_id, classroom_id, day_of_week, period_id.
   - `class_substitutions`: ID, timetable_id, date, substitute_faculty_id, reason, status.
   - `lecture_plans`: ID, subject_id, faculty_id, topic, week_number, planned_date, completion_status, completed_date.

5. **Attendance Management:**
   - `attendance_sessions`: ID, timetable_id, subject_id, faculty_id, section_id, date, period_id, marked_at.
   - `attendance_records`: ID, session_id, student_id, status (`present`, `absent`, `approved_leave`), remarks.
   - `attendance_corrections`: ID, attendance_record_id, requested_by, approved_by, old_status, new_status, reason, status.

6. **Examinations & Results:**
   - `examinations`: ID, academic_session_id, semester_id, exam_name, exam_type (`mid_term`, `end_term`, `practical`), start_date, end_date.
   - `exam_schedules`: ID, examination_id, subject_id, date, start_time, end_time, classroom_id.
   - `marks`: ID, examination_id, student_id, subject_id, internal_marks, external_marks, total_marks, grade.
   - `student_results`: ID, student_id, semester_id, sgpa, cgpa, total_credits, result_status (`pass`, `fail`, `promoted`), backlogs.

7. **Fees & Payments:**
   - `fee_structures`: ID, course_id, semester_id, academic_session_id, tuition_fee, exam_fee, hostel_fee, other_fees, total_amount.
   - `student_fees`: ID, student_id, fee_structure_id, total_due, amount_paid, balance_due, due_date, status.
   - `payments`: ID, student_fee_id, student_id, transaction_reference, amount, payment_method, payment_status, verified_at, receipt_number.

8. **Campus Life & Communication:**
   - `grievances`: ID, student_id, category, subject, description, attachment_url, status, resolution_notes, resolved_by, created_at.
   - `circulars`: ID, title, category, target_audience (`all`, `students`, `faculty`), department_id, attachment_url, published_by, is_published, published_at.
   - `hostels`: ID, name, warden_name, contact_no, capacity.
   - `hostel_allocations`: ID, hostel_id, student_id, room_number, allocated_at, status.
   - `placements`: ID, company_name, job_title, eligibility_criteria, ctc, drive_date, application_deadline, description.
   - `placement_applications`: ID, placement_id, student_id, status, applied_at.
   - `notifications`: ID, user_id, title, message, type, is_read, metadata, created_at.

9. **Telegram & System:**
   - `telegram_accounts`: ID, user_id, telegram_chat_id, telegram_username, is_verified, linked_at.
   - `telegram_link_tokens`: ID, user_id, token, expires_at.
   - `external_sync_logs`: ID, source, entity_type, records_synced, status, error_details, synced_at.
   - `audit_logs`: ID, user_id, action, resource, details, ip_address, created_at.

---

### 4. Security Audit & Hardening Strategy

1. **Authentication & Session Security:**
   - Passwords hashed with `bcrypt` (work factor 12).
   - Session cookies configured with `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
   - Session fixation protection on login/logout.
   - Strict brute-force rate-limiting on `/api/auth/*` endpoints.

2. **Row Level Security (RLS) Policies:**
   - Students can ONLY select/read their own profile, attendance, timetable, results, fees, grievances, and notifications.
   - Faculty can mark and view attendance only for classes/subjects to which they are officially assigned.
   - Administrators possess audited management capabilities across all university entities.

3. **Secret Key Governance:**
   - Zero credentials in source code.
   - `.env` excluded in `.gitignore`.
   - Comprehensive `.env.example` documenting all configuration keys.
   - Health-check endpoint verifying Supabase connectivity without leaking secret tokens.

---

### 5. Development Execution Roadmap (Phases 1 - 12)

| Phase | Description | Deliverables |
|---|---|---|
| **Phase 1** | Analysis & Documentation | `PROJECT_ANALYSIS.md`, architecture audit, roadmap |
| **Phase 2** | Supabase & Database Architecture | SQL migrations, connection module, health-check endpoint, RLS policies |
| **Phase 3** | Authentication & RBAC | Multi-role login (Student, Faculty, Admin), session management, password hashing |
| **Phase 4** | Student Dashboard UI | Graphic Era / Cyborg inspired layout, responsive navy sidebar, 9 dashboard widgets |
| **Phase 5** | Attendance Management & Month Register | Today's attendance, historical calendar, month/year selector, Not Marked != Absent |
| **Phase 6** | Timetable System | Weekly grid, Monday-Saturday, period timings, dynamic queries, substitution alerts |
| **Phase 7** | Academic & Lecture Plans | Syllabus, study notes, assignments & submissions, weekly topic tracking |
| **Phase 8** | Examinations, Results & Fees | Exam timetable, admit cards, internal/external marks, SGPA/CGPA, fee ledger, receipts |
| **Phase 9** | Grievances, Circulars, Hostel & Placement | Student grievance desk, circular broadcast, hostel rooms, placement drive portal |
| **Phase 10** | Telegram Bot Integration | `@gue_attendance_bot`, secure link tokens, `/start`, `/login`, `/attendance`, `/today`, `/timetable`, `/month`, `/notices` |
| **Phase 11** | External Sync & Data Import | Modular API integration service, authorized CSV/Excel batch imports, audit logs |
| **Phase 12** | Verification, Testing, Security Audit & Git Push | Comprehensive integration test suite, README.md, clean Git commits and push |

---
*GUeAttend Architecture Team — Ready for Phase 2 Execution.*

