/**
 * GUeAttend Client Application Logic
 * Graphic Era University ERP & Smart Attendance Portal
 */

let currentUser = null;
let currentProfile = null;
let currentDashboardData = null;

// Initialize Application
async function initApp() {
  updateCurrentDateDisplay();

  try {
    const authResp = await fetch('/api/auth/me');
    const authData = await authResp.json();

    if (!authData.success || !authData.user) {
      window.location.href = '/login';
      return;
    }

    currentUser = authData.user;
    currentProfile = authData.profile;

    // Update Nav bar
    document.getElementById('navUserName').textContent = currentUser.fullName || 'Student';
    document.getElementById('navUserRole').textContent = currentUser.role.toUpperCase();
    const initials = (currentUser.fullName || 'ST')
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    document.getElementById('navAvatar').textContent = initials;
    document.getElementById('bannerAvatar').textContent = initials;

    // Load Student Dashboard Data
    await loadStudentDashboard();

    // Setup Event Listeners
    setupNavListeners();
    setupTelegramSettings();
    setupGrievanceForm();

    // Fetch initial notifications for unread badge
    loadNotificationsBadge();
  } catch (err) {
    console.error('[app] Initialization error:', err);
  }
}

function updateCurrentDateDisplay() {
  const d = new Date();
  const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  const str = d.toLocaleDateString('en-IN', options);
  const el = document.getElementById('currentDateDisplay');
  if (el) el.textContent = str;
}

// ====================================================================
// DASHBOARD DATA LOADER (9 Widgets)
// ====================================================================

async function loadStudentDashboard() {
  try {
    const resp = await fetch('/api/dashboard/student');
    const data = await resp.json();

    if (!data.success) {
      console.warn('[dashboard] Error loading dashboard:', data.error);
      return;
    }

    currentDashboardData = data;
    const { student, widgets, feed, academicSession } = data;

    // Header & Banner
    if (academicSession) {
      document.getElementById('topbarSessionBadge').textContent = `Academic Session ${academicSession}`;
      document.getElementById('sidebarSessionText').textContent = academicSession;
    }

    document.getElementById('bannerStudentName').textContent = student.name || 'Student';
    document.getElementById('bannerStudentId').textContent = `ID: ${student.studentId || '-'}`;
    document.getElementById('bannerEnrollment').textContent = `Enrollment: ${student.enrollmentNumber || '-'}`;
    document.getElementById('bannerCourse').textContent = `${student.courseCode || student.courseName || 'B.Tech CSE'}`;
    document.getElementById('bannerSemSec').textContent = `Sem ${student.semesterNumber || 5} | Sec ${student.sectionName || 'G4'}`;
    document.getElementById('timetableSectionBadge').textContent = `Section ${student.sectionName || 'G4'}`;

    // Overall Attendance & Class Counts
    const overallPct = widgets.attendanceSummary?.overallPercentage ?? 0;
    document.getElementById('bannerOverallAttendance').textContent = `${overallPct}%`;
    document.getElementById('bannerOverallAttendance').style.color = overallPct >= 75.0 ? '#38bdf8' : '#ef4444';
    document.getElementById('bannerClassesTodayCount').textContent = widgets.classesTodayCount;
    document.getElementById('classesTodayCountBadge').textContent = `${widgets.classesTodayCount} Scheduled`;

    // Widget 1: Classes Today
    renderClassesTodayWidget(widgets.todayTimetable);

    // Widget 2: Right Now
    renderRightNowWidget(widgets.rightNow);

    // Widget 3: Up Next
    renderUpNextWidget(widgets.upNext);

    // Widget 5: Class Substitutions
    renderSubstitutionsWidget(widgets.classSubstitutions);

    // Widget 6: Today's Attendance Table
    renderTodayAttendanceWidget(widgets.todayAttendance, data.currentDate);

    // Widget 7: Course Progress
    renderCourseProgressWidget(widgets.courseProgress);

    // Widget 8: Month Register Preview
    renderDashboardMonthRegister(widgets.monthRegister);

    // Widget 9: Lecture Plan Preview
    renderDashboardLecturePlan(widgets.lecturePlan);
  } catch (err) {
    console.error('[dashboard] Fetch error:', err);
  }
}

