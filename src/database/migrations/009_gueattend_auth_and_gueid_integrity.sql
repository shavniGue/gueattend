-- ====================================================================
-- MIGRATION 009: Firebase Single-Identity & GUeID Integrity Guards
-- Ensures Firebase passwords are never required in Supabase `users`
-- and adds safe uniqueness guards on `firebase_uid` & `qums_qid`.
-- ====================================================================

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT '!FIREBASE_MANAGED_DO_NOT_USE!';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_users_firebase_uid_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_users_firebase_uid_unique
      ON users (firebase_uid)
      WHERE firebase_uid IS NOT NULL AND firebase_uid <> '';
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipped unique index idx_users_firebase_uid_unique due to pre-existing duplicate firebase_uid rows.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_users_qums_qid_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_users_qums_qid_unique
      ON users (qums_qid)
      WHERE qums_qid IS NOT NULL AND qums_qid <> '';
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Skipped unique index idx_users_qums_qid_unique due to pre-existing duplicate qums_qid rows.';
END $$;
