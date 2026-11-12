/**
 * Seed Script for GUeAttend
 * Populates realistic Graphic Era University ERP records for demonstration, local development, and testing.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { assertDatabaseIsolation } = require('./identity');

async function seedDatabase() {
  assertDatabaseIsolation();
  console.log('[seed] Starting GUeAttend database seed...');

  const passwordHash = await bcrypt.hash('Password@123', 10);

  await db.withTransaction(async (client) => {
    // 1. Create Core Users
    console.log('[seed] Seeding users...');
    await client.query(`
      INSERT INTO users (id, email, password_hash, role, full_name, phone, is_active, email_verified)
      VALUES 
        ('usr_admin_1', 'admin@geu.ac.in', $1, 'admin', 'University Administrator', '+91 9876543210', TRUE, TRUE),
        ('usr_fac_1', 'faculty.cse@geu.ac.in', $1, 'faculty', 'Dr. Rajesh Sharma', '+91 9876543211', TRUE, TRUE),
        ('usr_fac_2', 'faculty.math@geu.ac.in', $1, 'faculty', 'Prof. Sunita Verma', '+91 9876543212', TRUE, TRUE),
        ('usr_fac_3', 'faculty.os@geu.ac.in', $1, 'faculty', 'Dr. Amit Chauhan', '+91 9876543213', TRUE, TRUE),
        ('usr_stu_1', 'karan.kumar@geu.ac.in', $1, 'student', 'Karan Kumar', '+91 8053106992', TRUE, TRUE),
        ('usr_stu_2', 'shavani.gupta@geu.ac.in', $1, 'student', 'Shavani Gupta', '+91 9876543215', TRUE, TRUE)
      ON CONFLICT (id) DO UPDATE SET 
        full_name = EXCLUDED.full_name,
        password_hash = EXCLUDED.password_hash;
    `, [passwordHash]);

    // 2. Academic Session
    console.log('[seed] Seeding academic session...');
    await client.query(`
      INSERT INTO academic_sessions (id, session_name, start_date, end_date, is_current)
      VALUES ('sess_2026_2027', '2026-2027', '2026-08-01', '2027-06-30', TRUE)
      ON CONFLICT (id) DO UPDATE SET is_current = TRUE;
    `);

    // 3. Departments
    console.log('[seed] Seeding departments...');
    await client.query(`
      INSERT INTO departments (id, code, name, head_of_department)
      VALUES 
        ('dept_cse', 'CSE', 'Computer Science & Engineering', 'Prof. Devesh Pratap'),
        ('dept_ece', 'ECE', 'Electronics & Communication Engineering', 'Dr. Anurag Sharma'),
        ('dept_mgmt', 'DOMS', 'Department of Management Studies', 'Dr. Rupa Khanna')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 4. Courses
    console.log('[seed] Seeding courses...');
    await client.query(`
      INSERT INTO courses (id, department_id, code, name, duration_years, total_semesters)
      VALUES 
        ('course_btech_cse', 'dept_cse', 'BTECH_CSE', 'Bachelor of Technology in Computer Science & Engineering', 4, 8),
        ('course_bca', 'dept_cse', 'BCA', 'Bachelor of Computer Applications', 3, 6)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 5. Semesters
    console.log('[seed] Seeding semesters...');
    await client.query(`
      INSERT INTO semesters (id, course_id, semester_number, academic_session_id)
      VALUES 
        ('sem_btech_cse_5', 'course_btech_cse', 5, 'sess_2026_2027'),
        ('sem_btech_cse_6', 'course_btech_cse', 6, 'sess_2026_2027')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 6. Sections
    console.log('[seed] Seeding sections...');
    await client.query(`
      INSERT INTO sections (id, semester_id, name, capacity)
      VALUES 
        ('sec_btech_cse_5_g4', 'sem_btech_cse_5', 'G4', 60),
        ('sec_btech_cse_5_a', 'sem_btech_cse_5', 'A', 60)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 7. Faculty Details
    console.log('[seed] Seeding faculty profiles...');
    await client.query(`
      INSERT INTO faculty (id, user_id, employee_id, department_id, designation, qualification, specialization)
      VALUES 
        ('fac_1', 'usr_fac_1', 'EMP-1001', 'dept_cse', 'Professor & HoD', 'Ph.D. in Computer Science', 'Distributed Systems & Cloud'),
        ('fac_2', 'usr_fac_2', 'EMP-1002', 'dept_cse', 'Associate Professor', 'M.Tech, Ph.D.', 'Theoretical Computer Science'),
        ('fac_3', 'usr_fac_3', 'EMP-1003', 'dept_cse', 'Assistant Professor', 'Ph.D.', 'Operating Systems & Kernels')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 8. Student Details
    console.log('[seed] Seeding student profiles...');
    await client.query(`
      INSERT INTO students (id, user_id, student_id, enrollment_number, roll_number, department_id, course_id, semester_id, section_id, academic_session_id, date_of_birth, gender, blood_group, father_name)
      VALUES 
        ('stu_1', 'usr_stu_1', '24030110', 'GEU/2024/0110', '60', 'dept_cse', 'course_btech_cse', 'sem_btech_cse_5', 'sec_btech_cse_5_g4', 'sess_2026_2027', '2004-06-15', 'Male', 'O+', 'Rajesh Kumar'),
        ('stu_2', 'usr_stu_2', '24030111', 'GEU/2024/0111', '61', 'dept_cse', 'course_btech_cse', 'sem_btech_cse_5', 'sec_btech_cse_5_g4', 'sess_2026_2027', '2004-08-20', 'Female', 'B+', 'Suresh Gupta')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 9. Classrooms
    console.log('[seed] Seeding classrooms...');
    await client.query(`
      INSERT INTO classrooms (id, room_number, building, floor, capacity)
      VALUES 
        ('cr_301', 'CR-301', 'Chanakya Block', 3, 70),
        ('cr_302', 'CR-302', 'Chanakya Block', 3, 70),
        ('lab_4', 'LAB-4', 'Aryabhatta Computing Centre', 2, 60),
        ('lab_2', 'LAB-2', 'Aryabhatta Computing Centre', 1, 60)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 10. Timetable Periods
    console.log('[seed] Seeding timetable periods...');
    await client.query(`
      INSERT INTO timetable_periods (period_number, label, start_time, end_time, is_break)
      VALUES 
        (1, 'Period 1', '09:00:00', '09:55:00', FALSE),
        (2, 'Period 2', '09:55:00', '10:50:00', FALSE),
        (3, 'Period 3', '11:05:00', '12:00:00', FALSE),
        (4, 'Period 4', '12:00:00', '12:55:00', FALSE),
        (5, 'Period 5', '13:45:00', '14:40:00', FALSE),
        (6, 'Period 6', '14:40:00', '15:35:00', FALSE)
      ON CONFLICT (period_number) DO UPDATE SET 
        label = EXCLUDED.label,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time;
    `);

    // 11. Subjects
    console.log('[seed] Seeding subjects...');
    await client.query(`
      INSERT INTO subjects (id, course_id, semester_id, code, name, credits, subject_type)
      VALUES 
        ('subj_dbms', 'course_btech_cse', 'sem_btech_cse_5', 'TCS-501', 'Database Management Systems', 4, 'theory'),
        ('subj_os', 'course_btech_cse', 'sem_btech_cse_5', 'TCS-502', 'Operating Systems', 4, 'theory'),
        ('subj_daa', 'course_btech_cse', 'sem_btech_cse_5', 'TCS-503', 'Design & Analysis of Algorithms', 4, 'theory'),
        ('subj_se', 'course_btech_cse', 'sem_btech_cse_5', 'TCS-504', 'Software Engineering Principles', 3, 'theory'),
        ('subj_dbms_lab', 'course_btech_cse', 'sem_btech_cse_5', 'PCS-501', 'DBMS Laboratory', 2, 'practical'),
        ('subj_os_lab', 'course_btech_cse', 'sem_btech_cse_5', 'PCS-502', 'Operating Systems Lab', 2, 'practical')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 12. Faculty Subjects Allocation
    console.log('[seed] Seeding faculty-subject allocation...');
    await client.query(`
      INSERT INTO faculty_subjects (id, faculty_id, subject_id, section_id, academic_session_id)
      VALUES 
        ('fs_1', 'fac_1', 'subj_dbms', 'sec_btech_cse_5_g4', 'sess_2026_2027'),
        ('fs_2', 'fac_3', 'subj_os', 'sec_btech_cse_5_g4', 'sess_2026_2027'),
        ('fs_3', 'fac_2', 'subj_daa', 'sec_btech_cse_5_g4', 'sess_2026_2027'),
        ('fs_4', 'fac_1', 'subj_dbms_lab', 'sec_btech_cse_5_g4', 'sess_2026_2027')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 13. Timetable Schedule (Monday to Saturday)
    console.log('[seed] Seeding timetable...');
    const timetableRows = [
      // Monday (1)
      ['tt_mon_1', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms', 'fac_1', 'cr_301', 1, 1, 'theory'],
      ['tt_mon_2', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os', 'fac_3', 'cr_301', 1, 2, 'theory'],
      ['tt_mon_3', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_daa', 'fac_2', 'cr_301', 1, 3, 'theory'],
      ['tt_mon_4', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_se', 'fac_1', 'cr_301', 1, 4, 'theory'],
      ['tt_mon_5', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms_lab', 'fac_1', 'lab_4', 1, 5, 'practical'],
      // Tuesday (2)
      ['tt_tue_1', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_daa', 'fac_2', 'cr_301', 2, 1, 'theory'],
      ['tt_tue_2', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms', 'fac_1', 'cr_301', 2, 2, 'theory'],
      ['tt_tue_3', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os', 'fac_3', 'cr_301', 2, 3, 'theory'],
      ['tt_tue_4', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_se', 'fac_1', 'cr_301', 2, 4, 'theory'],
      // Wednesday (3)
      ['tt_wed_1', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os', 'fac_3', 'cr_301', 3, 1, 'theory'],
      ['tt_wed_2', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_daa', 'fac_2', 'cr_301', 3, 2, 'theory'],
      ['tt_wed_3', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms', 'fac_1', 'cr_301', 3, 3, 'theory'],
      ['tt_wed_4', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os_lab', 'fac_3', 'lab_2', 3, 4, 'practical'],
      ['tt_wed_5', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os_lab', 'fac_3', 'lab_2', 3, 5, 'practical'],
      // Thursday (4)
      ['tt_thu_1', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms', 'fac_1', 'cr_301', 4, 1, 'theory'],
      ['tt_thu_2', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_se', 'fac_1', 'cr_301', 4, 2, 'theory'],
      ['tt_thu_3', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os', 'fac_3', 'cr_301', 4, 3, 'theory'],
      ['tt_thu_4', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_daa', 'fac_2', 'cr_301', 4, 4, 'theory'],
      // Friday (5)
      ['tt_fri_1', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_daa', 'fac_2', 'cr_301', 5, 1, 'theory'],
      ['tt_fri_2', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms', 'fac_1', 'cr_301', 5, 2, 'theory'],
      ['tt_fri_3', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_os', 'fac_3', 'cr_301', 5, 3, 'theory'],
      ['tt_fri_4', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_se', 'fac_1', 'cr_301', 5, 4, 'theory'],
      // Saturday (6)
      ['tt_sat_1', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_se', 'fac_1', 'cr_301', 6, 1, 'theory'],
      ['tt_sat_2', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms_lab', 'fac_1', 'lab_4', 6, 2, 'practical'],
      ['tt_sat_3', 'sess_2026_2027', 'sec_btech_cse_5_g4', 'subj_dbms_lab', 'fac_1', 'lab_4', 6, 3, 'practical'],
    ];

    for (const r of timetableRows) {
      await client.query(`
        INSERT INTO timetable (id, academic_session_id, section_id, subject_id, faculty_id, classroom_id, day_of_week, period_number, class_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (academic_session_id, section_id, day_of_week, period_number) DO NOTHING;
      `, r);
    }

    // 14. Attendance Sessions & Records (Historical & Today)
    console.log('[seed] Seeding attendance records across multiple dates...');
    const dates = [
      // November 2026
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10',
      // October 2026
      '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
      // September 2026
      '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16'
    ];

    let sessionIdx = 1;
    for (const d of dates) {
      const isToday = d === '2026-11-10';
      // Periods 1 to 4
      const periods = isToday ? [1, 2, 3] : [1, 2, 3, 4];
      for (const p of periods) {
        const sessId = `att_sess_${sessionIdx++}`;
        const subjId = p === 1 ? 'subj_dbms' : p === 2 ? 'subj_os' : p === 3 ? 'subj_daa' : 'subj_se';
        const facId = p === 1 ? 'fac_1' : p === 2 ? 'fac_3' : p === 3 ? 'fac_2' : 'fac_1';

        await client.query(`
          INSERT INTO attendance_sessions (id, academic_session_id, section_id, subject_id, faculty_id, class_date, period_number, duration_minutes, marked_at)
          VALUES ($1, 'sess_2026_2027', 'sec_btech_cse_5_g4', $2, $3, $4::date, $5, 55, NOW())
          ON CONFLICT (academic_session_id, section_id, class_date, period_number) DO NOTHING;
        `, [sessId, subjId, facId, d, p]);

        // Student 1 status: mostly present (85%+ attendance)
        const statusStu1 = (sessionIdx % 9 === 0) ? 'absent' : 'present';
        await client.query(`
          INSERT INTO attendance_records (user_id, qid, subject_code, subject_name, class_date, session_id, student_id, status, remarks)
          VALUES ('usr_stu_1', '24030110', $1, $2, $3::text, $4, 'stu_1', $5, 'Regular Lecture')
          ON CONFLICT (user_id, qid, subject_code, class_date) DO UPDATE SET 
            status = EXCLUDED.status,
            session_id = EXCLUDED.session_id,
            student_id = EXCLUDED.student_id;
        `, [subjId === 'subj_dbms' ? 'TCS-501' : subjId === 'subj_os' ? 'TCS-502' : subjId === 'subj_daa' ? 'TCS-503' : 'TCS-504',
            subjId === 'subj_dbms' ? 'Database Management Systems' : subjId === 'subj_os' ? 'Operating Systems' : subjId === 'subj_daa' ? 'Design & Analysis of Algorithms' : 'Software Engineering Principles',
            d, sessId, statusStu1]);

        // Student 2 status
        const statusStu2 = (sessionIdx % 4 === 0) ? 'absent' : 'present';
        await client.query(`
          INSERT INTO attendance_records (user_id, qid, subject_code, subject_name, class_date, session_id, student_id, status, remarks)
          VALUES ('usr_stu_2', '24030111', $1, $2, $3::text, $4, 'stu_2', $5, 'Regular Lecture')
          ON CONFLICT (user_id, qid, subject_code, class_date) DO UPDATE SET 
            status = EXCLUDED.status,
            session_id = EXCLUDED.session_id,
            student_id = EXCLUDED.student_id;
        `, [subjId === 'subj_dbms' ? 'TCS-501' : subjId === 'subj_os' ? 'TCS-502' : subjId === 'subj_daa' ? 'TCS-503' : 'TCS-504',
            subjId === 'subj_dbms' ? 'Database Management Systems' : subjId === 'subj_os' ? 'Operating Systems' : subjId === 'subj_daa' ? 'Design & Analysis of Algorithms' : 'Software Engineering Principles',
            d, sessId, statusStu2]);
      }
    }

    // 15. Lecture Plans
    console.log('[seed] Seeding lecture plans & syllabus progress...');
    const lectureTopics = [
      ['lp_1', 'subj_dbms', 'fac_1', 'sec_btech_cse_5_g4', 1, 'Introduction to Relational Models & Relational Algebra', '2026-11-02', 'completed', '2026-11-02'],
      ['lp_2', 'subj_dbms', 'fac_1', 'sec_btech_cse_5_g4', 1, 'SQL DDL, DML and Integrity Constraints', '2026-11-05', 'completed', '2026-11-05'],
      ['lp_3', 'subj_dbms', 'fac_1', 'sec_btech_cse_5_g4', 2, 'Normalization: 1NF, 2NF, 3NF, BCNF decomposition', '2026-11-09', 'completed', '2026-11-09'],
      ['lp_4', 'subj_dbms', 'fac_1', 'sec_btech_cse_5_g4', 2, 'Transaction Processing: ACID Properties & Serializability', '2026-11-10', 'completed', '2026-11-10'],
      ['lp_5', 'subj_dbms', 'fac_1', 'sec_btech_cse_5_g4', 2, 'Concurrency Control Protocols: 2PL & Timestamp Ordering', '2026-11-12', 'pending', null],
      ['lp_6', 'subj_dbms', 'fac_1', 'sec_btech_cse_5_g4', 3, 'Indexing Architectures: B+ Trees and Hashing', '2026-11-16', 'pending', null],
      ['lp_7', 'subj_os', 'fac_3', 'sec_btech_cse_5_g4', 1, 'Process Management and CPU Scheduling Algorithms', '2026-11-03', 'completed', '2026-11-03'],
      ['lp_8', 'subj_os', 'fac_3', 'sec_btech_cse_5_g4', 2, 'Deadlock Detection, Prevention & Banker Algorithm', '2026-11-10', 'completed', '2026-11-10'],
      ['lp_9', 'subj_os', 'fac_3', 'sec_btech_cse_5_g4', 2, 'Virtual Memory Management & Page Replacement', '2026-11-13', 'pending', null],
    ];

    for (const lp of lectureTopics) {
      await client.query(`
        INSERT INTO lecture_plans (id, subject_id, faculty_id, section_id, week_number, topic_title, planned_date, completion_status, completed_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9::date)
        ON CONFLICT (id) DO NOTHING;
      `, lp);
    }

    // 16. Examinations, Marks & Results
    console.log('[seed] Seeding examination schedules & results...');
    await client.query(`
      INSERT INTO examinations (id, academic_session_id, semester_id, name, exam_type, start_date, end_date, is_published, admit_card_released)
      VALUES 
        ('exam_mid_sem5', 'sess_2026_2027', 'sem_btech_cse_5', 'Mid Term Examinations Oct 2026', 'mid_term', '2026-10-12', '2026-10-17', TRUE, TRUE),
        ('exam_end_sem5', 'sess_2026_2027', 'sem_btech_cse_5', 'End Term Examinations Dec 2026', 'end_term', '2026-12-15', '2026-12-28', FALSE, FALSE)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO exam_schedules (id, examination_id, subject_id, exam_date, start_time, end_time, classroom_id, max_marks)
      VALUES 
        ('es_1', 'exam_end_sem5', 'subj_dbms', '2026-12-15', '10:00:00', '13:00:00', 'cr_301', 100.0),
        ('es_2', 'exam_end_sem5', 'subj_os', '2026-12-18', '10:00:00', '13:00:00', 'cr_301', 100.0),
        ('es_3', 'exam_end_sem5', 'subj_daa', '2026-12-21', '10:00:00', '13:00:00', 'cr_301', 100.0),
        ('es_4', 'exam_end_sem5', 'subj_se', '2026-12-24', '10:00:00', '13:00:00', 'cr_301', 100.0)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO marks (id, examination_id, student_id, subject_id, internal_marks, external_marks, total_marks, max_marks, grade_letter, grade_point, status)
      VALUES 
        ('mrk_1', 'exam_mid_sem5', 'stu_1', 'subj_dbms', 27.5, 0.0, 27.5, 30.0, 'A+', 9.0, 'pass'),
        ('mrk_2', 'exam_mid_sem5', 'stu_1', 'subj_os', 26.0, 0.0, 26.0, 30.0, 'A', 8.5, 'pass'),
        ('mrk_3', 'exam_mid_sem5', 'stu_1', 'subj_daa', 28.0, 0.0, 28.0, 30.0, 'O', 10.0, 'pass')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Prior Semester Result (Semester 4)
    await client.query(`
      INSERT INTO student_results (id, student_id, semester_id, academic_session_id, sgpa, cgpa, total_credits_earned, result_status, backlog_count, published_date)
      VALUES 
        ('res_sem4_stu1', 'stu_1', 'sem_btech_cse_5', 'sess_2026_2027', 8.64, 8.52, 24, 'pass', 0, '2026-07-15')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 17. Fee Structures & Payments
    console.log('[seed] Seeding fees & receipts...');
    await client.query(`
      INSERT INTO fee_structures (id, course_id, semester_id, academic_session_id, tuition_fee, examination_fee, hostel_fee, library_fee, other_charges, total_amount, due_date)
      VALUES 
        ('fee_sem5', 'course_btech_cse', 'sem_btech_cse_5', 'sess_2026_2027', 85000.00, 5000.00, 35000.00, 2500.00, 4500.00, 132000.00, '2026-08-30')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO student_fees (id, student_id, fee_structure_id, total_due, amount_paid, balance_due, status, due_date)
      VALUES 
        ('sf_stu1', 'stu_1', 'fee_sem5', 132000.00, 132000.00, 0.00, 'paid', '2026-08-30')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO payments (id, student_fee_id, student_id, receipt_number, amount, payment_method, transaction_reference, payment_status, payment_date)
      VALUES 
        ('pay_1', 'sf_stu1', 'stu_1', 'GEU-FEE-2026-09812', 132000.00, 'online_gateway', 'TXN_GEU_982138120', 'completed', '2026-08-25 14:32:00')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 18. Circulars & Notifications
    console.log('[seed] Seeding circulars & notifications...');
    await client.query(`
      INSERT INTO circulars (id, title, circular_number, category, target_audience, content, published_by_user_id, is_pinned, published_at)
      VALUES 
        ('circ_1', 'Registration for Odd Semester End-Term Examinations 2026', 'GEU/COE/2026/89', 'examination', 'all', 'All regular students of B.Tech 5th Semester are hereby informed that the portal for exam verification and admit card generation is now open.', 'usr_admin_1', TRUE, NOW()),
        ('circ_2', 'Annual Technical Symposium - TechFest 2026', 'GEU/DSA/2026/102', 'events', 'students', 'Graphic Era University invites innovative project submissions for the Annual Technical Conclave starting December 5, 2026.', 'usr_admin_1', FALSE, NOW() - INTERVAL '3 days'),
        ('circ_3', 'Upcoming Campus Recruitment Drive: Infosys & Microsoft', 'GEU/TPO/2026/45', 'academic', 'students', 'Final & Pre-final year students with minimum 7.5 CGPA and no active backlogs are eligible to register.', 'usr_admin_1', TRUE, NOW() - INTERVAL '1 day')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO notifications (user_id, kind, title, message, type, is_read, action_url)
      VALUES 
        ('usr_stu_1', 'attendance_alert', 'Attendance Shortage Alert', 'Your attendance in TCS-504 is nearing the 75% cutoff. Please attend remaining classes to avoid detention.', 'attendance_alert', FALSE, '/attendance'),
        ('usr_stu_1', 'info', 'Timetable Substitution Update', 'Period 4 DBMS Lab has been substituted with Operating Systems Lab in LAB-2 for Wednesday.', 'info', FALSE, '/timetable'),
        ('usr_stu_1', 'fee_reminder', 'Fee Receipt Generated', 'Receipt for Odd Semester Fee (GEU-FEE-2026-09812) is available for download.', 'fee_reminder', TRUE, '/fees');
    `);

    // 19. Hostels & Placements
    console.log('[seed] Seeding hostel & placements...');
    await client.query(`
      INSERT INTO hostels (id, name, gender, warden_name, warden_phone, total_rooms)
      VALUES 
        ('hostel_b1', 'Subhash Chandra Bose Hostel', 'boys', 'Dr. Ramesh Rawat', '+91 9412001122', 120),
        ('hostel_g1', 'Sarojini Naidu Girls Hostel', 'girls', 'Dr. Kavita Joshi', '+91 9412001133', 150)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO hostel_allocations (id, hostel_id, student_id, room_number, bed_number, status)
      VALUES 
        ('ha_stu1', 'hostel_b1', 'stu_1', 'B-304', 'A', 'active')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO placements (id, company_name, job_title, ctc_lpa, job_location, eligibility_min_cgpa, eligible_courses, drive_date, application_deadline, description)
      VALUES 
        ('plc_1', 'Microsoft India', 'Software Engineer Trainee', 21.50, 'Bengaluru / Hyderabad', 8.00, '["BTECH_CSE"]'::jsonb, '2026-12-05', NOW() + INTERVAL '10 days', 'Core engineering role in Azure Cloud and AI development teams.'),
        ('plc_2', 'Amazon AWS', 'Cloud Support Associate', 16.00, 'Gurugram / Pune', 7.50, '["BTECH_CSE"]'::jsonb, '2026-12-10', NOW() + INTERVAL '14 days', 'Troubleshooting large-scale distributed architectures and cloud infrastructure.')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 20. Grievances Sample
    await client.query(`
      INSERT INTO grievances (id, student_id, category, subject, description, status)
      VALUES 
        ('grv_1', 'stu_1', 'academic', 'Request for Lab Equipment Maintenance', 'Two systems in LAB-4 require RAM upgrade for operating system kernel compiling exercises.', 'under_review')
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  console.log('[seed] ✓ Database seeded successfully with Graphic Era University ERP records.');
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] Seed failed:', err.message);
      process.exit(1);
    });
}

module.exports = { seedDatabase };
