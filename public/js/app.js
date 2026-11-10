/**
 * gueattend - Client Application Logic
 * Graphic Era University • Smart Attendance & Timetable
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
    document.getElementById('navUserRole').textContent = (currentUser.role || 'student').toUpperCase();
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
    loadNotificationsBadge();

    // Setup Month Register filter listener
    const viewMonthBtn = document.getElementById('viewMonthBtn');
    if (viewMonthBtn) {
      viewMonthBtn.addEventListener('click', loadFullMonthRegister);
    }

    // Setup Logout buttons
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    const logoutBtnSidebar = document.getElementById('logoutBtnSidebar');
    if (logoutBtnSidebar) logoutBtnSidebar.addEventListener('click', handleLogout);

    // Setup Mobile Menu Toggle
    const mobileToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('appSidebar');
    if (mobileToggle && sidebar) {
      mobileToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }

    // Topbar notification bell shortcut
    const notifBellBtn = document.getElementById('notifBellBtn');
    if (notifBellBtn) {
      notifBellBtn.addEventListener('click', () => switchView('notificationsView'));
    }

    // User profile chip shortcut
    const userProfileChip = document.getElementById('userProfileChip');
    if (userProfileChip) {
      userProfileChip.addEventListener('click', () => switchView('profileView'));
    }
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

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login';
  }
}

// ====================================================================
// NAVIGATION & VIEW SWITCHER
// ====================================================================

function setupNavListeners() {
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.getAttribute('data-view');
      if (targetView) {
        switchView(targetView);
      }
    });
  });
}

function switchView(viewId) {
  // Update sidebar active class
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach((item) => {
    if (item.getAttribute('data-view') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Switch visible panel
  const panels = document.querySelectorAll('.app-content .view-panel');
  panels.forEach((panel) => {
    if (panel.id === viewId) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  // Auto-close sidebar on mobile
  const sidebar = document.getElementById('appSidebar');
  if (sidebar) sidebar.classList.remove('open');

  // Load view-specific dynamic data
  if (viewId === 'attendanceView') loadAttendanceViewData();
  if (viewId === 'timetableView') loadWeeklyTimetableData();
  if (viewId === 'profileView') loadProfileViewData();
  if (viewId === 'notificationsView') loadNotificationsViewData();
  if (viewId === 'settingsView') loadTelegramStatus();
}

// ====================================================================
// DASHBOARD DATA LOADER (Pure QAttend Widgets)
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
    const { student, widgets, academicSession } = data;

    // Header & Banner
    if (academicSession) {
      const topBadge = document.getElementById('topbarSessionBadge');
      if (topBadge) topBadge.textContent = `Academic Session ${academicSession}`;
      const sideText = document.getElementById('sidebarSessionText');
      if (sideText) sideText.textContent = academicSession;
    }

    document.getElementById('bannerStudentName').textContent = student.name || 'Student';
    document.getElementById('bannerStudentId').textContent = `ID: ${student.studentId || '-'}`;
    document.getElementById('bannerEnrollment').textContent = `Enrollment: ${student.enrollmentNumber || '-'}`;
    document.getElementById('bannerCourse').textContent = `${student.courseCode || student.courseName || 'B.Tech CSE'}`;
    document.getElementById('bannerSemSec').textContent = `Sem ${student.semesterNumber || 5} | Sec ${student.sectionName || 'G4'}`;
    document.getElementById('timetableSectionBadge').textContent = `Section ${student.sectionName || 'G4'}`;

    // Overall Attendance & 75% Bunk Margin
    const summary = widgets.attendanceSummary || {};
    const overallPct = summary.overallPercentage ?? 0;
    const overallEl = document.getElementById('bannerOverallAttendance');
    overallEl.textContent = `${overallPct}%`;
    overallEl.style.color = overallPct >= 75.0 ? '#38bdf8' : '#ef4444';

    const bunkStatusEl = document.getElementById('bannerBunkStatus');
    if (summary.bunkMargin) {
      bunkStatusEl.textContent = summary.bunkMargin.message;
      bunkStatusEl.style.color = summary.bunkMargin.isShortage ? '#ef4444' : '#22c55e';
    }

    document.getElementById('bannerClassesTodayCount').textContent = widgets.classesTodayCount || 0;
    document.getElementById('classesTodayCountBadge').textContent = `${widgets.classesTodayCount || 0} Scheduled`;

    // Widget 1: Classes Today
    renderClassesTodayWidget(widgets.todayTimetable);

    // Widget 2: Right Now
    renderRightNowWidget(widgets.rightNow);

    // Widget 3: Up Next
    renderUpNextWidget(widgets.upNext);

    // Widget 4: Today's Attendance Table
    renderTodayAttendanceWidget(widgets.todayAttendance, data.currentDate);

    // Widget 5: Subject-wise Attendance & 75% Bunk Tracker
    renderDashboardSubjectsAttendance(summary.subjects || []);

    // Widget 6: Month Register Preview
    renderDashboardMonthRegister(widgets.monthRegister);
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
        <div style="font-weight: 600; color: var(--text-muted);">All classes completed for today</div>
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

function renderTodayAttendanceWidget(records, dateStr) {
  const dateEl = document.getElementById('todayAttendanceDate');
  if (dateEl) dateEl.textContent = dateStr;
  const tbody = document.getElementById('todayAttendanceTbody');

  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No class attendance records marked for today.</td></tr>`;
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

function renderDashboardSubjectsAttendance(subjects) {
  const tbody = document.getElementById('dashboardSubjectsAttendanceTbody');
  if (!tbody) return;

  if (!subjects || subjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No subject attendance records found.</td></tr>`;
    return;
  }

  let html = '';
  subjects.forEach((s) => {
    const pct = parseFloat(s.percentage || 0);
    const isShortage = pct < 75.0 && parseInt(s.marked_classes) > 0;
    const statusBadge = isShortage
      ? '<span class="badge-status badge-absent">Shortage</span>'
      : '<span class="badge-status badge-present">Safe</span>';

    const bunkMsg = s.bunkMargin ? s.bunkMargin.message : '-';
    const bunkColor = s.bunkMargin && s.bunkMargin.isShortage ? 'var(--danger)' : 'var(--success)';

    html += `
      <tr>
        <td><code>${s.subject_code}</code></td>
        <td style="font-weight: 600;">${s.subject_name}</td>
        <td>${s.marked_classes}</td>
        <td style="color: var(--success); font-weight: 700;">${s.present_classes}</td>
        <td style="color: var(--danger); font-weight: 700;">${s.absent_classes}</td>
        <td style="font-weight: 800; color: ${pct >= 75.0 ? 'var(--success)' : 'var(--danger)'};">${pct}%</td>
        <td style="font-weight: 600; color: ${bunkColor};">${bunkMsg}</td>
        <td>${statusBadge}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderDashboardMonthRegister(monthData) {
  const container = document.getElementById('dashboardMonthRegisterContainer');
  if (!container) return;

  if (!monthData || !monthData.records || monthData.records.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">No attendance register entries for current month.</p>`;
    return;
  }

  const byDate = new Map();
  monthData.records.forEach((r) => {
    const d = r.class_date instanceof Date ? r.class_date.toISOString().split('T')[0] : String(r.class_date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  });

  let html = '<div class="calendar-grid">';
  for (const [dateStr, list] of byDate.entries()) {
    const presentInDay = list.filter((x) => x.status === 'present').length;
    const absentInDay = list.filter((x) => x.status === 'absent').length;
    const dayNum = parseInt(dateStr.split('-')[2], 10);

    let cellClass = 'present';
    if (absentInDay > 0 && presentInDay === 0) cellClass = 'absent';
    else if (absentInDay > 0) cellClass = 'mixed';

    html += `
      <div class="calendar-day ${cellClass}" title="${dateStr}: ${presentInDay} present, ${absentInDay} absent">
        <span class="day-num">${dayNum}</span>
        <span class="status-indicator">${presentInDay}P / ${list.length}</span>
      </div>
    `;
  }
  html += '</div>';
  container.innerHTML = html;
}

// ====================================================================
// VIEW 2: FULL ATTENDANCE & 75% BUNK CALCULATOR
// ====================================================================

async function loadAttendanceViewData() {
  try {
    const resp = await fetch('/api/attendance/summary');
    const data = await resp.json();

    if (data.success && data.summary) {
      const summary = data.summary;
      const tbody = document.getElementById('fullAttendanceSummaryTbody');

      // Update 75% Header Card
      const fullPct = document.getElementById('fullOverallPctDisplay');
      if (fullPct) fullPct.textContent = `${summary.overallPercentage}%`;
      const fullCounts = document.getElementById('fullOverallCountsDisplay');
      if (fullCounts) fullCounts.textContent = `${summary.totalPresent} present / ${summary.totalMarked} marked classes`;
      const fullMsg = document.getElementById('fullBunkStatusMessage');
      if (fullMsg && summary.bunkMargin) {
        fullMsg.textContent = summary.bunkMargin.message;
        fullMsg.style.color = summary.bunkMargin.isShortage ? 'var(--danger)' : 'var(--success)';
      }

      let html = '';
      (summary.subjects || []).forEach((s) => {
        const pct = parseFloat(s.percentage || 0);
        const isShortage = pct < 75.0 && parseInt(s.marked_classes) > 0;
        const statusBadge = isShortage
          ? '<span class="badge-status badge-absent">Shortage</span>'
          : '<span class="badge-status badge-present">Safe</span>';

        const bunkMsg = s.bunkMargin ? s.bunkMargin.message : '-';
        const bunkColor = s.bunkMargin && s.bunkMargin.isShortage ? 'var(--danger)' : 'var(--success)';

        html += `
          <tr>
            <td><code>${s.subject_code}</code></td>
            <td style="font-weight: 600;">${s.subject_name}</td>
            <td>${s.marked_classes}</td>
            <td style="color: var(--success); font-weight: 700;">${s.present_classes}</td>
            <td style="color: var(--danger); font-weight: 700;">${s.absent_classes}</td>
            <td>${s.leave_classes}</td>
            <td style="font-weight: 800; color: ${pct >= 75.0 ? 'var(--success)' : 'var(--danger)'};">${pct}%</td>
            <td style="font-weight: 600; color: ${bunkColor};">${bunkMsg}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }

    loadFullMonthRegister();
  } catch (err) {
    console.error('[attendanceView] Error:', err);
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

// ====================================================================
// VIEW 3: MASTER WEEKLY TIMETABLE (Mon - Sat)
// ====================================================================

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
    console.error('[timetable] Error:', err);
  }
}

// ====================================================================
// VIEW 4: STUDENT PROFILE
// ====================================================================

async function loadProfileViewData() {
  const body = document.getElementById('fullProfileBody');
  if (!currentProfile) return;
  const p = currentProfile;
  body.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; font-size: 13.5px;">
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Full Name:</strong> ${p.full_name}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Student ID (QID):</strong> ${p.student_id}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Enrollment No:</strong> ${p.enrollment_number}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Roll No:</strong> ${p.roll_number || '-'}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Department:</strong> ${p.department_name}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Course:</strong> ${p.course_name} (${p.course_code})</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Semester:</strong> Semester ${p.semester_number}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Section:</strong> ${p.section_name}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Email:</strong> ${p.email}</div>
      <div style="padding: 12px; background: var(--surface-alt); border-radius: 6px;"><strong>Phone:</strong> ${p.phone || '-'}</div>
    </div>
  `;
}

// ====================================================================
// VIEW 5: NOTIFICATIONS
// ====================================================================

async function loadNotificationsViewData() {
  const list = document.getElementById('fullNotificationsList');
  try {
    const resp = await fetch('/api/notifications');
    const data = await resp.json();
    if (data.success && data.notifications?.length > 0) {
      let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';
      data.notifications.forEach((n) => {
        const d = n.created_at ? new Date(n.created_at).toLocaleString() : '-';
        html += `
          <div class="card" style="padding: 14px; display: flex; justify-content: space-between; align-items: center; opacity: ${n.is_read ? '0.7' : '1'};">
            <div>
              <div style="font-weight: 700; font-size: 14px; color: var(--primary);">${n.title}</div>
              <div style="font-size: 12.5px; color: #475569; margin: 4px 0;">${n.message}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${d}</div>
            </div>
            ${!n.is_read ? `<button class="btn btn-secondary" style="font-size: 11px;" onclick="markRead('${n.id}')">Mark Read</button>` : ''}
          </div>
        `;
      });
      html += '</div>';
      list.innerHTML = html;
    } else {
      list.innerHTML = '<p style="color: var(--text-muted); padding: 16px;">No notifications right now.</p>';
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

// ====================================================================
// VIEW 6: TELEGRAM BOT INTEGRATION
// ====================================================================

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

// Startup
window.addEventListener('DOMContentLoaded', initApp);
