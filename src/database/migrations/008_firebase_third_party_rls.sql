-- ====================================================================
-- MIGRATION 008: Supabase Third-Party Firebase Auth RLS Hardening
-- Firebase Project: gueattend | Supabase Ref: cnpullmxupyqdndxzbih
--
-- Keeps application roles ('student', 'faculty', 'admin') strictly
-- separate from the PostgreSQL `authenticated` database role.
-- Maps incoming Firebase JWT `sub` claim (`auth.jwt() ->> 'sub'`) to
-- `public.users.firebase_uid`.
-- ====================================================================

-- 1. Extract verified Firebase UID from Supabase / PostgREST JWT claims
CREATE OR REPLACE FUNCTION public.firebase_uid()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    NULL
  );
$$;

-- 2. Resolve internal active GUeAttend user ID (never exposes suspended users)
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.users
  WHERE firebase_uid = public.firebase_uid()
    AND is_active = TRUE
    AND is_suspended = FALSE
  LIMIT 1;
$$;

-- 3. Resolve application role ('admin', 'faculty', 'student') independently of DB role `authenticated`
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN is_admin = TRUE THEN 'admin'
    ELSE COALESCE(role, 'student')
  END
  FROM public.users
  WHERE firebase_uid = public.firebase_uid()
    AND is_active = TRUE
    AND is_suspended = FALSE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_role() = 'admin', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_role() IN ('faculty', 'admin'), FALSE);
$$;

-- 4. Least-privilege schema & column grants for `authenticated` vs `anon`
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA public TO authenticated;

    -- Restrict `users` columns so password_hash and encrypted ERP secrets are never readable/writable via PostgREST
    REVOKE ALL ON public.users FROM authenticated;
    GRANT SELECT (
      id, email, full_name, student_name, role, is_admin, phone, avatar_url,
      firebase_uid, qums_qid, qums_session_status, active_erp_type,
      email_verified, is_active, is_suspended, telegram_chat_id,
      attendance_last_checked_at, assignment_last_checked_at, created_at, updated_at
    ) ON public.users TO authenticated;
    GRANT UPDATE (full_name, phone, avatar_url) ON public.users TO authenticated;

    GRANT SELECT ON public.students, public.faculty, public.faculty_subjects,
      public.departments, public.courses, public.semesters, public.sections,
      public.subjects, public.academic_sessions, public.classrooms,
      public.timetable_periods, public.timetable, public.class_substitutions,
      public.lecture_plans, public.study_materials, public.assignments,
      public.examinations, public.exam_schedules, public.circulars,
      public.hostels, public.placements
    TO authenticated;

    GRANT SELECT, INSERT, UPDATE ON public.attendance_sessions, public.attendance_records,
      public.marks, public.student_results, public.student_fees, public.payments,
      public.grievances, public.grievance_responses, public.notifications,
      public.telegram_accounts, public.telegram_link_tokens, public.assignment_submissions
    TO authenticated;

    GRANT SELECT ON public.audit_logs, public.notification_log, public.reconnect_events TO authenticated;
  END IF;
END $$;

-- 5. Enable RLS across sensitive & operational tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grievance_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconnect_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_expiry_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.known_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.known_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circulars ENABLE ROW LEVEL SECURITY;

-- 6. Clean Policies Bound to `TO authenticated` (using `public.current_app_user_id()`)

-- USERS
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile"
  ON public.users FOR SELECT TO authenticated
  USING (id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE TO authenticated
  USING (id = public.current_app_user_id() OR public.is_admin())
  WITH CHECK (id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage users" ON public.users;
CREATE POLICY "Admins can manage users"
  ON public.users FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- STUDENTS
DROP POLICY IF EXISTS "Students read own record" ON public.students;
CREATE POLICY "Students read own record"
  ON public.students FOR SELECT TO authenticated
  USING (
    user_id = public.current_app_user_id()
    OR public.is_faculty()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins manage students" ON public.students;
CREATE POLICY "Admins manage students"
  ON public.students FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- FACULTY
DROP POLICY IF EXISTS "Faculty read own profile" ON public.faculty;
CREATE POLICY "Faculty read own profile"
  ON public.faculty FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage faculty" ON public.faculty;
CREATE POLICY "Admins manage faculty"
  ON public.faculty FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated read faculty subjects" ON public.faculty_subjects;
CREATE POLICY "Authenticated read faculty subjects"
  ON public.faculty_subjects FOR SELECT TO authenticated
  USING (TRUE);

-- TIMETABLE & CIRCULARS
DROP POLICY IF EXISTS "Authenticated read timetable" ON public.timetable;
CREATE POLICY "Authenticated read timetable"
  ON public.timetable FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins manage timetable" ON public.timetable;
CREATE POLICY "Admins manage timetable"
  ON public.timetable FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated read circulars" ON public.circulars;
CREATE POLICY "Authenticated read circulars"
  ON public.circulars FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins manage circulars" ON public.circulars;
CREATE POLICY "Admins manage circulars"
  ON public.circulars FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ATTENDANCE SESSIONS & RECORDS
DROP POLICY IF EXISTS "Faculty and students read attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Faculty and students read attendance sessions"
  ON public.attendance_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.faculty f WHERE f.id = attendance_sessions.faculty_id AND f.user_id = public.current_app_user_id())
    OR EXISTS (SELECT 1 FROM public.students st WHERE st.section_id = attendance_sessions.section_id AND st.user_id = public.current_app_user_id())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Faculty manage own attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Faculty manage own attendance sessions"
  ON public.attendance_sessions FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.faculty f WHERE f.id = attendance_sessions.faculty_id AND f.user_id = public.current_app_user_id())
    OR public.is_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.faculty f WHERE f.id = attendance_sessions.faculty_id AND f.user_id = public.current_app_user_id())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Students read own attendance" ON public.attendance_records;
