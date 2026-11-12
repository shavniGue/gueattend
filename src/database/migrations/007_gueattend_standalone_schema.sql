-- ====================================================================
-- MIGRATION 007: GUeAttend Standalone ERP Portal & Monitoring Schema
-- Safe to execute on a brand-new empty GUeAttend database or an existing DB
-- ====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qums_qid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qums_password_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qums_session_path TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qums_session_data TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qums_session_status TEXT NOT NULL DEFAULT 'disconnected';
ALTER TABLE users ADD COLUMN IF NOT EXISTS qums_year_sem TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_last_checked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assignment_last_checked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_synced_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monitoring_started_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS monitoring_started_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_attendance_sync_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_assignment_sync_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reconnect_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reconnected_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reconnect_count_telegram INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reconnect_count_web INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_erp_type TEXT DEFAULT 'GEU';
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_password_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_session_path TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_session_data TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_session_status TEXT DEFAULT 'not_setup';
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_student_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_qid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_academic_year TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_semester TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_course TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_erp_last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_qums_qid ON users(qums_qid);

CREATE TABLE IF NOT EXISTS notification_log (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    reference_id TEXT DEFAULT '',
    dedupe_key TEXT DEFAULT '',
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id);

CREATE TABLE IF NOT EXISTS reconnect_events (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    reconnected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_expiry_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    expired_at BIGINT,
    last_alert_at BIGINT,
    alert_count INTEGER NOT NULL DEFAULT 0,
    resolved_at BIGINT,
    note TEXT DEFAULT '',
    telegram_message_id TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scheduled_message_deletions (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    delete_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_msg_delete_at ON scheduled_message_deletions(delete_at);

CREATE TABLE IF NOT EXISTS known_attendance (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_code TEXT NOT NULL,
    attendance_date TEXT NOT NULL,
    period_label TEXT DEFAULT '',
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS known_assignments (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignment_key TEXT NOT NULL,
    title TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

