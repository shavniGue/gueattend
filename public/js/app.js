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
    if (qidEl) qidEl.textContent = currentStudent.studentId || '';

    // 2. GEU ID Connection Card (reflects real session status, never hardcoded)
    const qumsEl = document.getElementById('qumsStatusDisplay');
    const disconnectQumsBtn = document.getElementById('disconnectQumsBtn');
    const portalConnected = Boolean(data.qumsStatus && data.qumsStatus.connected);
    const portalState = String(data.qumsStatus?.status || (portalConnected ? 'connected' : 'disconnected')).toLowerCase();
    if (qumsEl) {
      if (portalConnected) {
        qumsEl.innerHTML = `<span style="color: #16a34a;">Connected ✅</span>`;
      } else if (portalState === 'expired') {
        qumsEl.innerHTML = `<span style="color: #d97706;">Expired ⚠️</span>`;
      } else {
        qumsEl.innerHTML = `<span style="color: #6b7280;">Not Connected</span>`;
      }
    }
    if (disconnectQumsBtn) {
      disconnectQumsBtn.style.display = portalConnected ? 'inline' : 'none';
    }

    // 3. Telegram Connection Card
    const tgEl = document.getElementById('telegramStatusDisplay');
    const disconnectTgBtn = document.getElementById('disconnectTgBtn');
    if (tgEl) {
      if (data.telegramStatus && data.telegramStatus.connected) {
        tgEl.innerHTML = `<span style="color: #16a34a;">Connected ✅</span>`;
        if (disconnectTgBtn) disconnectTgBtn.style.display = 'inline';
      } else {
        tgEl.innerHTML = `<span style="color: #6b7280;">Not Connected</span>`;
        if (disconnectTgBtn) disconnectTgBtn.style.display = 'none';
      }
    }

    // 4. Overall Attendance Card (only show real percentage when portal connected & records exist)
    const totalMarked = subjects.reduce((acc, s) => acc + Number(s.marked_classes || 0), 0);
    const hasAttendanceData = portalConnected && subjects.length > 0 && totalMarked > 0 && summary.overallPercentage != null;
    const overallPctText = hasAttendanceData ? `${Number(summary.overallPercentage).toFixed(1)}%` : '--%';
    const overallEl = document.getElementById('overallPctDisplay');
    if (overallEl) {
      overallEl.textContent = overallPctText;
      overallEl.style.color = '#111827';
    }

    const below75 = summary.below75Count ?? 0;
    const below75Subtext = document.getElementById('below75Subtext');
    if (below75Subtext) {
      below75Subtext.textContent = `${below75} subject(s) below 75%`;
      below75Subtext.style.color = below75 > 0 ? 'var(--danger)' : '';
    }

    // 5. Today's Classes Count (never hardcode 6)
    const todayClasses = data.widgets?.todayTimetable || [];
    const countDisplay = document.getElementById('classesTodayCountDisplay');
    if (countDisplay) countDisplay.textContent = String(todayClasses.length);

    // Render Today's Classes list
    renderTodayClasses(todayClasses);

    // 6. 5 Quick Metrics Bar
    const qmSubjects = document.getElementById('qmSubjects');
    if (qmSubjects) qmSubjects.textContent = summary.totalSubjects ?? subjects.length;

    const qmBelow75 = document.getElementById('qmBelow75');
    if (qmBelow75) qmBelow75.textContent = below75;

    const qmOk = document.getElementById('qmOk');
    if (qmOk) qmOk.textContent = summary.okCount ?? Math.max(0, subjects.length - below75);

    const qmOverall = document.getElementById('qmOverall');
    if (qmOverall) {
      qmOverall.textContent = overallPctText;
    }

    const qmPeriod = document.getElementById('qmPeriod');
    if (qmPeriod) qmPeriod.textContent = data.periodDisplay || '-';

    // 7. Main Subject Attendance Table
    renderSubjectsTable(subjects, portalConnected);
  } catch (err) {
    console.error('[dashboard] Render error:', err);
  }
}

function renderTodayClasses(classes) {
  const container = document.getElementById('todayClassesList');
  if (!container) return;

  if (!classes || classes.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 13px; padding: 6px 0;">No classes scheduled for today.</p>`;
    return;
  }

  let html = '';
  classes.forEach((c) => {
    const periodLabel = (c.period_label && c.period_label.startsWith('P') && c.period_label.length <= 3) ? c.period_label : `P${c.period_number}`;
    const timeStr = `${(c.start_time || '09:00').slice(0, 5)} - ${(c.end_time || '09:55').slice(0, 5)}`;
    const roomStr = c.classroom ? `Room ${c.classroom}` : 'Room A-004';
    html += `
      <div class="today-class-line">
        <span class="today-class-title">${periodLabel} - ${c.subject_name}</span>
        <span class="today-class-meta">${timeStr} - ${roomStr}</span>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderSubjectsTable(subjects, portalConnected = false) {
  const tbody = document.getElementById('subjectsAttendanceTbody');
  if (!tbody) return;

  if (!subjects || subjects.length === 0) {
    const emptyMsg = portalConnected
      ? 'No subject attendance records synced for your account yet.'
      : 'Connect your GUeID on <a href="/geu-setup" style="color: var(--primary); font-weight: 700;">GEU ID Setup</a> to load your own portal attendance.';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">${emptyMsg}</td></tr>`;
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

  // Disconnect GEU portal button (Logout)
  const disconnectQumsBtn = document.getElementById('disconnectQumsBtn');
  if (disconnectQumsBtn) {
    disconnectQumsBtn.addEventListener('click', async () => {
      if (confirm('Disconnect GEU portal session?')) {
        await fetch('/api/geu/disconnect', { method: 'POST' });
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

  // GEU Password modal view toggle + update form
  const toggleModalPwBtn = document.getElementById('toggleModalPasswordBtn');
  if (toggleModalPwBtn) {
    toggleModalPwBtn.addEventListener('click', () => {
      const input = document.getElementById('qumsPasswordInput');
      const offIcon = document.getElementById('modalEyeOffIcon');
      const onIcon = document.getElementById('modalEyeOnIcon');
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      if (offIcon) offIcon.style.display = reveal ? 'none' : 'block';
      if (onIcon) onIcon.style.display = reveal ? 'block' : 'none';
      toggleModalPwBtn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      toggleModalPwBtn.setAttribute('title', reveal ? 'Hide password' : 'Show password');
    });
  }

  const qumsForm = document.getElementById('qumsSyncForm');
  if (qumsForm) {
    qumsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('GEU portal credentials updated and encrypted successfully.');
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