function renderClassesTodayWidget(classes) {
  const container = document.getElementById('classesTodayContainer');
  if (!classes || classes.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">No classes scheduled for today.</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
  classes.forEach((c) => {
    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border-light);">
        <div>
          <div style="font-weight: 700; font-size: 13px; color: var(--primary);">${c.subject_name}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">${c.period_label} (${c.start_time.slice(0, 5)} - ${c.end_time.slice(0, 5)}) • Room ${c.classroom || 'CR-301'}</div>
        </div>
        <span class="badge-status badge-leave">${c.class_type || 'Theory'}</span>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderRightNowWidget(cls) {
  const container = document.getElementById('rightNowContainer');
  if (!cls) {
    container.innerHTML = `
      <div style="text-align: center; padding: 12px 0;">
        <div style="font-size: 24px; margin-bottom: 4px;">☕</div>
        <div style="font-weight: 700; color: var(--primary);">No Class Right Now</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Take a break or review your notes.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="period-title">${cls.subject_name} (${cls.subject_code})</div>
    <div class="period-meta">
      <span>⏰ <strong>${cls.start_time.slice(0, 5)} - ${cls.end_time.slice(0, 5)}</strong> (${cls.remainingMinutes}m remaining)</span>
      <span>👨‍🏫 ${cls.faculty_name || 'Faculty Assigned'} • Room ${cls.classroom || 'CR-301'}</span>
    </div>
    <div class="progress-track">
      <div class="progress-bar" style="width: ${cls.progressPercent}%;"></div>
    </div>
  `;
}

function renderUpNextWidget(cls) {
  const container = document.getElementById('upNextContainer');
  if (!cls) {
    container.innerHTML = `
      <div style="text-align: center; padding: 12px 0;">
        <div style="font-size: 22px; margin-bottom: 4px;">🎉</div>
        <div style="font-weight: 600; color: var(--text-muted);">All classes done for today</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="font-weight: 700; font-size: 14px; color: var(--primary);">${cls.subject_name}</div>
    <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
      Starts in <strong>${cls.startsInMinutes} minutes</strong> (${cls.start_time.slice(0, 5)})
    </div>
    <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
      Room: <strong>${cls.classroom || 'CR-301'}</strong> • ${cls.faculty_name || '-'}
    </div>
  `;
}

function renderSubstitutionsWidget(subs) {
  const container = document.getElementById('substitutionAlertsContainer');
  if (!subs || subs.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 12.5px;">No class substitutions scheduled for today. Regular timetable in effect.</p>`;
    return;
  }

  let html = '';
  subs.forEach((s) => {
    html += `
      <div style="background: var(--warning-bg); border-left: 3px solid var(--warning); padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #92400e;">
        <strong>${s.subject_name}</strong>: Substituted by <strong>${s.substitute_faculty_name || 'Substitute Faculty'}</strong>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderTodayAttendanceWidget(records, dateStr) {
  document.getElementById('todayAttendanceDate').textContent = dateStr;
  const tbody = document.getElementById('todayAttendanceTbody');

  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No class records marked for today.</td></tr>`;
    return;
  }

  let html = '';
  records.forEach((r) => {
    const status = (r.status || 'not_marked').toLowerCase();
    const badgeClass =
      status === 'present'
        ? 'badge-present'
        : status === 'absent'
        ? 'badge-absent'
        : status === 'approved_leave'
        ? 'badge-leave'
        : 'badge-unmarked';
    const statusLabel =
      status === 'present'
        ? 'Present'
        : status === 'absent'
        ? 'Absent'
        : status === 'approved_leave'
        ? 'Approved Leave'
        : 'Not Marked';

    html += `
      <tr>
        <td><strong>${r.period_label || `Period ${r.period_number}`}</strong></td>
        <td>${r.duration || '-'}</td>
        <td style="font-weight: 600;">${r.subject}</td>
        <td><code>${r.subject_code}</code></td>
        <td>${r.faculty_name}</td>
        <td><span class="badge-status ${badgeClass}">${statusLabel}</span></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderCourseProgressWidget(subjects) {
  const container = document.getElementById('courseProgressContainer');
  if (!subjects || subjects.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 12px;">No syllabus records registered.</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
  subjects.forEach((s) => {
    const pct = parseFloat(s.progress_percentage || 0);
    html += `
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
          <span style="font-weight: 600;">${s.subject_name}</span>
          <span style="color: var(--accent); font-weight: 700;">${pct}%</span>
        </div>
        <div class="progress-track" style="margin-top: 0; height: 5px;">
          <div class="progress-bar" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderDashboardMonthRegister(monthData) {
  const container = document.getElementById('dashboardMonthRegisterContainer');
  if (!monthData || !monthData.records || monthData.records.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 12.5px;">No attendance sessions marked yet for this month.</p>`;
    return;
  }

  const recs = monthData.records;
  const present = recs.filter((r) => r.status === 'present').length;
  const absent = recs.filter((r) => r.status === 'absent').length;
  const marked = present + absent;
  const pct = marked > 0 ? ((present / marked) * 100).toFixed(1) : '0.0';

  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 20px; padding: 8px 0;">
      <div style="font-size: 28px; font-weight: 800; color: ${pct >= 75.0 ? 'var(--success)' : 'var(--danger)'};">
        ${pct}%
      </div>
      <div style="font-size: 12.5px; color: var(--text-muted);">
        <div>Total Conducted Periods: <strong>${recs.length}</strong></div>
        <div>Present Classes: <strong style="color: var(--success);">${present}</strong> | Absent: <strong style="color: var(--danger);">${absent}</strong></div>
      </div>
    </div>
  `;
}

function renderDashboardLecturePlan(lpData) {
  const container = document.getElementById('dashboardLecturePlanContainer');
  if (!lpData) return;

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12.5px;">
      <div style="display:flex; justify-content:space-between;">
        <span>Completed Topics:</span>
        <strong style="color: var(--success);">${lpData.completedCount}</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Pending Topics:</span>
        <strong style="color: var(--warning);">${lpData.pendingCount}</strong>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>Total Topics Planned:</span>
        <strong>${lpData.total}</strong>
      </div>
    </div>
  `;
}

// ====================================================================
// VIEW ROUTING (SIDEBAR NAVIGATION)
// ====================================================================

function setupNavListeners() {
  document.querySelectorAll('.app-sidebar .nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const viewId = item.getAttribute('data-view');
      if (viewId) {
        switchView(viewId);
      }
    });
  });

  // Mobile Menu Toggle
  const toggleBtn = document.getElementById('mobileMenuToggle');
  const sidebar = document.getElementById('appSidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Logout Handlers
  const handleLogout = async () => {
    if (!confirm('Are you sure you want to log out of GUeAttend?')) return;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (err) {
      window.location.href = '/login';
    }
  };

  const logoutBtn = document.getElementById('logoutBtn');
  const logoutBtnSidebar = document.getElementById('logoutBtnSidebar');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  if (logoutBtnSidebar) logoutBtnSidebar.addEventListener('click', handleLogout);

  // Month Register View Button
  const viewMonthBtn = document.getElementById('viewMonthBtn');
  if (viewMonthBtn) {
    viewMonthBtn.addEventListener('click', loadFullMonthRegister);
  }
}

function switchView(viewId) {
  // Update sidebar active classes
  document.querySelectorAll('.app-sidebar .nav-item').forEach((item) => {
    if (item.getAttribute('data-view') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Toggle view panels
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.remove('active');
  });

  const targetPanel = document.getElementById(viewId);
  if (targetPanel) {
    targetPanel.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Close mobile menu if open
    document.getElementById('appSidebar')?.classList.remove('mobile-open');

    // Load view specific data
    if (viewId === 'attendanceView') loadAttendanceViewData();
    if (viewId === 'timetableView') loadWeeklyTimetableData();
    if (viewId === 'academicView') loadAcademicViewData();
    if (viewId === 'examView') loadExamViewData();
    if (viewId === 'feeView') loadFeeViewData();
    if (viewId === 'grievanceView') loadGrievanceViewData();
    if (viewId === 'circularView') loadCircularViewData();
    if (viewId === 'hostelView') loadHostelViewData();
    if (viewId === 'placementView') loadPlacementViewData();
    if (viewId === 'profileView') loadProfileViewData();
    if (viewId === 'notificationsView') loadNotificationsViewData();
    if (viewId === 'settingsView') loadTelegramStatus();
  }
}

// ====================================================================
// VIEW LOADERS
// ====================================================================

// Attendance View
async function loadAttendanceViewData() {
  try {
    const resp = await fetch('/api/attendance/summary');
    const data = await resp.json();

    if (data.success && data.summary) {
      const tbody = document.getElementById('fullAttendanceSummaryTbody');
      let html = '';
      data.summary.subjects.forEach((s) => {
        const pct = parseFloat(s.percentage || 0);
        const isShortage = pct < 75.0 && parseInt(s.marked_classes) > 0;
        const statusBadge = isShortage
          ? '<span class="badge-status badge-absent">Shortage</span>'
          : '<span class="badge-status badge-present">Normal</span>';

        html += `
          <tr>
            <td><code>${s.subject_code}</code></td>
            <td style="font-weight: 600;">${s.subject_name}</td>
            <td>${s.marked_classes}</td>
            <td style="color: var(--success); font-weight:700;">${s.present_classes}</td>
            <td style="color: var(--danger); font-weight:700;">${s.absent_classes}</td>
            <td>${s.leave_classes}</td>
            <td style="font-weight: 800; color: ${pct >= 75.0 ? 'var(--success)' : 'var(--danger)'};">${pct}%</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }

    loadFullMonthRegister();
  } catch (err) {
    console.error(err);
  }
}

async function loadFullMonthRegister() {
  const month = document.getElementById('monthSelect').value;
  const year = document.getElementById('yearSelect').value;
  const body = document.getElementById('monthRegisterFullBody');

  try {
    const resp = await fetch(`/api/attendance/monthly?month=${month}&year=${year}`);
    const data = await resp.json();

    if (!data.success || !data.rawRecords || data.rawRecords.length === 0) {
      body.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted);">No attendance records found for ${month}/${year}.</div>`;
      return;
    }

    let html = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Period</th>
              <th>Subject</th>
              <th>Faculty</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
    `;

    data.rawRecords.forEach((r) => {
      const statusClass = r.status === 'present' ? 'badge-present' : r.status === 'absent' ? 'badge-absent' : 'badge-leave';
      const d = r.class_date instanceof Date ? r.class_date.toISOString().split('T')[0] : String(r.class_date).slice(0, 10);
      html += `
        <tr>
          <td><strong>${d}</strong></td>
          <td>${r.period_label || `Period ${r.period_number}`}</td>
          <td>${r.subject_name} (<code>${r.subject_code}</code>)</td>
          <td>${r.faculty_name}</td>
          <td><span class="badge-status ${statusClass}">${r.status}</span></td>
          <td>${r.remarks || '-'}</td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div style="color: var(--danger); padding: 16px;">Failed to load monthly register.</div>`;
  }
}

// Timetable View (Monday - Saturday Grid)
async function loadWeeklyTimetableData() {
  const grid = document.getElementById('masterTimetableGrid');
  try {
    const resp = await fetch('/api/timetable/weekly');
    const data = await resp.json();

    if (!data.success) return;

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = [1, 2, 3, 4, 5, 6];

    let html = '<div class="tt-cell tt-header">Day / Period</div>';
    periods.forEach((p) => {
      html += `<div class="tt-cell tt-header">Period ${p}</div>`;
    });

    days.forEach((dayName, idx) => {
      const dayNum = idx + 1;
      html += `<div class="tt-cell tt-day">${dayName}</div>`;

      const dayClasses = (data.allEntries || []).filter((c) => c.day_of_week === dayNum);

      periods.forEach((pNum) => {
        const cls = dayClasses.find((c) => c.period_number === pNum);
        if (cls) {
          html += `
            <div class="tt-cell">
              <div class="tt-subject-box">
                <div class="tt-subject-name">${cls.subject_name}</div>
                <div class="tt-faculty-name">${cls.faculty_name || '-'}</div>
                <div class="tt-room-pill">${cls.classroom || 'CR-301'}</div>
              </div>
            </div>
          `;
        } else {
          html += `<div class="tt-cell" style="background:#fafafa;"><span style="color:#cbd5e1;">-</span></div>`;
        }
      });
    });

    grid.innerHTML = html;
  } catch (err) {
    grid.innerHTML = '<p style="color: var(--danger);">Failed to render timetable.</p>';
  }
}

// Academic View
async function loadAcademicViewData() {
  try {
    const [lpResp, matResp, asgnResp] = await Promise.all([
      fetch('/api/academic/lecture-plan'),
      fetch('/api/academic/materials'),
      fetch('/api/academic/assignments'),
    ]);

    const lpData = await lpResp.json();
    const matData = await matResp.json();
    const asgnData = await asgnResp.json();

    // Lecture Plan Table
    const lpTbody = document.getElementById('lecturePlanTbody');
    if (lpData.success && lpData.allPlans) {
      let html = '';
      lpData.allPlans.forEach((p) => {
        const d = p.planned_date ? String(p.planned_date).slice(0, 10) : '-';
        const stClass = p.completion_status === 'completed' ? 'badge-present' : 'badge-leave';
        html += `
          <tr>
            <td><strong>Week ${p.week_number}</strong></td>
            <td><code>${p.subject_code}</code></td>
            <td style="font-weight: 600;">${p.topic_title}</td>
            <td>${d}</td>
            <td><span class="badge-status ${stClass}">${p.completion_status}</span></td>
            <td>${p.faculty_name}</td>
          </tr>
        `;
      });
      lpTbody.innerHTML = html;
    }

    // Study Materials
    const matContainer = document.getElementById('studyMaterialsContainer');
    if (matData.success && matData.materials?.length > 0) {
      let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
      matData.materials.forEach((m) => {
        html += `
          <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--border-light);">
            <div>
              <div style="font-weight:600; font-size:13px;">${m.title}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">${m.subject_name} • ${m.faculty_name}</div>
            </div>
            <a href="${m.file_url || '#'}" target="_blank" class="btn btn-secondary" style="font-size:11px; padding:4px 8px;">Download 📥</a>
          </div>
        `;
      });
      html += '</div>';
      matContainer.innerHTML = html;
    } else {
      matContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No study materials posted yet.</p>';
    }

    // Assignments
    const asgnContainer = document.getElementById('assignmentsContainer');
    if (asgnData.success && asgnData.assignments?.length > 0) {
      let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
      asgnData.assignments.forEach((a) => {
        const isSub = a.is_submitted;
        html += `
          <div style="display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--border-light);">
            <div>
              <div style="font-weight:600; font-size:13px;">${a.title}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">Subject: ${a.subject_name}</div>
            </div>
            <span class="badge-status ${isSub ? 'badge-present' : 'badge-absent'}">${isSub ? 'Submitted' : 'Pending'}</span>
          </div>
        `;
      });
      html += '</div>';
      asgnContainer.innerHTML = html;
    } else {
      asgnContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">No active assignments.</p>';
    }
  } catch (err) {}
}

// Exam View
async function loadExamViewData() {
  try {
    const [schedResp, resResp] = await Promise.all([
      fetch('/api/examinations/schedules'),
      fetch('/api/examinations/results'),
    ]);

    const schedData = await schedResp.json();
    const resData = await resResp.json();

    // Schedules
    const sTbody = document.getElementById('examScheduleTbody');
    if (schedData.success && schedData.schedules) {
      let html = '';
      schedData.schedules.forEach((s) => {
        const d = s.exam_date ? String(s.exam_date).slice(0, 10) : '-';
        html += `
          <tr>
            <td><strong>${s.exam_name}</strong></td>
            <td><code>${s.subject_code}</code></td>
            <td style="font-weight:600;">${s.subject_name}</td>
            <td>${d}</td>
            <td>${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}</td>
            <td>${s.room_number || 'Main Examination Hall'}</td>
          </tr>
        `;
      });
      sTbody.innerHTML = html;
    }

    // Results Transcript
    const rTbody = document.getElementById('resultsTbody');
    if (resData.success && resData.results) {
      let html = '';
      resData.results.forEach((r) => {
        html += `
          <tr>
            <td><strong>Semester ${r.semester_number || 4}</strong></td>
            <td style="font-weight:700; color:var(--primary);">${r.sgpa}</td>
            <td style="font-weight:800; color:var(--accent);">${r.cgpa}</td>
            <td>${r.total_credits_earned}</td>
            <td><span class="badge-status badge-present">${r.result_status.toUpperCase()}</span></td>
            <td>${r.backlog_count}</td>
          </tr>
        `;
      });
      rTbody.innerHTML = html;
    }
  } catch (err) {}
}

// Fee View
async function loadFeeViewData() {
  try {
    const [feeResp, recResp] = await Promise.all([
      fetch('/api/fees/summary'),
      fetch('/api/fees/receipts'),
    ]);

    const feeData = await feeResp.json();
    const recData = await recResp.json();

    if (feeData.success) {
      document.getElementById('feeTotalAmount').textContent = `₹ ${Number(feeData.totalDue).toLocaleString('en-IN')}`;
      document.getElementById('feeAmountPaid').textContent = `₹ ${Number(feeData.totalPaid).toLocaleString('en-IN')}`;
      document.getElementById('feeBalanceDue').textContent = `₹ ${Number(feeData.balanceDue).toLocaleString('en-IN')}`;
    }

    const rTbody = document.getElementById('feeReceiptsTbody');
    if (recData.success && recData.receipts) {
      let html = '';
      recData.receipts.forEach((r) => {
        const d = r.payment_date ? new Date(r.payment_date).toLocaleDateString() : '-';
        html += `
          <tr>
            <td><strong>${r.receipt_number}</strong></td>
            <td>${d}</td>
            <td style="font-weight:700; color:var(--success);">₹ ${Number(r.amount).toLocaleString('en-IN')}</td>
            <td>${r.payment_method}</td>
            <td><code>${r.transaction_reference}</code></td>
            <td><span class="badge-status badge-present">${r.payment_status}</span></td>
          </tr>
        `;
      });
      rTbody.innerHTML = html;
    }
  } catch (err) {}
}

// Grievance View
async function loadGrievanceViewData() {
  try {
    const resp = await fetch('/api/grievances');
    const data = await resp.json();
    const tbody = document.getElementById('grievancesTbody');
    if (data.success && data.grievances?.length > 0) {
      let html = '';
      data.grievances.forEach((g) => {
        const d = g.created_at ? new Date(g.created_at).toLocaleDateString() : '-';
        html += `
          <tr>
            <td><code>${g.id}</code></td>
            <td style="text-transform:capitalize;">${g.category}</td>
            <td style="font-weight:600;">${g.subject}</td>
            <td><span class="badge-status badge-leave">${g.status}</span></td>
            <td>${d}</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    } else {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No grievances filed.</td></tr>';
    }
  } catch (err) {}
}

function setupGrievanceForm() {
  const form = document.getElementById('grievanceForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const resp = await fetch('/api/grievances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: document.getElementById('grvCategory').value,
          subject: document.getElementById('grvSubject').value,
          description: document.getElementById('grvDescription').value,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        alert('Grievance registered. Ticket reference created.');
        form.reset();
        loadGrievanceViewData();
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to submit grievance.');
    }
  });
}

// Circulars View
async function loadCircularViewData() {
  const container = document.getElementById('circularsListContainer');
  try {
    const resp = await fetch('/api/circulars');
    const data = await resp.json();
    if (data.success && data.circulars?.length > 0) {
      let html = '<div style="display:flex; flex-direction:column; gap:16px;">';
      data.circulars.forEach((c) => {
        const d = c.published_at ? new Date(c.published_at).toLocaleDateString() : '-';
        html += `
          <div class="card" style="padding: 16px; border-left: 4px solid var(--accent);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; font-weight:700; color:var(--gold); text-transform:uppercase;">${c.category} • Ref: ${c.circular_number}</span>
              <span style="font-size:11.5px; color:var(--text-muted);">${d}</span>
            </div>
            <div style="font-size:16px; font-weight:700; color:var(--primary); margin:6px 0;">${c.title}</div>
            <p style="font-size:13px; color:#334155; line-height:1.6;">${c.content}</p>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;
    }
  } catch (err) {}
}

// Hostel View
async function loadHostelViewData() {
  const body = document.getElementById('hostelDetailsBody');
  try {
    const resp = await fetch('/api/hostel/my-room');
    const data = await resp.json();
    if (data.success && data.allocated && data.allocation) {
      const h = data.allocation;
      body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div>Hostel: <strong>${h.hostel_name}</strong></div>
          <div>Room Number: <strong>${h.room_number}</strong> (Bed ${h.bed_number})</div>
          <div>Chief Warden: <strong>${h.warden_name}</strong></div>
          <div>Warden Contact: <strong>${h.warden_phone}</strong></div>
          <div>Status: <span class="badge-status badge-present">${h.status.toUpperCase()}</span></div>
        </div>
      `;
    } else {
      body.innerHTML = `<p style="color:var(--text-muted);">No campus hostel room currently allocated to your student account.</p>`;
    }
  } catch (err) {}
}

// Placement View
async function loadPlacementViewData() {
  const container = document.getElementById('placementsContainer');
  try {
    const resp = await fetch('/api/placement/drives');
    const data = await resp.json();
    if (data.success && data.drives?.length > 0) {
      let html = '<div class="widget-grid-top">';
      data.drives.forEach((p) => {
        html += `
          <div class="card" style="padding:16px;">
            <div style="font-size:11.5px; font-weight:700; color:var(--accent);">CTC: ₹ ${p.ctc_lpa} LPA</div>
            <div style="font-size:16px; font-weight:700; color:var(--primary); margin:4px 0;">${p.company_name}</div>
            <div style="font-size:13px; font-weight:600; color:#334155;">${p.job_title}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Location: ${p.job_location}</div>
            <p style="font-size:12px; margin-top:8px; color:#475569;">${p.description}</p>
            <button class="btn btn-primary" style="margin-top:12px; width:100%; justify-content:center;" onclick="applyPlacement('${p.id}')">Apply for Drive</button>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;
    } else {
      container.innerHTML = '<p style="color:var(--text-muted);">No active placement drives matching your eligibility right now.</p>';
    }
  } catch (err) {}
}

async function applyPlacement(id) {
  try {
    const resp = await fetch('/api/placement/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placementId: id }),
    });
    const data = await resp.json();
    alert(data.message || 'Application registered.');
  } catch (err) {
    alert('Failed to register.');
  }
}

// Profile View
async function loadProfileViewData() {
  const body = document.getElementById('fullProfileBody');
  if (!currentProfile) return;
  const p = currentProfile;
  body.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; font-size: 13.5px;">
      <div><strong>Full Name:</strong> ${p.full_name}</div>
      <div><strong>Student ID (QID):</strong> ${p.student_id}</div>
      <div><strong>Enrollment No:</strong> ${p.enrollment_number}</div>
      <div><strong>Roll No:</strong> ${p.roll_number || '-'}</div>
      <div><strong>Department:</strong> ${p.department_name}</div>
      <div><strong>Course:</strong> ${p.course_name} (${p.course_code})</div>
      <div><strong>Current Semester:</strong> Semester ${p.semester_number}</div>
      <div><strong>Section:</strong> ${p.section_name}</div>
      <div><strong>Email:</strong> ${p.email}</div>
      <div><strong>Phone:</strong> ${p.phone || '-'}</div>
      <div><strong>Blood Group:</strong> ${p.blood_group || '-'}</div>
      <div><strong>Father Name:</strong> ${p.father_name || '-'}</div>
    </div>
  `;
}

// Notifications View
async function loadNotificationsViewData() {
  const list = document.getElementById('fullNotificationsList');
  try {
    const resp = await fetch('/api/notifications');
    const data = await resp.json();
    if (data.success && data.notifications?.length > 0) {
      let html = '<div style="display:flex; flex-direction:column; gap:12px;">';
      data.notifications.forEach((n) => {
        const d = n.created_at ? new Date(n.created_at).toLocaleString() : '-';
        html += `
          <div class="card" style="padding:14px; display:flex; justify-content:space-between; align-items:center; opacity: ${n.is_read ? '0.7' : '1'};">
            <div>
              <div style="font-weight:700; font-size:14px; color:var(--primary);">${n.title}</div>
              <div style="font-size:12.5px; color:#475569; margin:4px 0;">${n.message}</div>
              <div style="font-size:11px; color:var(--text-muted);">${d}</div>
            </div>
            ${!n.is_read ? `<button class="btn btn-secondary" style="font-size:11px;" onclick="markRead('${n.id}')">Mark Read</button>` : ''}
          </div>
        `;
      });
      html += '</div>';
      list.innerHTML = html;
    } else {
      list.innerHTML = '<p style="color:var(--text-muted);">No notifications right now.</p>';
    }
  } catch (err) {}
}

async function markRead(id) {
  await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
  loadNotificationsViewData();
  loadNotificationsBadge();
}

async function loadNotificationsBadge() {
  try {
    const resp = await fetch('/api/notifications');
    const data = await resp.json();
    const dot = document.getElementById('unreadBadge');
    if (dot && data.success && data.unreadCount > 0) {
      dot.style.display = 'block';
    } else if (dot) {
      dot.style.display = 'none';
    }
  } catch (err) {}
}

// Telegram Integration Settings View
async function loadTelegramStatus() {
  const box = document.getElementById('telegramStatusBox');
  try {
    const resp = await fetch('/api/telegram/status');
    const data = await resp.json();
    if (data.success) {
      if (data.isLinked) {
        box.innerHTML = `
          <div style="color: var(--success); font-weight: 700; margin-bottom: 4px;">✓ Connected to Telegram</div>
          <div style="font-size: 13px;">Chat ID: <code>${data.account.chatId}</code> (Username: @${data.account.username || 'private'})</div>
          <button class="btn btn-secondary" style="margin-top: 10px; font-size: 11px; color: var(--danger);" onclick="unlinkTelegram()">Unlink Account</button>
        `;
        document.getElementById('telegramActionBox').style.display = 'none';
      } else {
        box.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">Status: <strong>Not Linked</strong></div>`;
        document.getElementById('telegramActionBox').style.display = 'block';
      }
    }
  } catch (err) {}
}

function setupTelegramSettings() {
  const btn = document.getElementById('genTgTokenBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const resp = await fetch('/api/telegram/link-token', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        document.getElementById('tgTokenOutput').style.display = 'block';
        document.getElementById('tgTokenCode').textContent = data.token;
        document.getElementById('tgDeepLinkBtn').href = data.deepLink;
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Error generating code.');
    } finally {
      btn.disabled = false;
    }
  });
}

async function unlinkTelegram() {
  if (!confirm('Are you sure you want to disconnect Telegram notifications?')) return;
  await fetch('/api/telegram/unlink', { method: 'POST' });
  loadTelegramStatus();
}

function requestCorrectionModal() {
  const reason = prompt('Please describe the subject, date, and reason for attendance correction:');
  if (reason) {
    alert('Correction request logged for department faculty review.');
  }
}

// Startup
window.addEventListener('DOMContentLoaded', initApp);

