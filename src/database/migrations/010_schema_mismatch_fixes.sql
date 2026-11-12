-- ====================================================================
-- MIGRATION 010: Forward-Only Schema Mismatch, Constraint & Security Fixes
-- Safely reconciles known_attendance, known_assignments, session_expiry_state,
-- attendance_records ON CONFLICT target, http_sessions, and contact_messages
-- without dropping existing tables or production data.
-- ====================================================================

-- 1. known_attendance vs scraper.js snapshot cache reconciliation
ALTER TABLE known_attendance ADD COLUMN IF NOT EXISTS records JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE known_attendance ALTER COLUMN subject_code SET DEFAULT '';
ALTER TABLE known_attendance ALTER COLUMN attendance_date SET DEFAULT '';
ALTER TABLE known_attendance ALTER COLUMN status SET DEFAULT '';
ALTER TABLE known_attendance ALTER COLUMN period_label SET DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'idx_known_attendance_user_snapshot'
  ) THEN
    CREATE UNIQUE INDEX idx_known_attendance_user_snapshot
      ON known_attendance (user_id, subject_code, attendance_date, period_label);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipped idx_known_attendance_user_snapshot due to duplicate rows.';
END $$;

-- 2. known_assignments vs scraper.js snapshot cache reconciliation
ALTER TABLE known_assignments ADD COLUMN IF NOT EXISTS records JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE known_assignments ALTER COLUMN assignment_key SET DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'idx_known_assignments_user_key'
  ) THEN
    CREATE UNIQUE INDEX idx_known_assignments_user_key
      ON known_assignments (user_id, assignment_key);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipped idx_known_assignments_user_key due to duplicate rows.';
END $$;

-- 3. session_expiry_state timestamp & status column reconciliation
ALTER TABLE session_expiry_state ADD COLUMN IF NOT EXISTS is_expired BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE session_expiry_state ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE session_expiry_state ADD COLUMN IF NOT EXISTS expired_at_ts TIMESTAMPTZ;
ALTER TABLE session_expiry_state ADD COLUMN IF NOT EXISTS last_alert_at_ts TIMESTAMPTZ;
ALTER TABLE session_expiry_state ADD COLUMN IF NOT EXISTS resolved_at_ts TIMESTAMPTZ;

UPDATE session_expiry_state
SET expired_at_ts = CASE
      WHEN expired_at_ts IS NULL AND expired_at IS NOT NULL AND expired_at > 100000000000 THEN to_timestamp(expired_at / 1000.0)
      WHEN expired_at_ts IS NULL AND expired_at IS NOT NULL AND expired_at > 0 THEN to_timestamp(expired_at)
      ELSE expired_at_ts
    END,
    last_alert_at_ts = CASE
      WHEN last_alert_at_ts IS NULL AND last_alert_at IS NOT NULL AND last_alert_at > 100000000000 THEN to_timestamp(last_alert_at / 1000.0)
      WHEN last_alert_at_ts IS NULL AND last_alert_at IS NOT NULL AND last_alert_at > 0 THEN to_timestamp(last_alert_at)
      ELSE last_alert_at_ts
    END,
    resolved_at_ts = CASE
      WHEN resolved_at_ts IS NULL AND resolved_at IS NOT NULL AND resolved_at > 100000000000 THEN to_timestamp(resolved_at / 1000.0)
      WHEN resolved_at_ts IS NULL AND resolved_at IS NOT NULL AND resolved_at > 0 THEN to_timestamp(resolved_at)
      ELSE resolved_at_ts
    END,
    is_expired = CASE
      WHEN resolved_at IS NOT NULL AND resolved_at > 0 THEN FALSE
      ELSE is_expired
    END
WHERE expired_at IS NOT NULL OR last_alert_at IS NOT NULL OR resolved_at IS NOT NULL;

-- 4. attendance_records ON CONFLICT (user_id, qid, subject_code, class_date) target index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'idx_attendance_records_upsert_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_attendance_records_upsert_unique
      ON attendance_records (user_id, qid, subject_code, class_date);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipped idx_attendance_records_upsert_unique due to existing duplicate records.';
END $$;

-- 5. PostgreSQL-backed HTTP Session Persistence for multi-restart reliability
CREATE TABLE IF NOT EXISTS http_sessions (
    sid TEXT PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_http_sessions_expire ON http_sessions (expire);
ALTER TABLE http_sessions ENABLE ROW LEVEL SECURITY;

-- 6. Public Landing Contact Messages Table
CREATE TABLE IF NOT EXISTS contact_messages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved')),
    ip_address TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages (created_at DESC);
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