CREATE POLICY "Students read own attendance"
  ON public.attendance_records FOR SELECT TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR EXISTS (
      SELECT 1 FROM public.attendance_sessions s
      JOIN public.faculty f ON s.faculty_id = f.id
      WHERE s.id = attendance_records.session_id AND f.user_id = public.current_app_user_id()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Faculty can mark and update attendance" ON public.attendance_records;
CREATE POLICY "Faculty can mark and update attendance"
  ON public.attendance_records FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_sessions s
      JOIN public.faculty f ON s.faculty_id = f.id
      WHERE s.id = attendance_records.session_id AND f.user_id = public.current_app_user_id()
    )
    OR public.is_admin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_sessions s
      JOIN public.faculty f ON s.faculty_id = f.id
      WHERE s.id = attendance_records.session_id AND f.user_id = public.current_app_user_id()
    )
    OR public.is_admin()
  );

-- ASSIGNMENTS & SUBMISSIONS
DROP POLICY IF EXISTS "Authenticated read assignments" ON public.assignments;
CREATE POLICY "Authenticated read assignments"
  ON public.assignments FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Faculty manage own subject assignments" ON public.assignments;
CREATE POLICY "Faculty manage own subject assignments"
  ON public.assignments FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.faculty f WHERE f.id = assignments.faculty_id AND f.user_id = public.current_app_user_id())
    OR public.is_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.faculty f WHERE f.id = assignments.faculty_id AND f.user_id = public.current_app_user_id())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Students manage own submissions" ON public.assignment_submissions;
CREATE POLICY "Students manage own submissions"
  ON public.assignment_submissions FOR ALL TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_faculty()
    OR public.is_admin()
  )
  WITH CHECK (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_admin()
  );

-- MARKS & RESULTS
DROP POLICY IF EXISTS "Students read own marks" ON public.marks;
CREATE POLICY "Students read own marks"
  ON public.marks FOR SELECT TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR EXISTS (
      SELECT 1 FROM public.faculty_subjects fs
      JOIN public.faculty f ON fs.faculty_id = f.id
      WHERE fs.subject_id = marks.subject_id AND f.user_id = public.current_app_user_id()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Faculty can grade assigned subjects" ON public.marks;
CREATE POLICY "Faculty can grade assigned subjects"
  ON public.marks FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.faculty_subjects fs
      JOIN public.faculty f ON fs.faculty_id = f.id
      WHERE fs.subject_id = marks.subject_id AND f.user_id = public.current_app_user_id()
    )
    OR public.is_admin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.faculty_subjects fs
      JOIN public.faculty f ON fs.faculty_id = f.id
      WHERE fs.subject_id = marks.subject_id AND f.user_id = public.current_app_user_id()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Students read own semester results" ON public.student_results;
CREATE POLICY "Students read own semester results"
  ON public.student_results FOR SELECT TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_admin()
  );

-- FEES & PAYMENTS
DROP POLICY IF EXISTS "Students read own fees" ON public.student_fees;
CREATE POLICY "Students read own fees"
  ON public.student_fees FOR SELECT TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins manage fees and payments" ON public.student_fees;
CREATE POLICY "Admins manage fees and payments"
  ON public.student_fees FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Students read own payments" ON public.payments;
CREATE POLICY "Students read own payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Admins manage payment records" ON public.payments;
CREATE POLICY "Admins manage payment records"
  ON public.payments FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- GRIEVANCES
DROP POLICY IF EXISTS "Students manage own grievances" ON public.grievances;
CREATE POLICY "Students manage own grievances"
  ON public.grievances FOR ALL TO authenticated
  USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_faculty()
    OR public.is_admin()
  )
  WITH CHECK (
    student_id IN (SELECT id FROM public.students WHERE user_id = public.current_app_user_id())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "Users read own grievance responses" ON public.grievance_responses;
CREATE POLICY "Users read own grievance responses"
  ON public.grievance_responses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.grievances g
      JOIN public.students s ON s.id = g.student_id
      WHERE g.id = grievance_responses.grievance_id AND s.user_id = public.current_app_user_id()
    )
    OR public.is_faculty()
    OR public.is_admin()
  );

-- NOTIFICATIONS & TELEGRAM
DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
CREATE POLICY "Users manage own notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin())
  WITH CHECK (user_id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "Users manage own telegram link" ON public.telegram_accounts;
CREATE POLICY "Users manage own telegram link"
  ON public.telegram_accounts FOR ALL TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin())
  WITH CHECK (user_id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "Users manage own telegram tokens" ON public.telegram_link_tokens;
CREATE POLICY "Users manage own telegram tokens"
  ON public.telegram_link_tokens FOR ALL TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin())
  WITH CHECK (user_id = public.current_app_user_id() OR public.is_admin());

-- ADMIN / SYSTEM LOGS
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Admins read audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users read own notification logs" ON public.notification_log;
CREATE POLICY "Users read own notification logs"
  ON public.notification_log FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin());

DROP POLICY IF EXISTS "Users read own reconnect events" ON public.reconnect_events;
CREATE POLICY "Users read own reconnect events"
  ON public.reconnect_events FOR SELECT TO authenticated
  USING (user_id = public.current_app_user_id() OR public.is_admin());

