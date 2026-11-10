-- ====================================================================
-- MIGRATION 004: Examinations, Results & Fees Schema
-- GUeAttend Unified University ERP
-- ====================================================================

-- Examinations (Mid-term, End-term, Practical)
CREATE TABLE IF NOT EXISTS examinations (
    id TEXT PRIMARY KEY,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                     -- e.g. "End Term Examinations Dec 2026"
    exam_type TEXT NOT NULL CHECK (exam_type IN ('mid_term', 'end_term', 'practical', 'supplementary')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    admit_card_released BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exams_session_sem ON examinations(academic_session_id, semester_id);

-- Examination Schedules (Subject-wise dates, timings, venues)
CREATE TABLE IF NOT EXISTS exam_schedules (
    id TEXT PRIMARY KEY,
    examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    exam_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    classroom_id TEXT REFERENCES classrooms(id),
    max_marks NUMERIC(5,2) NOT NULL DEFAULT 100.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(examination_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_sched_date ON exam_schedules(exam_date);

-- Marks (Internal, External, Practical, Grade)
CREATE TABLE IF NOT EXISTS marks (
    id TEXT PRIMARY KEY,
    examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    internal_marks NUMERIC(5,2) DEFAULT 0.0,
    external_marks NUMERIC(5,2) DEFAULT 0.0,
    total_marks NUMERIC(5,2) NOT NULL DEFAULT 0.0,
    max_marks NUMERIC(5,2) NOT NULL DEFAULT 100.0,
    grade_letter TEXT DEFAULT '',           -- 'O', 'A+', 'A', 'B+', 'B', 'C', 'F'
    grade_point NUMERIC(3,1) DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'pass' CHECK (status IN ('pass', 'fail', 'absent', 'detained')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(examination_id, student_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);

-- Student Semester Results (SGPA, CGPA, Promotion status)
CREATE TABLE IF NOT EXISTS student_results (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    sgpa NUMERIC(4,2) NOT NULL DEFAULT 0.00,
    cgpa NUMERIC(4,2) NOT NULL DEFAULT 0.00,
    total_credits_earned INTEGER NOT NULL DEFAULT 0,
    result_status TEXT NOT NULL DEFAULT 'pass' CHECK (result_status IN ('pass', 'fail', 'promoted_with_backlog', 'withheld')),
    backlog_count INTEGER NOT NULL DEFAULT 0,
    published_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, semester_id)
);
CREATE INDEX IF NOT EXISTS idx_results_student ON student_results(student_id);

-- Backlogs Tracking
CREATE TABLE IF NOT EXISTS backlogs (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    original_semester_id TEXT NOT NULL REFERENCES semesters(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleared')),
    cleared_at_session_id TEXT REFERENCES academic_sessions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backlogs_student ON backlogs(student_id);

-- Fee Structures (Defined per course, semester, session)
CREATE TABLE IF NOT EXISTS fee_structures (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    academic_session_id TEXT NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    tuition_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    examination_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    hostel_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    library_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    other_charges NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    due_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course_id, semester_id, academic_session_id)
);

-- Student Fees (Individual student fee ledger)
CREATE TABLE IF NOT EXISTS student_fees (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    fee_structure_id TEXT NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
    total_due NUMERIC(10,2) NOT NULL,
    amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    balance_due NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid', 'partially_paid', 'unpaid', 'overdue')),
    due_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, fee_structure_id)
);
CREATE INDEX IF NOT EXISTS idx_student_fees_student ON student_fees(student_id);

-- Payments & Receipts
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    student_fee_id TEXT NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    receipt_number TEXT UNIQUE NOT NULL,    -- e.g. "RCP-2026-9812"
    amount NUMERIC(10,2) NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('online_gateway', 'bank_transfer', 'upi', 'demand_draft', 'cash')),
    transaction_reference TEXT UNIQUE NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'completed' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_by_user_id TEXT REFERENCES users(id),
    receipt_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_receipt ON payments(receipt_number);

