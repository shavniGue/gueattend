-- ====================================================================
-- MIGRATION 006: Row Level Security (RLS) Policies
-- GUeAttend Unified University ERP
-- ====================================================================

-- 1. Enable RLS on Sensitive Tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function to check if requesting user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()::text AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Users Table Policies
-- Users can view their own profile, Admins can view/manage all
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile"
    ON users FOR SELECT
    USING (id = auth.uid()::text OR is_admin());

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile"
    ON users FOR UPDATE
    USING (id = auth.uid()::text OR is_admin());

DROP POLICY IF EXISTS "Admins can manage users" ON users;
CREATE POLICY "Admins can manage users"
    ON users FOR ALL
    USING (is_admin());

-- 3. Students Table Policies
-- Students can only read their own student record; Faculty & Admin can read
DROP POLICY IF EXISTS "Students read own record" ON students;
CREATE POLICY "Students read own record"
    ON students FOR SELECT
    USING (
        user_id = auth.uid()::text 
        OR EXISTS (SELECT 1 FROM faculty WHERE user_id = auth.uid()::text)
        OR is_admin()
    );

DROP POLICY IF EXISTS "Admins manage students" ON students;
CREATE POLICY "Admins manage students"
    ON students FOR ALL
    USING (is_admin());

-- 4. Attendance Records Policies
-- Students can read only their own attendance records
-- Faculty can view and mark attendance for their assigned sessions
-- Admins have full access
DROP POLICY IF EXISTS "Students read own attendance" ON attendance_records;
CREATE POLICY "Students read own attendance"
    ON attendance_records FOR SELECT
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid()::text)
        OR EXISTS (
            SELECT 1 FROM attendance_sessions s
            JOIN faculty f ON s.faculty_id = f.id
            WHERE s.id = attendance_records.session_id AND f.user_id = auth.uid()::text
        )
        OR is_admin()
    );

DROP POLICY IF EXISTS "Faculty can mark and update attendance" ON attendance_records;
CREATE POLICY "Faculty can mark and update attendance"
    ON attendance_records FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM attendance_sessions s
            JOIN faculty f ON s.faculty_id = f.id
            WHERE s.id = attendance_records.session_id AND f.user_id = auth.uid()::text
        )
        OR is_admin()
    );

-- 5. Marks & Results Policies
-- Students can only view their own marks and results
-- Faculty can insert/update marks for their subjects
-- Admins have full access
DROP POLICY IF EXISTS "Students read own marks" ON marks;
CREATE POLICY "Students read own marks"
    ON marks FOR SELECT
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid()::text)
        OR EXISTS (
            SELECT 1 FROM faculty_subjects fs
            JOIN faculty f ON fs.faculty_id = f.id
            WHERE fs.subject_id = marks.subject_id AND f.user_id = auth.uid()::text
        )
        OR is_admin()
    );

DROP POLICY IF EXISTS "Faculty can grade assigned subjects" ON marks;
CREATE POLICY "Faculty can grade assigned subjects"
    ON marks FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM faculty_subjects fs
            JOIN faculty f ON fs.faculty_id = f.id
            WHERE fs.subject_id = marks.subject_id AND f.user_id = auth.uid()::text
        )
        OR is_admin()
    );

DROP POLICY IF EXISTS "Students read own semester results" ON student_results;
CREATE POLICY "Students read own semester results"
    ON student_results FOR SELECT
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid()::text)
        OR is_admin()
    );

-- 6. Fees & Payments Policies
-- Students can only view their own fees and payment receipts
-- Admins manage fees and verify payments
DROP POLICY IF EXISTS "Students read own fees" ON student_fees;
CREATE POLICY "Students read own fees"
    ON student_fees FOR SELECT
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid()::text)
        OR is_admin()
    );

DROP POLICY IF EXISTS "Students read own payments" ON payments;
CREATE POLICY "Students read own payments"
    ON payments FOR SELECT
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid()::text)
        OR is_admin()
    );

DROP POLICY IF EXISTS "Admins manage fees and payments" ON student_fees;
CREATE POLICY "Admins manage fees and payments"
    ON student_fees FOR ALL
    USING (is_admin());

DROP POLICY IF EXISTS "Admins manage payment records" ON payments;
CREATE POLICY "Admins manage payment records"
    ON payments FOR ALL
    USING (is_admin());

-- 7. Grievances Policies
-- Students can read and create their own grievances
-- Admins/Faculty can read assigned grievances and update status
DROP POLICY IF EXISTS "Students manage own grievances" ON grievances;
CREATE POLICY "Students manage own grievances"
    ON grievances FOR ALL
    USING (
        student_id IN (SELECT id FROM students WHERE user_id = auth.uid()::text)
        OR is_admin()
    );

-- 8. Notifications Policies
-- Users can only see and mark read their own notifications
DROP POLICY IF EXISTS "Users manage own notifications" ON notifications;
CREATE POLICY "Users manage own notifications"
    ON notifications FOR ALL
    USING (user_id = auth.uid()::text OR is_admin());

-- 9. Telegram Accounts Policies
DROP POLICY IF EXISTS "Users manage own telegram link" ON telegram_accounts;
CREATE POLICY "Users manage own telegram link"
    ON telegram_accounts FOR ALL
    USING (user_id = auth.uid()::text OR is_admin());

