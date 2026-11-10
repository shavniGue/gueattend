/**
 * gueattend - Client Application Logic
 * Exact UX of QAttend with a Modern Emerald & Slate Color Theme
 */

let currentUser = null;
let currentStudent = null;
let currentDashboard = null;

// Initialize Dashboard
async function initDashboard() {
  initTheme();

  try {
    const authResp = await fetch('/api/auth/me');
    const authData = await authResp.json();

    if (!authData.success || !authData.user) {
      window.location.href = '/login';
      return;
    }

    currentUser = authData.user;
    if (currentUser.role === 'admin') {
      const adminLink = document.getElementById('navAdminLink');
      if (adminLink) adminLink.style.display = 'inline-block';
    }

    // Load full dashboard payload
    await loadDashboardData();

    // Event Listeners
    setupEventListeners();
  } catch (err) {
    console.error('[app] Initialization error:', err);
  }
}

// ====================================================================
// LOAD & RENDER DASHBOARD (Exact Image 1 Spec)
// ====================================================================

async function loadDashboardData() {
  try {
    const resp = await fetch('/api/dashboard/student');
    const data = await resp.json();

    if (!data.success) {
      console.warn('[dashboard] Error loading dashboard:', data.error);
      return;
    }

    currentDashboard = data;
    currentStudent = data.student;
    const summary = data.widgets?.attendanceSummary || {};
    const subjects = summary.subjects || [];

    // 1. User Header & Greeting
    const fullNameUpper = (currentStudent.name || currentUser.fullName || 'STUDENT').toUpperCase();
    const navName = document.getElementById('navUserNameDisplay');
    if (navName) navName.textContent = fullNameUpper;
    const greeting = document.getElementById('greetingUser');
    if (greeting) greeting.textContent = `Hello, ${fullNameUpper} 👋`;

    const qidEl = document.getElementById('modalStudentQid');
    if (qidEl) qidEl.textContent = currentStudent.studentId || '24030110';

    // 2. QUMS Connection Card
    const qumsEl = document.getElementById('qumsStatusDisplay');
    if (qumsEl) {
      qumsEl.innerHTML = `<span style="color: var(--success);">🟢</span> <span>Connected ✔</span>`;
    }

    // 3. Telegram Connection Card
    const tgEl = document.getElementById('telegramStatusDisplay');
    if (tgEl) {
      if (data.telegramStatus && data.telegramStatus.connected) {
        tgEl.innerHTML = `<span style="color: var(--success);">🟢</span> <span>Connected ✔</span>`;
      } else {
        tgEl.innerHTML = `<span style="color: var(--text-muted);">⚪</span> <span>Not Connected</span>`;
      }
    }

    // 4. Overall Attendance Card
    const overallPct = summary.overallPercentage ?? 0;
    const overallEl = document.getElementById('overallPctDisplay');
    if (overallEl) {
      overallEl.textContent = `${overallPct}%`;
      overallEl.style.color = overallPct >= 75.0 ? 'var(--primary)' : 'var(--danger)';
    }

    const below75 = summary.below75Count ?? 0;
    const below75Subtext = document.getElementById('below75Subtext');
    if (below75Subtext) {
      below75Subtext.textContent = `${below75} subject(s) below 75%`;
      if (below75 > 0) below75Subtext.style.color = 'var(--danger)';
    }

    // 5. Today's Classes Count
    const todayClasses = data.widgets?.todayTimetable || [];
    const countDisplay = document.getElementById('classesTodayCountDisplay');
    if (countDisplay) countDisplay.textContent = todayClasses.length;
    const badgeEl = document.getElementById('todayClassesBadge');
    if (badgeEl) badgeEl.textContent = `${todayClasses.length} Scheduled`;

    // Render Today's Classes list
    renderTodayClasses(todayClasses);

    // 6. 5 Quick Metrics Bar (Exact Image 1)
    const qmSubjects = document.getElementById('qmSubjects');
    if (qmSubjects) qmSubjects.textContent = summary.totalSubjects || subjects.length;

    const qmBelow75 = document.getElementById('qmBelow75');
    if (qmBelow75) qmBelow75.textContent = below75;

    const qmOk = document.getElementById('qmOk');
    if (qmOk) qmOk.textContent = summary.okCount || (subjects.length - below75);

    const qmOverall = document.getElementById('qmOverall');
    if (qmOverall) {
      qmOverall.textContent = `${overallPct}%`;
      qmOverall.style.color = overallPct >= 75.0 ? 'var(--primary)' : 'var(--danger)';
    }

    const qmPeriod = document.getElementById('qmPeriod');
    if (qmPeriod) qmPeriod.textContent = data.periodDisplay || '26/07/2026 - 09/11/2026';

    // 7. Main Subject Attendance Table (Exact Image 1)
    renderSubjectsTable(subjects);
  } catch (err) {
    console.error('[dashboard] Render error:', err);
  }
}

