-- ====================================================================
-- MIGRATION 003: Attendance System & Month Register Schema
-- GUeAttend Unified University ERP
-- ====================================================================

-- Attendance Sessions (Each class/period marked by faculty or university)
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id TEXT PRIMARY KEY,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    faculty_id TEXT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    timetable_id TEXT REFERENCES timetable(id) ON DELETE SET NULL,
    class_date DATE NOT NULL,
    period_number INTEGER NOT NULL REFERENCES timetable_periods(period_number),
    duration_minutes INTEGER NOT NULL DEFAULT 55,
    topic_taught TEXT DEFAULT '',
    marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(academic_session_id, section_id, class_date, period_number)
);
CREATE INDEX IF NOT EXISTS idx_att_sess_sec_date ON attendance_sessions(section_id, class_date);
CREATE INDEX IF NOT EXISTS idx_att_sess_subj_date ON attendance_sessions(subject_id, class_date);
CREATE INDEX IF NOT EXISTS idx_att_sess_fac ON attendance_sessions(faculty_id);

-- Attendance Records (Safe upgrade for existing table with 20k+ rows)
CREATE TABLE IF NOT EXISTS attendance_records (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    qid TEXT NOT NULL DEFAULT '',
    subject_code TEXT NOT NULL DEFAULT '',
    subject_name TEXT DEFAULT '',
    class_date TEXT NOT NULL,
    status TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS student_id TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT '';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS period_number INTEGER;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS duration TEXT DEFAULT '';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS faculty_name TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_att_rec_user_date ON attendance_records(user_id, class_date);
CREATE INDEX IF NOT EXISTS idx_att_rec_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_att_rec_status ON attendance_records(status);

-- Attendance Summaries Cache (Precomputed for fast dashboard/analytics queries)
CREATE TABLE IF NOT EXISTS attendance_summaries (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_code TEXT NOT NULL,
    subject_name TEXT DEFAULT '',
    total_conducted INTEGER NOT NULL DEFAULT 0,
    total_marked INTEGER NOT NULL DEFAULT 0,
    present_count INTEGER NOT NULL DEFAULT 0,
    absent_count INTEGER NOT NULL DEFAULT 0,
    leave_count INTEGER NOT NULL DEFAULT 0,
    percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, subject_code)
);
CREATE INDEX IF NOT EXISTS idx_att_sum_user ON attendance_summaries(user_id);

-- Attendance Corrections (Workflow for corrections with audit trail)
CREATE TABLE IF NOT EXISTS attendance_corrections (
    id TEXT PRIMARY KEY,
    attendance_record_id BIGINT NOT NULL,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id),
    reviewed_by_user_id TEXT REFERENCES users(id),
    old_status TEXT NOT NULL,
    new_status TEXT NOT NULL CHECK (new_status IN ('present', 'absent', 'approved_leave')),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_att_corr_status ON attendance_corrections(status);
