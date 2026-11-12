/**
 * Batch seed script to align database with Screenshot 1
 */
require('dotenv').config();
const db = require('../src/database/db');

async function seedExactQAttendData() {
  console.log('[seed] Seeding exact QAttend dataset from Screenshot 1...');

  await db.withTransaction(async (client) => {
    // 1. Move old demo subjects to sem_btech_cse_6
    await client.query(`
      UPDATE subjects 
      SET semester_id = 'sem_btech_cse_6' 
      WHERE id IN ('subj_dbms', 'subj_os', 'subj_daa', 'subj_se', 'subj_dbms_lab', 'subj_os_lab')
    `);

    // 2. Classrooms
    await client.query(`
      INSERT INTO classrooms (id, room_number, building)
      VALUES 
        ('cr_a004', 'A-004', 'Block A'),
        ('cr_a112', 'A-112', 'Block A'),
        ('cr_a213', 'A-213', 'Block A'),
        ('cr_e203', 'E-203', 'Block E')
      ON CONFLICT (room_number) DO NOTHING
    `);

    // 3. Timetable Periods
    await client.query(`
      INSERT INTO timetable_periods (period_number, label, start_time, end_time, is_break)
      VALUES 
        (1, 'Period 1', '09:00:00', '09:55:00', FALSE),
        (2, 'Period 2', '09:55:00', '10:50:00', FALSE),
        (3, 'Period 3', '11:05:00', '12:00:00', FALSE),
        (4, 'Period 4', '12:00:00', '12:55:00', FALSE),
        (5, 'Period 5', '13:30:00', '14:25:00', FALSE),
        (6, 'Period 6', '14:35:00', '15:30:00', FALSE),
        (7, 'Period 7', '14:35:00', '15:30:00', FALSE),
        (8, 'Period 8', '15:30:00', '16:25:00', FALSE)
      ON CONFLICT (period_number) DO UPDATE SET 
        label = EXCLUDED.label,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time
    `);

    // 4. Clean out old attendance sessions & records for stu_1
    await client.query(`DELETE FROM attendance_records WHERE student_id = 'stu_1'`);
    await client.query(`DELETE FROM attendance_sessions WHERE section_id = 'sec_btech_cse_5_g4'`);

    // 5. The 10 Screenshot Subjects
    const subjects = [
      { id: 'subj_aml', code: 'CS535364', name: 'Advance Machine Learning Practical with Python, Scikit-learn, TensorFlow', type: 'practical', present: 31, total: 35 },
      { id: 'subj_cc', code: 'AE525262', name: 'Corporate Communication', type: 'theory', present: 12, total: 12 },
      { id: 'subj_daa_real', code: 'CS535303', name: 'Design and Analysis of Algorithm', type: 'theory', present: 35, total: 38 },
      { id: 'subj_daa_lab', code: 'CS535363', name: 'Design and Analysis of Algorithm Lab', type: 'practical', present: 24, total: 24 },
      { id: 'subj_cloud', code: 'CS25204', name: 'Foundation of Cloud Computing', type: 'theory', present: 25, total: 27 },
      { id: 'subj_mini_proj', code: 'CS535178', name: 'Mini Project - II', type: 'practical', present: 12, total: 12 },
      { id: 'subj_robotics', code: 'MT3015', name: 'Robotic Industry 4.0', type: 'theory', present: 21, total: 24 },
      { id: 'subj_scala', code: 'CS535305', name: 'Scala for Data Science - Tools and Techniques', type: 'theory', present: 35, total: 37 },
      { id: 'subj_internship', code: 'SI53515', name: 'Summer Internship II', type: 'practical', present: 11, total: 11 },
      { id: 'subj_tech_skills', code: 'SE535369', name: 'Technical Skills Development-IV', type: 'practical', present: 55, total: 59 },
    ];

    for (const s of subjects) {
      await client.query(`
        INSERT INTO subjects (id, course_id, semester_id, code, name, credits, subject_type)
        VALUES ($1, 'course_btech_cse', 'sem_btech_cse_5', $2, $3, 4, $4)
        ON CONFLICT (code) DO UPDATE SET 
          semester_id = 'sem_btech_cse_5',
          name = EXCLUDED.name, 
          subject_type = EXCLUDED.subject_type
      `, [s.id, s.code, s.name, s.type]);

      await client.query(`
        INSERT INTO faculty_subjects (id, faculty_id, subject_id, section_id, academic_session_id)
        VALUES ($1, 'fac_1', $2, 'sec_btech_cse_5_g4', 'sess_2026_2027')
        ON CONFLICT (faculty_id, subject_id, section_id, academic_session_id) DO NOTHING
      `, [`fs_${s.id}`, s.id]);
    }

    // 6. Generate Batch Records in Memory and Insert
    const sessionValues = [];
    const recordValues = [];

    // Distribute sessions across dates
    // 2026-07-26 to 2026-11-09 is 106 days
    let sessionCount = 0;
    for (let sIdx = 0; sIdx < subjects.length; sIdx++) {
      const s = subjects[sIdx];
      const pCount = s.present;
      const tCount = s.total;

      for (let c = 0; c < tCount; c++) {
        sessionCount++;
        const isPresent = c < pCount;
        const sessId = `sess_${s.code}_${c + 1}`;
        // Calculate date offset
        const dayOffset = Math.floor((c / tCount) * 100);
        const baseDate = new Date('2026-07-27');
        baseDate.setDate(baseDate.getDate() + dayOffset);
        const classDate = baseDate.toISOString().split('T')[0];
        const periodNum = ((sIdx + c) % 8) + 1;

        sessionValues.push([
          sessId,
          'sess_2026_2027',
          'sec_btech_cse_5_g4',
          s.id,
          'fac_1',
          classDate,
          periodNum,
          55,
        ]);

        recordValues.push([
          'usr_stu_1',
          '24030110',
          s.code,
          s.name,
          classDate,
          sessId,
          'stu_1',
          isPresent ? 'present' : 'absent',
          'Regular Lecture',
        ]);
      }
    }

    console.log(`[seed] Inserting ${sessionValues.length} sessions...`);
    // Insert sessions
    for (const sv of sessionValues) {
      await client.query(`
        INSERT INTO attendance_sessions (id, academic_session_id, section_id, subject_id, faculty_id, class_date, period_number, duration_minutes)
        VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8)
        ON CONFLICT (academic_session_id, section_id, class_date, period_number) DO UPDATE SET subject_id = EXCLUDED.subject_id
      `, sv);
    }

    console.log(`[seed] Inserting ${recordValues.length} records...`);
    // Insert records
    for (const rv of recordValues) {
      await client.query(`
        INSERT INTO attendance_records (user_id, qid, subject_code, subject_name, class_date, session_id, student_id, status, remarks)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, rv);
    }

    // 7. Seed timetable for all days of week matching today's schedule
    await client.query(`DELETE FROM timetable WHERE section_id = 'sec_btech_cse_5_g4'`);
    const dayClasses = [
      { period: 1, subject: 'subj_daa_real', room: 'cr_a004' },
      { period: 2, subject: 'subj_scala', room: 'cr_a112' },
      { period: 5, subject: 'subj_cc', room: 'cr_a213' },
      { period: 7, subject: 'subj_tech_skills', room: 'cr_e203' },
      { period: 8, subject: 'subj_tech_skills', room: 'cr_e203' },
    ];

    for (let day = 1; day <= 6; day++) {
      for (const item of dayClasses) {
        await client.query(`
          INSERT INTO timetable (id, academic_session_id, section_id, subject_id, faculty_id, classroom_id, day_of_week, period_number, class_type)
          VALUES ($1, 'sess_2026_2027', 'sec_btech_cse_5_g4', $2, 'fac_1', $3, $4, $5, 'theory')
          ON CONFLICT (academic_session_id, section_id, day_of_week, period_number) DO UPDATE
          SET subject_id = EXCLUDED.subject_id, classroom_id = EXCLUDED.classroom_id
        `, [`tt_d${day}_p${item.period}`, item.subject, item.room, day, item.period]);
      }
    }

    await client.query(`UPDATE users SET qums_session_status = 'connected' WHERE id = 'usr_stu_1'`);
  });

  console.log('[seed] Seeding complete! stu_1 has exact Screenshot 1 records.');
}

seedExactQAttendData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  });

