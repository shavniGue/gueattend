-- ====================================================================
-- MIGRATION 001: Core Authentication & University Hierarchy Schema
-- GUeAttend Unified University ERP
-- ====================================================================

-- Schema migrations tracker table
CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core Users Table (Students, Faculty, Administrators)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin')),
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safely add columns if users table pre-existed or on fresh installs
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Update full_name from student_name cache if available
UPDATE users SET full_name = student_name WHERE (full_name IS NULL OR full_name = '') AND student_name IS NOT NULL AND student_name <> '';
-- Update role to admin if is_admin is true
UPDATE users SET role = 'admin' WHERE is_admin = TRUE AND role <> 'admin';

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- User Sessions (Stateful or active token tracking)
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- Password Resets
CREATE TABLE IF NOT EXISTS password_resets (
    email TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Academic Sessions (e.g. 2026-2027)
CREATE TABLE IF NOT EXISTS academic_sessions (
    id TEXT PRIMARY KEY,
    session_name TEXT UNIQUE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Departments
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    head_of_department TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    duration_years INTEGER NOT NULL DEFAULT 4,
    total_semesters INTEGER NOT NULL DEFAULT 8,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_courses_dept ON courses(department_id);

-- Semesters
CREATE TABLE IF NOT EXISTS semesters (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    semester_number INTEGER NOT NULL,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course_id, semester_number, academic_session_id)
);
CREATE INDEX IF NOT EXISTS idx_semesters_course ON semesters(course_id);

-- Sections
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(semester_id, name)
);
CREATE INDEX IF NOT EXISTS idx_sections_sem ON sections(semester_id);

-- Students Profile & Academic Enrollment
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id TEXT UNIQUE NOT NULL,
    enrollment_number TEXT UNIQUE NOT NULL,
    roll_number TEXT DEFAULT '',
    department_id TEXT NOT NULL REFERENCES departments(id),
    course_id TEXT NOT NULL REFERENCES courses(id),
    semester_id TEXT NOT NULL REFERENCES semesters(id),
    section_id TEXT NOT NULL REFERENCES sections(id),
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id),
    date_of_birth DATE,
    gender TEXT DEFAULT '',
    blood_group TEXT DEFAULT '',
    father_name TEXT DEFAULT '',
    mother_name TEXT DEFAULT '',
    guardian_contact TEXT DEFAULT '',
    address TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students(enrollment_number);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(section_id);

-- Faculty Profiles
CREATE TABLE IF NOT EXISTS faculty (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    employee_id TEXT UNIQUE NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(id),
    designation TEXT NOT NULL,
    qualification TEXT DEFAULT '',
    specialization TEXT DEFAULT '',
    joining_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_faculty_user ON faculty(user_id);
CREATE INDEX IF NOT EXISTS idx_faculty_dept ON faculty(department_id);
