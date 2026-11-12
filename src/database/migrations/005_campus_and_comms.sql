-- ====================================================================
-- MIGRATION 005: Campus Life, Communications, Telegram & System Logs
-- GUeAttend Unified University ERP
-- ====================================================================

-- Grievances Redressal
CREATE TABLE IF NOT EXISTS grievances (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('academic', 'examination', 'hostel', 'canteen', 'fee', 'general')),
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    attachment_url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'resolved', 'closed')),
    assigned_to_user_id TEXT REFERENCES users(id),
    resolution_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_grievances_student ON grievances(student_id);
CREATE INDEX IF NOT EXISTS idx_grievances_status ON grievances(status);

-- Grievance Responses / Discussion
CREATE TABLE IF NOT EXISTS grievance_responses (
    id TEXT PRIMARY KEY,
    grievance_id TEXT NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    attachment_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_griev_resp_grievance ON grievance_responses(grievance_id);

-- Circulars & Official Announcements
CREATE TABLE IF NOT EXISTS circulars (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    circular_number TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('academic', 'examination', 'administrative', 'holiday', 'sports', 'events')),
    target_audience TEXT NOT NULL DEFAULT 'all' CHECK (target_audience IN ('all', 'students', 'faculty', 'staff')),
    content TEXT NOT NULL,
    attachment_url TEXT DEFAULT '',
    published_by_user_id TEXT NOT NULL REFERENCES users(id),
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at DATE
);
CREATE INDEX IF NOT EXISTS idx_circulars_published ON circulars(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_circulars_audience ON circulars(target_audience);

-- Hostels
CREATE TABLE IF NOT EXISTS hostels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('boys', 'girls', 'co-ed')),
    warden_name TEXT NOT NULL,
    warden_phone TEXT NOT NULL,
    total_rooms INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hostel Room Allocations
CREATE TABLE IF NOT EXISTS hostel_allocations (
    id TEXT PRIMARY KEY,
    hostel_id TEXT NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    student_id TEXT UNIQUE NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    room_number TEXT NOT NULL,
    bed_number TEXT NOT NULL DEFAULT 'A',
    allocated_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vacated_date DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'vacated', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_student ON hostel_allocations(student_id);

-- Placement Drives & Opportunities
CREATE TABLE IF NOT EXISTS placements (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    ctc_lpa NUMERIC(6,2) NOT NULL,
    job_location TEXT NOT NULL,
    eligibility_min_cgpa NUMERIC(4,2) NOT NULL DEFAULT 6.00,
    eligible_courses JSONB NOT NULL DEFAULT '[]'::jsonb,
    max_active_backlogs INTEGER NOT NULL DEFAULT 0,
    drive_date DATE NOT NULL,
    application_deadline TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL,
    website_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_placements_deadline ON placements(application_deadline);

-- Student Placement Applications
CREATE TABLE IF NOT EXISTS placement_applications (
    id TEXT PRIMARY KEY,
    placement_id TEXT NOT NULL REFERENCES placements(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'shortlisted', 'interview_scheduled', 'selected', 'rejected')),
    resume_url TEXT DEFAULT '',
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(placement_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_placement_apps_student ON placement_applications(student_id);

-- In-App Notifications (Safe upgrade for existing table)
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT DEFAULT '';
ALTER TABLE notifications ALTER COLUMN kind DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN kind SET DEFAULT 'info';

CREATE INDEX IF NOT EXISTS idx_notifs_user_unread ON notifications(user_id, is_read);

-- Telegram Account Links & Link Tokens
CREATE TABLE IF NOT EXISTS telegram_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    telegram_chat_id TEXT UNIQUE NOT NULL,
    telegram_username TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    is_verified BOOLEAN NOT NULL DEFAULT TRUE,
    notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_chat_id ON telegram_accounts(telegram_chat_id);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_token_expires ON telegram_link_tokens(expires_at);

-- External Data Synchronization Logs
CREATE TABLE IF NOT EXISTS external_sync_logs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    records_processed INTEGER NOT NULL DEFAULT 0,
    records_inserted INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    errors_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    synced_by_user_id TEXT REFERENCES users(id),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_time ON external_sync_logs(synced_at DESC);

-- Security & Administrative Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);

-- Application Settings Key-Value Store
CREATE TABLE IF NOT EXISTS application_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value JSONB NOT NULL,
    description TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id TEXT REFERENCES users(id)
);
