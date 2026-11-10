# Database Schema Documentation: GUeAttend
## Primary Database: Supabase PostgreSQL (Reference: `cnpullmxupyqdndxzbih`)

---

### 1. Architectural Overview & Source of Truth

GUeAttend uses a fully normalized PostgreSQL schema hosted on **Supabase** (`https://cnpullmxupyqdndxzbih.supabase.co`) as the single source of truth for all university records.

- **Role-Based Access Control (RBAC):** `student`, `faculty`, `admin`.
- **Row Level Security (RLS):** Enabled on all sensitive tables ensuring data privacy.
- **Attendance Calculation Principle:**
  $$\text{Attendance Percentage} = \left(\frac{\text{Present Classes}}{\text{Total Marked Classes}}\right) \times 100$$
  *Unmarked classes are strictly never counted as absent.*

---

### 2. Entity Relationship Map

```
                  +---------------+
                  |  departments  |
                  +-------+-------+
                          |
              +-----------+-----------+
              |                       |
              v                       v
        +----------+             +---------+
        | courses  |             | faculty |
        +-----+----+             +----+----+
              |                       |
              v                       |
        +-----------+                 |
        | semesters |                 |
        +-----+-----+                 |
              |                       |
              v                       |
        +----------+                  |
        | sections |                  |
        +-----+----+                  |
              |                       |
              +-----------+-----------+
                          |
                          v
                    +-----------+
                    |  students |
                    +-----+-----+
                          |
      +-------------------+-------------------+
      |                   |                   |
      v                   v                   v
+------------+     +-------------+     +--------------+
| attendance |     |  timetable  |     | marks/results|
+------------+     +-------------+     +--------------+
```

---

### 3. Core Tables Reference

#### 3.1 Authentication & System
- `users`: Primary accounts for students, faculty, and admins.
  - `id` (TEXT, PK): Unique user identifier (`usr_...`).
  - `email` (TEXT, UNIQUE): University / login email.
  - `password_hash` (TEXT): bcrypt hash.
  - `role` (TEXT): `'student' | 'faculty' | 'admin'`.
  - `full_name`, `phone`, `avatar_url`, `is_active`, `is_suspended`, `email_verified`.
- `user_sessions`: Active web sessions.
  - `id` (TEXT, PK), `user_id` (FK -> users.id), `ip_address`, `user_agent`, `expires_at`.
- `password_resets`: Secure token hashes with expiry.
- `audit_logs`: Audit trail for sensitive administrative and grading actions.

#### 3.2 Academic Hierarchy
- `academic_sessions`: e.g. `2026-2027`.
- `departments`: e.g. `CSE`, `ECE`, `MECH`, `MBA`.
- `courses`: e.g. `BTECH_CSE`, `BTECH_AI`, `BCA`.
- `semesters`: `semester_number` (1 to 8).
- `sections`: `A`, `B`, `C`, `G4`.
- `students`: Detailed student records linked to `users`.
  - `student_id` (e.g. 24030110), `enrollment_number` (e.g. GEU/2024/0010).
- `faculty`: Academic faculty records linked to `users`.
  - `employee_id`, `designation`, `department_id`.

#### 3.3 Academics, Timetable & Lecture Plans
- `subjects`: Code (`TCS-501`), Name, Credits, Type (`theory`, `practical`).
- `classrooms`: Room Number (`CR-301`, `LAB-2`), Building, Capacity.
- `timetable_periods`: Periods 1 through 8 with Start Time and End Time.
- `timetable`: Schedule linking section, day of week (1=Monday to 6=Saturday), period, subject, faculty, and classroom.
- `class_substitutions`: Temporary faculty re-assignment on specific dates.
- `lecture_plans`: Weekly syllabus topics, planned dates, completion status (`completed`, `pending`, `dropped`).
- `study_materials`: Reference PDFs and notes uploaded by faculty.
- `assignments` & `assignment_submissions`: Homework submission and grading system.

#### 3.4 Attendance Management
- `attendance_sessions`: Faculty/session marker for a specific class date, section, period, and subject.
- `attendance_records`: Individual student attendance:
  - `status`: `'present' | 'absent' | 'approved_leave' | 'not_marked'`.
- `attendance_summaries`: Aggregated subject-level counts and percentage cache.
- `attendance_corrections`: Formal student-requested and faculty-reviewed correction workflow.

#### 3.5 Examinations, Results & Fees
- `examinations`: Mid-Term, End-Term, Practical exam schedules.
- `exam_schedules`: Date, time, venue per subject.
- `marks`: Internal, external, total marks, grade point, status.
- `student_results`: SGPA, CGPA, total credits earned, backlogs.
- `fee_structures`: Breakup of tuition, examination, hostel, and library fees.
- `student_fees`: Fee balance and due dates.
- `payments`: Verified transaction receipts.

#### 3.6 Communication & Telegram
- `grievances` & `grievance_responses`: Student ticketing and resolution.
- `circulars`: Campus notices and official memos.
- `hostels` & `hostel_allocations`: Room allotment.
- `placements` & `placement_applications`: Campus hiring opportunities.
- `notifications`: Real-time user alert feed.
- `telegram_accounts`: Bot-linked Telegram chat IDs for `@gue_attendance_bot`.
- `telegram_link_tokens`: Time-limited cryptographic linking tokens.

---

### 4. Row Level Security (RLS) Matrix

| Table | Students | Faculty | Administrators |
|---|---|---|---|
| `users` | Own record | Own record | All records |
| `students` | Own record | Assigned classes | Full management |
| `attendance_records` | Read own | Read/Write assigned sessions | Full management |
| `marks` | Read own | Grade assigned subjects | Full management |
| `student_results` | Read own | View department students | Full management |
| `student_fees` | Read own | No access | Full management |
| `payments` | Read own | No access | Full management |
| `grievances` | Create & read own | Read/Resolve assigned | Full management |
| `telegram_accounts` | Manage own | Manage own | Audit view |

---
*GUeAttend Schema Design Team — Version 1.0.0*

