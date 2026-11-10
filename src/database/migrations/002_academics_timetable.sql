-- ====================================================================
-- MIGRATION 002: Academics, Timetable & Course Progress Schema
-- GUeAttend Unified University ERP
-- ====================================================================

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 4,
    subject_type TEXT NOT NULL DEFAULT 'theory' CHECK (subject_type IN ('theory', 'practical', 'elective')),
    syllabus_outline TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects(code);
CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects(semester_id);

-- Faculty Subject Allocation
CREATE TABLE IF NOT EXISTS faculty_subjects (
    id TEXT PRIMARY KEY,
    faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(faculty_id, subject_id, section_id, academic_session_id)
);
CREATE INDEX IF NOT EXISTS idx_faculty_subj_fac ON faculty_subjects(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_subj_sec ON faculty_subjects(section_id);

-- Classrooms
CREATE TABLE IF NOT EXISTS classrooms (
    id TEXT PRIMARY KEY,
    room_number TEXT UNIQUE NOT NULL,
    building TEXT NOT NULL DEFAULT 'Main Campus',
    floor INTEGER NOT NULL DEFAULT 1,
    capacity INTEGER NOT NULL DEFAULT 60,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timetable Periods Definition (Period 1 to Period 8, etc.)
CREATE TABLE IF NOT EXISTS timetable_periods (
    period_number INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_break BOOLEAN NOT NULL DEFAULT FALSE
);

-- Master Timetable
CREATE TABLE IF NOT EXISTS timetable (
    id TEXT PRIMARY KEY,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
    period_number INTEGER NOT NULL REFERENCES timetable_periods(period_number),
    class_type TEXT NOT NULL DEFAULT 'theory' CHECK (class_type IN ('theory', 'practical')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(academic_session_id, section_id, day_of_week, period_number)
);
CREATE INDEX IF NOT EXISTS idx_tt_section_day ON timetable(section_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_tt_faculty_day ON timetable(faculty_id, day_of_week);

-- Class Substitutions
CREATE TABLE IF NOT EXISTS class_substitutions (
    id TEXT PRIMARY KEY,
    timetable_id TEXT NOT NULL REFERENCES timetable(id) ON DELETE CASCADE,
    substitution_date DATE NOT NULL,
    original_faculty_id TEXT NOT NULL REFERENCES faculty(id),
    substitute_faculty_id TEXT NOT NULL REFERENCES faculty(id),
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'conducted', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(timetable_id, substitution_date)
);
CREATE INDEX IF NOT EXISTS idx_subs_date ON class_substitutions(substitution_date);

-- Lecture Plans & Topics Covered
CREATE TABLE IF NOT EXISTS lecture_plans (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    topic_title TEXT NOT NULL,
    planned_date DATE NOT NULL,
    completion_status TEXT NOT NULL DEFAULT 'pending' CHECK (completion_status IN ('completed', 'pending', 'dropped')),
    completed_date DATE,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lp_subject_sec ON lecture_plans(subject_id, section_id);
CREATE INDEX IF NOT EXISTS idx_lp_status ON lecture_plans(completion_status);

-- Study Materials & Notes
CREATE TABLE IF NOT EXISTS study_materials (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    file_url TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf',
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_materials_subject ON study_materials(subject_id);

-- Assignments (Safe upgrade if table pre-existed)
CREATE TABLE IF NOT EXISTS assignments (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    external_assignment_id TEXT,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS subject_id TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS faculty_id TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS section_id TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS max_marks NUMERIC(5,2) DEFAULT 100.0;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS attachment_url TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_asgn_subject ON assignments(subject_id);

-- Assignment Submissions
CREATE TABLE IF NOT EXISTS assignment_submissions (
    id TEXT PRIMARY KEY,
    assignment_id BIGINT NOT NULL,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    submission_url TEXT NOT NULL,
    remarks TEXT DEFAULT '',
    marks_obtained NUMERIC(5,2),
    faculty_feedback TEXT DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    graded_at TIMESTAMPTZ,
    UNIQUE(assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_asgn_sub_student ON assignment_submissions(student_id);