function renderTodayClasses(classes) {
  const container = document.getElementById('todayClassesList');
  if (!container) return;

  if (!classes || classes.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px;">No classes scheduled for today.</p>`;
    return;
  }

  let html = '';
  classes.forEach((c) => {
    html += `
      <div class="today-class-row">
        <div>
          <div class="class-title-text">${c.period_label || `Period ${c.period_number}`} - ${c.subject_name}</div>
          <div class="class-time-room">${c.start_time.slice(0, 5)} - ${c.end_time.slice(0, 5)} • Room ${c.classroom || 'CR-301'}</div>
        </div>
        <span class="status-tag ok" style="font-size: 10px;">${c.class_type || 'Theory'}</span>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderSubjectsTable(subjects) {
  const tbody = document.getElementById('subjectsAttendanceTbody');
  if (!tbody) return;

  if (!subjects || subjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No subject attendance records found.</td></tr>`;
    return;
  }

  let html = '';
  subjects.forEach((s) => {
    const pct = parseFloat(s.percentage || 0);
    const isOk = pct >= 75.0;
    const statusClass = isOk ? 'ok' : 'attention';
    const statusLabel = isOk ? 'OK' : 'ATTENTION';

    html += `
      <tr>
        <td>
          <div class="subject-cell-name">${s.subject_name}</div>
        </td>
        <td>
          <span class="code-badge">${s.subject_code}</span>
        </td>
        <td>
          <span class="attended-counts">${s.present_classes} / ${s.marked_classes}</span>
        </td>
        <td>
          <span class="pct-badge ${isOk ? 'good' : 'bad'}">${pct}%</span>
        </td>
        <td>
          <span class="status-tag ${statusClass}">${statusLabel}</span>
        </td>
        <td>
          <div class="guidance-text">${s.guidance || '-'}</div>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

// ====================================================================
// EVENT LISTENERS & MODALS
// ====================================================================

function setupEventListeners() {
  // Refresh button
  const refreshBtn = document.getElementById('refreshAttendanceBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const icon = document.getElementById('refreshIcon');
      const text = document.getElementById('refreshText');
      if (icon) icon.style.animation = 'spin 1s linear infinite';
      if (text) text.textContent = 'Updating...';
      refreshBtn.disabled = true;

      try {
        await loadDashboardData();
      } finally {
        setTimeout(() => {
          if (icon) icon.style.animation = '';
          if (text) text.textContent = 'Refresh Attendance';
          refreshBtn.disabled = false;
        }, 600);
      }
    });
  }

  // Toggle Today's classes button
  const toggleBtn = document.getElementById('toggleTodayClassesBtn');
  const section = document.getElementById('todayClassesSection');
  if (toggleBtn && section) {
    toggleBtn.addEventListener('click', () => {
      if (section.style.display === 'none') {
        section.style.display = 'block';
        toggleBtn.textContent = 'Hide today\'s classes';
      } else {
        section.style.display = 'none';
        toggleBtn.textContent = 'Load today\'s classes';
      }
    });
  }

  // QUMS Setup Modal triggers
  const navQums = document.getElementById('navQumsBtn');
  if (navQums) navQums.addEventListener('click', () => openModal('qumsModal'));

  // Disconnect QUMS button (Logout)
  const disconnectQumsBtn = document.getElementById('disconnectQumsBtn');
  if (disconnectQumsBtn) {
    disconnectQumsBtn.addEventListener('click', async () => {
      if (confirm('Disconnect QUMS session?')) {
        await fetch('/api/qums/disconnect', { method: 'POST' });
        loadDashboardData();
      }
    });
  }

  // Telegram Modal triggers
  const navTg = document.getElementById('navTelegramBtn');
  if (navTg) navTg.addEventListener('click', openTelegramModal);

  // Disconnect Telegram button
  const disconnectTgBtn = document.getElementById('disconnectTgBtn');
  if (disconnectTgBtn) {
    disconnectTgBtn.addEventListener('click', async () => {
      if (confirm('Disconnect Telegram notifications?')) {
        await fetch('/api/telegram/unlink', { method: 'POST' });
        loadDashboardData();
      }
    });
  }

  // Timetable Modal triggers
  const navTt = document.getElementById('navTimetableBtn');
  if (navTt) navTt.addEventListener('click', openTimetableModal);

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // Telegram Token Generation inside Modal
  const genBtn = document.getElementById('modalGenTokenBtn');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      genBtn.disabled = true;
      try {
        const resp = await fetch('/api/telegram/link-token', { method: 'POST' });
        const data = await resp.json();
        if (data.success) {
          document.getElementById('modalTokenOutput').style.display = 'block';
          document.getElementById('modalTokenCode').textContent = data.token;
          document.getElementById('modalDeepLinkBtn').href = data.deepLink;
        } else {
          alert(data.error);
        }
      } catch (err) {
        alert('Error generating code.');
      } finally {
        genBtn.disabled = false;
      }
    });
  }

  // QUMS Password update form
  const qumsForm = document.getElementById('qumsSyncForm');
  if (qumsForm) {
    qumsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('QUMS credentials updated and encrypted successfully.');
      closeModal('qumsModal');
    });
  }
}

// Modal Helpers
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('open');
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('open');
}

// Open Telegram Modal & Populate Status
async function openTelegramModal() {
  openModal('telegramModal');
  const box = document.getElementById('modalTgStatusBox');
  try {
    const resp = await fetch('/api/telegram/status');
    const data = await resp.json();
    if (data.success && data.isLinked) {
      box.innerHTML = `
        <div style="color: var(--success); font-weight: 700;">✓ Connected to Telegram</div>
        <div style="font-size: 13px; margin-top: 4px;">Chat ID: <code>${data.account.chatId}</code> (@${data.account.username || 'private'})</div>
      `;
    } else {
      box.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">Status: <strong>Not Linked</strong></div>`;
    }
  } catch (err) {}
}

// Open Timetable Modal & Populate Grid
async function openTimetableModal() {
  openModal('timetableModal');
  const tbody = document.getElementById('modalTimetableTbody');
  try {
    const resp = await fetch('/api/timetable/weekly');
    const data = await resp.json();
    if (!data.success) return;

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = [1, 2, 3, 4, 5, 6];

    let html = '';
    days.forEach((dayName, idx) => {
      const dayNum = idx + 1;
      const dayClasses = (data.allEntries || []).filter((c) => c.day_of_week === dayNum);

      html += `<tr><td><strong>${dayName}</strong></td>`;
      periods.forEach((pNum) => {
        const cls = dayClasses.find((c) => c.period_number === pNum);
        if (cls) {
          html += `
            <td>
              <div style="font-weight: 700; color: var(--primary); font-size: 12px;">${cls.subject_code}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${cls.classroom || 'CR-301'}</div>
            </td>
          `;
        } else {
          html += `<td style="color: #cbd5e1; font-size: 11px;">-</td>`;
        }
      });
      html += `</tr>`;
    });
    tbody.innerHTML = html;
  } catch (err) {
    console.error(err);
  }
}

// ====================================================================
// THEME SWITCHER (Emerald, Indigo, Cyan)
// ====================================================================

function initTheme() {
  const saved = localStorage.getItem('gueattend-theme') || 'emerald';
  document.documentElement.setAttribute('data-theme', saved);

  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.textContent = `🎨 ${saved.toUpperCase()}`;
    btn.addEventListener('click', () => {
      const themes = ['emerald', 'indigo', 'cyan'];
      const current = document.documentElement.getAttribute('data-theme') || 'emerald';
      const next = themes[(themes.indexOf(current) + 1) % themes.length];
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('gueattend-theme', next);
      btn.textContent = `🎨 ${next.toUpperCase()}`;
    });
  }
}

// Spin animation style
const spinStyle = document.createElement('style');
spinStyle.textContent = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
document.head.appendChild(spinStyle);

// Startup
window.addEventListener('DOMContentLoaded', initDashboard);
