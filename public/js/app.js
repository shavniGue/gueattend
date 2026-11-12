/**
 * gueattend - Client Application Logic
 * XSS-hardened, non-fabricated, full Phase 1 ERP dashboard modules.
 */

let currentUser = null;
let currentStudent = null;
let currentDashboard = null;
const loadedTabs = new Set(['overviewTab']);

const esc = (v) => (window.GueSecurity ? window.GueSecurity.escapeHtml(v) : String(v || ''));
const cleanUrl = (u) => (window.GueSecurity ? window.GueSecurity.safeUrl(u) : '#');

async function initDashboard() {
  initTheme();
  initCalendarDefaults();

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
    if (currentUser.role === 'faculty' || currentUser.role === 'admin') {
      const facLink = document.getElementById('navFacultyLink');
      if (facLink) facLink.style.display = 'inline-block';
    }

    await loadDashboardData();
    setupEventListeners();
  } catch (err) {
    console.error('[app] Initialization error:', err);
  }
}

function initCalendarDefaults() {
  const now = new Date();
  const monthSel = document.getElementById('calMonthSelect');
  const yearInp = document.getElementById('calYearInput');
  if (monthSel && monthSel.options.length === 0) {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    names.forEach((n, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx + 1);
      opt.textContent = n;
      if (idx === now.getMonth()) opt.selected = true;
      monthSel.appendChild(opt);
    });
  }
  if (yearInp) yearInp.value = String(now.getFullYear());

  const endEl = document.getElementById('histEndDate');
  const startEl = document.getElementById('histStartDate');
  if (endEl && !endEl.value) endEl.value = now.toISOString().split('T')[0];
  if (startEl && !startEl.value) {
    const past = new Date(now.getTime() - 30 * 86400000);
    startEl.value = past.toISOString().split('T')[0];
  }
}

async function loadDashboardData() {
  try {
    const resp = await fetch('/api/dashboard/student');
    const data = await resp.json();
    if (!data.success) return;

    currentDashboard = data;
    currentStudent = data.student;
    const summary = data.widgets?.attendanceSummary || {};
    const subjects = summary.subjects || [];

    const fullNameUpper = (currentStudent.name || currentUser.fullName || 'STUDENT').toUpperCase();
    const navName = document.getElementById('navUserNameDisplay');
    if (navName) navName.textContent = fullNameUpper;
    const greeting = document.getElementById('greetingUser');
    if (greeting) greeting.textContent = `Hello, ${fullNameUpper} 👋`;

    const qidEl = document.getElementById('modalStudentQid');
    if (qidEl) qidEl.textContent = currentStudent.studentId || '';

    const qumsEl = document.getElementById('qumsStatusDisplay');
    const disconnectQumsBtn = document.getElementById('disconnectQumsBtn');
    const portalConnected = Boolean(data.qumsStatus && data.qumsStatus.connected);
    const portalState = String(data.qumsStatus?.status || (portalConnected ? 'connected' : 'disconnected')).toLowerCase();
    if (qumsEl) {
      if (portalConnected) qumsEl.innerHTML = `<span style="color: #16a34a;">Connected ✅</span>`;
      else if (portalState === 'expired') qumsEl.innerHTML = `<span style="color: #d97706;">Expired ⚠️</span>`;
      else qumsEl.innerHTML = `<span style="color: #6b7280;">Not Connected</span>`;
    }
    if (disconnectQumsBtn) disconnectQumsBtn.style.display = portalConnected ? 'inline' : 'none';

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

    const todayClasses = data.widgets?.todayTimetable || [];
    const countDisplay = document.getElementById('classesTodayCountDisplay');
    if (countDisplay) countDisplay.textContent = String(todayClasses.length);

    renderLiveTiming(data.widgets?.rightNow, data.widgets?.upNext, data.widgets?.classSubstitutions || []);
    renderTodayClasses(todayClasses);

    const qmSubjects = document.getElementById('qmSubjects');
    if (qmSubjects) qmSubjects.textContent = summary.totalSubjects ?? subjects.length;
    const qmBelow75 = document.getElementById('qmBelow75');
    if (qmBelow75) qmBelow75.textContent = below75;
    const qmOk = document.getElementById('qmOk');
    if (qmOk) qmOk.textContent = summary.okCount ?? Math.max(0, subjects.length - below75);
    const qmOverall = document.getElementById('qmOverall');
    if (qmOverall) qmOverall.textContent = overallPctText;
    const qmPeriod = document.getElementById('qmPeriod');
    if (qmPeriod) qmPeriod.textContent = data.periodDisplay || '-';

    renderSubjectsTable(subjects, portalConnected);
    renderNotificationsFeed(data.feed?.notifications || []);
  } catch (err) {
    console.error('[dashboard] Render error:', err);
  }
}

function renderLiveTiming(rightNow, upNext, substitutions) {
  const rnEl = document.getElementById('rightNowContent');
  const unEl = document.getElementById('upNextContent');
  const subBox = document.getElementById('substitutionsAlertBox');

  if (rnEl) {
    if (rightNow) {
      rnEl.innerHTML =
        `<strong style="color: var(--primary);">${esc(rightNow.subject_name)} (${esc(rightNow.subject_code)})</strong>` +
        `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Room ${esc(rightNow.classroom || 'TBD')} • ${esc(rightNow.remainingMinutes)} min left (${esc(rightNow.progressPercent)}%)</div>`;
    } else {
      rnEl.textContent = 'No active class in session.';
    }
  }

  if (unEl) {
    if (upNext) {
      unEl.innerHTML =
        `<strong>${esc(upNext.subject_name)} (${esc(upNext.subject_code)})</strong>` +
        `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Starts in ${esc(upNext.startsInMinutes)} min • Room ${esc(upNext.classroom || 'TBD')}</div>`;
    } else {
      unEl.textContent = 'No upcoming class remaining today.';
    }
  }

  if (subBox) {
    if (substitutions && substitutions.length > 0) {
      subBox.style.display = 'block';
      subBox.innerHTML =
        `<strong>Class Substitution Notice:</strong> ` +
        substitutions
          .map(
            (s) =>
              `${esc(s.subject_code)} (${esc(s.period_label || `P${s.period_number}`)}) substituted by <strong>${esc(s.substitute_faculty_name || 'Substitute Faculty')}</strong>`
          )
          .join(' | ');
    } else {
      subBox.style.display = 'none';
    }
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
    const periodLabel = c.period_label && c.period_label.startsWith('P') && c.period_label.length <= 3 ? c.period_label : `P${c.period_number}`;
    const timeStr = `${String(c.start_time || '09:00').slice(0, 5)} - ${String(c.end_time || '09:55').slice(0, 5)}`;
    const roomStr = c.classroom ? `Room ${esc(c.classroom)}` : 'Room TBD';
    html += `
      <div class="today-class-line">
        <span class="today-class-title">${esc(periodLabel)} - ${esc(c.subject_name)}</span>
        <span class="today-class-meta">${esc(timeStr)} - ${roomStr}</span>
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
        <td><div class="subject-cell-name">${esc(s.subject_name)}</div></td>
        <td><span class="code-badge">${esc(s.subject_code)}</span></td>
        <td><span class="attended-counts">${esc(s.present_classes)} / ${esc(s.marked_classes)}</span></td>
        <td><span class="pct-badge ${isOk ? 'good' : 'bad'}">${esc(pct)}%</span></td>
        <td><span class="status-tag ${statusClass}">${statusLabel}</span></td>
        <td><div class="guidance-text">${esc(s.guidance || '-')}</div></td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function renderNotificationsFeed(list) {
  const el = document.getElementById('notificationsFeedList');
  if (!el) return;
  if (!list || list.length === 0) {
    el.textContent = 'No notifications yet.';
    return;
  }
  el.innerHTML = list
    .map(
      (n) => `
      <div style="padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: 10px; align-items: center;">
        <div>
          <strong style="color: var(--text);">${esc(n.title || n.type || 'Notification')}</strong>
          <div style="font-size: 12.5px;">${esc(n.message || '')}</div>
        </div>
        ${
          n.is_read
            ? '<span style="font-size: 11px; color: var(--text-muted);">Read</span>'
            : `<button type="button" class="btn-secondary mark-notif-read" data-notif-id="${esc(n.id)}" style="padding: 4px 10px; font-size: 11px;">Mark Read</button>`
        }
      </div>`
    )
    .join('');

  el.querySelectorAll('.mark-notif-read').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/notifications/${encodeURIComponent(btn.dataset.notifId)}/read`, { method: 'POST' });
      loadDashboardData();
    });
  });
}

// ====================================================================
// TAB 2: MONTHLY CALENDAR, BACKDATED HISTORY & CORRECTIONS
// ====================================================================

async function loadCalendarAndHistory() {
  const month = document.getElementById('calMonthSelect')?.value || String(new Date().getMonth() + 1);
  const year = document.getElementById('calYearInput')?.value || String(new Date().getFullYear());
  const grid = document.getElementById('monthlyCalendarGrid');

  try {
    const resp = await fetch(`/api/attendance/monthly?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
    const data = await resp.json();
    if (grid) {
      if (!data.success) {
        grid.textContent = 'Could not load monthly register.';
      } else {
        const byDate = data.registerByDate || {};
        const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
        let html = '';
        for (let day = 1; day <= daysInMonth; day++) {
          const dKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const recs = byDate[dKey] || [];
          const pres = recs.filter((r) => r.status === 'present').length;
          const abs = recs.filter((r) => r.status === 'absent').length;
          const bg = abs > 0 ? '#fef2f2' : pres > 0 ? '#ecfdf5' : 'var(--surface-alt)';
          html += `
            <div style="border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: ${bg}; min-height: 58px;">
              <div style="font-weight: 700; font-size: 12px;">${day}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px;">
                ${recs.length ? `${pres}P / ${abs}A` : '-'}
              </div>
            </div>
          `;
        }
        grid.innerHTML = html;
      }
    }
  } catch (err) {}

  await Promise.all([loadHistoryRange(), loadMyCorrections()]);
}

async function loadHistoryRange() {
  const startDate = document.getElementById('histStartDate')?.value;
  const endDate = document.getElementById('histEndDate')?.value;
  const tbody = document.getElementById('historyAttendanceTbody');
  if (!tbody || !startDate || !endDate) return;

  try {
    const resp = await fetch(`/api/attendance/history?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    const data = await resp.json();
    const rows = data.records || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No attendance records in this date range.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const dStr = String(r.class_date || '').slice(0, 10);
        const recId = r.record_id;
        return `
          <tr>
            <td>${esc(dStr)}</td>
            <td>P${esc(r.period_number || 1)}</td>
            <td><strong>${esc(r.subject_code)}</strong> — ${esc(r.subject_name)}</td>
            <td>${esc(r.faculty_name || '-')}</td>
            <td><span class="status-tag ${r.status === 'present' ? 'ok' : 'attention'}">${esc(String(r.status).toUpperCase())}</span></td>
            <td>
              ${
                recId
                  ? `<button type="button" class="btn-secondary req-corr-btn" data-record-id="${esc(recId)}" style="padding: 4px 10px; font-size: 11px;">Request Correction</button>`
                  : '-'
              }
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('.req-corr-btn').forEach((btn) => {
      btn.addEventListener('click', () => requestCorrectionForRecord(btn.dataset.recordId));
    });
  } catch (err) {}
}

async function requestCorrectionForRecord(recordId) {
  const newStatus = prompt('Enter requested status (present, absent, or approved_leave):', 'present');
  if (!newStatus) return;
  const reason = prompt('Provide reason for correction:');
  if (!reason) return;

  const resp = await fetch('/api/attendance/correction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId: Number(recordId), newStatus: newStatus.trim(), reason: reason.trim() }),
  });
  const data = await resp.json();
  alert(data.success ? 'Correction request submitted.' : data.error || 'Could not submit correction.');
  if (data.success) loadMyCorrections();
}

async function loadMyCorrections() {
  const tbody = document.getElementById('myCorrectionsTbody');
  if (!tbody) return;
  const resp = await fetch('/api/attendance/corrections');
  const data = await resp.json();
  const rows = data.corrections || [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 18px; color: var(--text-muted);">No correction requests submitted.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (c) => `
      <tr>
        <td>${esc(String(c.class_date || '').slice(0, 10))}</td>
        <td>${esc(c.subject_code)} — ${esc(c.subject_name)}</td>
        <td>${esc(c.old_status)} → <strong>${esc(c.new_status)}</strong></td>
        <td>${esc(c.reason)}</td>
        <td><span class="status-tag ${c.status === 'approved' ? 'ok' : 'attention'}">${esc(c.status)}</span></td>
      </tr>`
    )
    .join('');
}

// ====================================================================
// TAB 3: TIMETABLE & SUBSTITUTIONS
// ====================================================================

async function loadTimetableTab() {
  const tbody = document.getElementById('tabTimetableTbody');
  const subTbody = document.getElementById('substitutionsTbody');

  const [ttRes, subRes] = await Promise.all([fetch('/api/timetable/weekly'), fetch('/api/timetable/substitutions')]);
  const [ttData, subData] = await Promise.all([ttRes.json(), subRes.json()]);

  if (tbody && ttData.success) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const periods = [1, 2, 3, 4, 5, 6];
    let html = '';
    days.forEach((dayName, idx) => {
      const dayClasses = (ttData.allEntries || []).filter((c) => c.day_of_week === idx + 1);
      html += `<tr><td><strong>${dayName}</strong></td>`;
      periods.forEach((pNum) => {
        const cls = dayClasses.find((c) => c.period_number === pNum);
        html += cls
          ? `<td><div style="font-weight:700; color: var(--primary); font-size:12px;">${esc(cls.subject_code)}</div><div style="font-size:11px; color: var(--text-muted);">${esc(cls.classroom || 'CR-301')}</div></td>`
          : '<td style="color:#cbd5e1; font-size:11px;">-</td>';
      });
      html += '</tr>';
    });
    tbody.innerHTML = html;
  }

  if (subTbody) {
    const subs = subData.substitutions || [];
    subTbody.innerHTML = subs.length
      ? subs
          .map(
            (s) => `
          <tr>
            <td>${esc(String(s.substitution_date).slice(0, 10))}</td>
            <td>${esc(s.period_label)}</td>
            <td>${esc(s.subject_code)} — ${esc(s.subject_name)}</td>
            <td>${esc(s.original_faculty_name)}</td>
            <td><strong>${esc(s.substitute_faculty_name)}</strong></td>
            <td>${esc(s.reason || '-')} (${esc(s.status)})</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No substitutions scheduled.</td></tr>';
  }
}

// ====================================================================
// TAB 4: ACADEMICS, LECTURE PLANS, MATERIALS & ASSIGNMENTS
// ====================================================================

async function loadAcademicsTab() {
  const [profRes, lpRes, matRes, asgnRes] = await Promise.all([
    fetch('/api/academics/profile'),
    fetch('/api/academics/lecture-plans'),
    fetch('/api/academics/study-materials'),
    fetch('/api/academics/assignments'),
  ]);
  const [profData, lpData, matData, asgnData] = await Promise.all([profRes.json(), lpRes.json(), matRes.json(), asgnRes.json()]);

  const profGrid = document.getElementById('academicProfileGrid');
  if (profGrid && profData.success && profData.profile) {
    const p = profData.profile;
    const fields = [
      ['GUeID', p.studentId || '-'],
      ['Enrollment #', p.enrollmentNumber || '-'],
      ['Course', p.courseName || '-'],
      ['Department', p.departmentName || '-'],
      ['Semester / Section', `Sem ${p.semesterNumber || '-'} • ${p.sectionName || '-'}`],
      ['CGPA', p.cgpa ?? '-'],
    ];
    profGrid.innerHTML = fields
      .map(
        ([k, v]) =>
          `<div style="padding:10px; background:var(--surface-alt); border-radius:6px;"><div style="font-size:11px; color:var(--text-muted);">${esc(k)}</div><div style="font-weight:700;">${esc(v)}</div></div>`
      )
      .join('');
  }

  const progEl = document.getElementById('courseProgressGrid');
  if (progEl) {
    const prog = lpData.progress || [];
    progEl.innerHTML = prog.length
      ? prog
          .map(
            (pr) => `
          <div style="border: 1px solid var(--border); padding: 12px; border-radius: 6px;">
            <div style="font-weight:700; color: var(--primary);">${esc(pr.subject_code)}</div>
            <div style="font-size: 12.5px; margin: 2px 0;">${esc(pr.subject_name)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${esc(pr.completed_topics)}/${esc(pr.total_topics)} topics (${esc(pr.progress_percentage)}%)</div>
          </div>`
          )
          .join('')
      : '<p style="font-size: 13px; color: var(--text-muted);">No syllabus progress records yet.</p>';
  }

  const lpTbody = document.getElementById('lecturePlansTbody');
  if (lpTbody) {
    const plans = lpData.plans || [];
    lpTbody.innerHTML = plans.length
      ? plans
          .map(
            (lp) => `
          <tr>
            <td>W${esc(lp.week_number)}</td>
            <td>${esc(lp.subject_code)}</td>
            <td>${esc(lp.topic_title)}</td>
            <td>${esc(lp.faculty_name)}</td>
            <td>${esc(String(lp.planned_date || '').slice(0, 10))}</td>
            <td><span class="status-tag ${lp.completion_status === 'completed' ? 'ok' : 'attention'}">${esc(lp.completion_status)}</span></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" style="text-align: center; padding: 18px; color: var(--text-muted);">No lecture plan items available.</td></tr>';
  }

  const matEl = document.getElementById('studyMaterialsList');
  if (matEl) {
    const mats = matData.materials || [];
    matEl.innerHTML = mats.length
      ? mats
          .map(
            (m) => `
          <div style="padding: 10px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>${esc(m.title)}</strong> <span class="code-badge">${esc(m.subject_code)}</span>
              <div style="font-size: 12px; color: var(--text-muted);">${esc(m.description || '')}</div>
            </div>
            <a href="${esc(cleanUrl(m.file_url))}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="text-decoration:none;">Open Resource</a>
          </div>`
          )
          .join('')
      : '<p style="font-size: 13px; color: var(--text-muted);">No study materials uploaded yet.</p>';
  }

  const asgnTbody = document.getElementById('assignmentsTbody');
  if (asgnTbody) {
    const rows = asgnData.assignments || [];
    asgnTbody.innerHTML = rows.length
      ? rows
          .map(
            (a) => `
          <tr>
            <td><strong>${esc(a.subject_code || '-')}</strong></td>
            <td>${esc(a.title)}<div style="font-size:11.5px; color:var(--text-muted);">${esc(a.description || '')}</div></td>
            <td>${a.due_date ? esc(String(a.due_date).slice(0, 10)) : '-'}</td>
            <td>${a.submission_id ? `Submitted${a.marks_obtained != null ? ` (${esc(a.marks_obtained)}/${esc(a.max_marks)})` : ''}` : 'Pending'}</td>
            <td><button type="button" class="btn-secondary submit-asgn-btn" data-asgn-id="${esc(a.id)}" style="padding: 4px 10px; font-size: 11px;">${a.submission_id ? 'Update Link' : 'Submit'}</button></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5" style="text-align: center; padding: 18px; color: var(--text-muted);">No assignments found.</td></tr>';

    asgnTbody.querySelectorAll('.submit-asgn-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const submissionUrl = prompt('Paste submission URL (GitHub/Drive/PDF link):');
        if (!submissionUrl) return;
        const remarks = prompt('Optional remarks:') || '';
        const res = await fetch(`/api/academics/assignments/${encodeURIComponent(btn.dataset.asgnId)}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionUrl: submissionUrl.trim(), remarks }),
        });
        const out = await res.json();
        alert(out.success ? out.message : out.error || 'Submission failed.');
        if (out.success) loadAcademicsTab();
      });
    });
  }
}

// ====================================================================
// TAB 5: EXAMS & RESULTS
// ====================================================================

async function loadExamsTab() {
  const resp = await fetch('/api/exams/overview');
  const data = await resp.json();
  if (!data.success) return;

  const schedTbody = document.getElementById('examSchedulesTbody');
  if (schedTbody) {
    const sched = data.schedules || [];
    schedTbody.innerHTML = sched.length
      ? sched
          .map(
            (s) => `
          <tr>
            <td>${esc(String(s.exam_date).slice(0, 10))}</td>
            <td>${esc(String(s.start_time).slice(0, 5))} - ${esc(String(s.end_time).slice(0, 5))}</td>
            <td>${esc(s.exam_name)}</td>
            <td><strong>${esc(s.subject_code)}</strong> — ${esc(s.subject_name)}</td>
            <td>${esc(s.room_number || '-')}</td>
            <td>${esc(s.max_marks)}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" style="text-align: center; padding: 18px; color: var(--text-muted);">No upcoming exam schedules.</td></tr>';
  }

  const resSum = document.getElementById('semesterResultsSummary');
  if (resSum) {
    const results = data.results || [];
    resSum.innerHTML = results.length
      ? results
          .map(
            (r) =>
              `<span class="status-tag ok" style="margin-right:8px;">Sem ${esc(r.semester_number)} (${esc(r.session_name)}): SGPA ${esc(r.sgpa)} • CGPA ${esc(r.cgpa)} (${esc(r.result_status)})</span>`
          )
          .join('')
      : '<span style="font-size:13px; color:var(--text-muted);">No published semester results yet.</span>';
  }

  const marksTbody = document.getElementById('marksTbody');
  if (marksTbody) {
    const marks = data.marks || [];
    marksTbody.innerHTML = marks.length
      ? marks
          .map(
            (m) => `
          <tr>
            <td>${esc(m.exam_name)}</td>
            <td>${esc(m.subject_code)} — ${esc(m.subject_name)}</td>
            <td>${esc(m.internal_marks)}</td>
            <td>${esc(m.external_marks)}</td>
            <td><strong>${esc(m.total_marks)} / ${esc(m.max_marks)}</strong></td>
            <td>${esc(m.grade_letter || '-')}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" style="text-align: center; padding: 18px; color: var(--text-muted);">No marks recorded yet.</td></tr>';
  }

  const backEl = document.getElementById('backlogsContainer');
  if (backEl) {
    const backs = data.backlogs || [];
    backEl.innerHTML = backs.length
      ? backs.map((b) => `<div>${esc(b.subject_code)} — ${esc(b.subject_name)} (<strong>${esc(b.status)}</strong>)</div>`).join('')
      : '<span style="color: var(--success);">0 active backlogs ✔</span>';
  }
}

// ====================================================================
// TAB 6: FEES & RECEIPTS
// ====================================================================

async function loadFeesTab() {
  const resp = await fetch('/api/fees/ledger');
  const data = await resp.json();
  if (!data.success) return;

  const totals = data.totals || {};
  document.getElementById('feesTotalDue').textContent = `₹${Number(totals.totalDue || 0).toLocaleString('en-IN')}`;
  document.getElementById('feesTotalPaid').textContent = `₹${Number(totals.totalPaid || 0).toLocaleString('en-IN')}`;
  document.getElementById('feesBalanceDue').textContent = `₹${Number(totals.balanceDue || 0).toLocaleString('en-IN')}`;

  const ledgerTbody = document.getElementById('feesLedgerTbody');
  if (ledgerTbody) {
    const fees = data.fees || [];
    ledgerTbody.innerHTML = fees.length
      ? fees
          .map(
            (f) => `
          <tr>
            <td>${esc(f.session_name)} • Sem ${esc(f.semester_number)}</td>
            <td>₹${esc(f.tuition_fee)}</td>
            <td>₹${Number(f.examination_fee || 0) + Number(f.hostel_fee || 0) + Number(f.library_fee || 0)}</td>
            <td><strong>₹${esc(f.total_due)}</strong></td>
            <td>₹${esc(f.amount_paid)}</td>
            <td>${esc(String(f.due_date || '').slice(0, 10))}</td>
            <td><span class="status-tag ${f.status === 'paid' ? 'ok' : 'attention'}">${esc(String(f.status).toUpperCase())}</span></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="7" style="text-align: center; padding: 18px; color: var(--text-muted);">No fee ledger entries assigned yet.</td></tr>';
  }

  const rcpTbody = document.getElementById('receiptsTbody');
  if (rcpTbody) {
    const rcps = data.receipts || [];
    rcpTbody.innerHTML = rcps.length
      ? rcps
          .map(
            (r) => `
          <tr>
            <td><strong>${esc(r.receipt_number)}</strong></td>
            <td>${esc(String(r.payment_date || '').slice(0, 10))}</td>
            <td>${esc(r.payment_method)}</td>
            <td><code>${esc(r.transaction_reference)}</code></td>
            <td>₹${esc(r.amount)}</td>
            <td><button type="button" class="btn-secondary view-receipt-btn" data-rcp="${esc(r.receipt_number)}" style="padding: 4px 10px; font-size: 11px;">View Receipt</button></td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="6" style="text-align: center; padding: 18px; color: var(--text-muted);">No payment receipts found.</td></tr>';

    rcpTbody.querySelectorAll('.view-receipt-btn').forEach((btn) => {
      btn.addEventListener('click', () => viewReceipt(btn.dataset.rcp));
    });
  }
}

async function viewReceipt(receiptNumber) {
  openModal('receiptModal');
  const body = document.getElementById('receiptModalBody');
  body.textContent = 'Loading receipt...';
  const resp = await fetch(`/api/fees/receipts/${encodeURIComponent(receiptNumber)}`);
  const data = await resp.json();
  if (!data.success || !data.receipt) {
    body.textContent = data.error || 'Could not load receipt.';
    return;
  }
  const r = data.receipt;
  body.innerHTML = `
    <div style="line-height: 1.7; font-size: 13.5px;">
      <div><strong>Receipt #:</strong> ${esc(r.receipt_number)}</div>
      <div><strong>Student:</strong> ${esc(r.full_name)} (${esc(r.gueid)})</div>
      <div><strong>Session / Semester:</strong> ${esc(r.session_name)} • Sem ${esc(r.semester_number)}</div>
      <div><strong>Amount Paid:</strong> ₹${esc(r.amount)}</div>
      <div><strong>Method / Ref:</strong> ${esc(r.payment_method)} • <code>${esc(r.transaction_reference)}</code></div>
      <div><strong>Date:</strong> ${esc(new Date(r.payment_date).toLocaleString())}</div>
    </div>
  `;
}

// ====================================================================
// TAB 7: CIRCULARS, HOSTEL/PLACEMENTS & GRIEVANCES
// ====================================================================

async function loadCampusTab() {
  const [circRes, hpRes, grvRes] = await Promise.all([
    fetch('/api/campus/circulars'),
    fetch('/api/campus/hostel-placements'),
    fetch('/api/campus/grievances'),
  ]);
  const [circData, hpData, grvData] = await Promise.all([circRes.json(), hpRes.json(), grvRes.json()]);

  const circEl = document.getElementById('circularsContainer');
  if (circEl) {
    const circulars = circData.circulars || [];
    circEl.innerHTML = circulars.length
      ? circulars
          .map(
            (c) => `
          <div style="padding: 12px 0; border-bottom: 1px solid var(--border);">
            <div style="font-size: 11px; color: var(--primary); font-weight: 700;">${esc(c.circular_number)} • ${esc(c.category.toUpperCase())}</div>
            <div style="font-weight: 700; font-size: 14.5px; margin: 2px 0;">${esc(c.title)}</div>
            <div style="font-size: 13px; color: var(--text-muted);">${esc(c.content)}</div>
          </div>`
          )
          .join('')
      : '<p style="font-size: 13px; color: var(--text-muted);">No official circulars published yet.</p>';
  }

  const hostelEl = document.getElementById('hostelInfoBox');
  if (hostelEl) {
    hostelEl.innerHTML = hpData.hostel
      ? `<div><strong>${esc(hpData.hostel.hostel_name)}</strong> — Room ${esc(hpData.hostel.room_number)} (Bed ${esc(hpData.hostel.bed_number)})</div><div style="font-size:12px; color:var(--text-muted);">Warden: ${esc(hpData.hostel.warden_name)}</div>`
      : '<span style="font-size:13px; color:var(--text-muted);">No active hostel allocation.</span>';
  }

  const plEl = document.getElementById('placementsBox');
  if (plEl) {
    const pls = hpData.placements || [];
    plEl.innerHTML = pls.length
      ? pls
          .map(
            (p) =>
              `<div style="padding:6px 0; border-bottom:1px solid var(--border);"><strong>${esc(p.company_name)}</strong> — ${esc(p.job_title)} (₹${esc(p.ctc_lpa)} LPA)</div>`
          )
          .join('')
      : '<span style="font-size:13px; color:var(--text-muted);">No active placement drives.</span>';
  }

  const grvEl = document.getElementById('grievancesList');
  if (grvEl) {
    const grvs = grvData.grievances || [];
    grvEl.innerHTML = grvs.length
      ? grvs
          .map(
            (g) => `
          <div style="padding: 12px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 10px;">
            <div style="display:flex; justify-content:space-between; gap:8px;">
              <strong>${esc(g.subject)}</strong>
              <span class="status-tag ${g.status === 'resolved' || g.status === 'closed' ? 'ok' : 'attention'}">${esc(g.status)}</span>
            </div>
            <div style="font-size: 12.5px; color: var(--text-muted); margin: 4px 0;">${esc(g.description)}</div>
            ${(g.responses || []).map((r) => `<div style="margin-top:6px; padding:6px 10px; background: var(--surface-alt); border-radius:4px; font-size:12px;"><strong>${esc(r.author_name)}:</strong> ${esc(r.message)}</div>`).join('')}
          </div>`
          )
          .join('')
      : '<span style="font-size: 13px; color: var(--text-muted);">No grievances submitted yet.</span>';
  }
}

function switchDashboardTab(tabId) {
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('[data-dash-tab]').forEach((b) => b.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  document.querySelector(`[data-dash-tab="${tabId}"]`)?.classList.add('active');

  if (!loadedTabs.has(tabId)) {
    loadedTabs.add(tabId);
    if (tabId === 'calendarTab') loadCalendarAndHistory();
    else if (tabId === 'timetableTab') loadTimetableTab();
    else if (tabId === 'academicsTab') loadAcademicsTab();
    else if (tabId === 'examsTab') loadExamsTab();
    else if (tabId === 'feesTab') loadFeesTab();
    else if (tabId === 'campusTab') loadCampusTab();
  }
}

function setupEventListeners() {
  document.querySelectorAll('[data-dash-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchDashboardTab(btn.dataset.dashTab));
  });

  document.getElementById('loadCalendarBtn')?.addEventListener('click', loadCalendarAndHistory);
  document.getElementById('loadHistoryBtn')?.addEventListener('click', loadHistoryRange);

  document.getElementById('newGrievanceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = document.getElementById('grvCategory').value;
    const subject = document.getElementById('grvSubject').value.trim();
    const description = document.getElementById('grvDescription').value.trim();
    const res = await fetch('/api/campus/grievances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, subject, description }),
    });
    const out = await res.json();
    alert(out.success ? 'Grievance submitted.' : out.error || 'Submission failed.');
    if (out.success) {
      e.target.reset();
      loadCampusTab();
    }
  });

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
        }, 400);
      }
    });
  }

  const toggleBtn = document.getElementById('toggleTodayClassesBtn');
  const section = document.getElementById('todayClassesSection');
  if (toggleBtn && section) {
    toggleBtn.addEventListener('click', () => {
      if (section.style.display === 'none') {
        section.style.display = 'block';
        toggleBtn.textContent = "Hide today's classes";
      } else {
        section.style.display = 'none';
        toggleBtn.textContent = "Load today's classes";
      }
    });
  }

  document.getElementById('disconnectQumsBtn')?.addEventListener('click', async () => {
    if (confirm('Disconnect GEU portal session?')) {
      await fetch('/api/geu/disconnect', { method: 'POST' });
      loadDashboardData();
    }
  });

  document.getElementById('disconnectTgBtn')?.addEventListener('click', async () => {
    if (confirm('Disconnect Telegram notifications?')) {
      await fetch('/api/telegram/unlink', { method: 'POST' });
      loadDashboardData();
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  document.getElementById('modalGenTokenBtn')?.addEventListener('click', async () => {
    const genBtn = document.getElementById('modalGenTokenBtn');
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
    } finally {
      genBtn.disabled = false;
    }
  });
}

function openModal(modalId) {
  document.getElementById(modalId)?.classList.add('open');
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('open');
}

function initTheme() {
  const saved = localStorage.getItem('gueattend-theme') || 'emerald';
  document.documentElement.setAttribute('data-theme', saved);
}

const spinStyle = document.createElement('style');
spinStyle.textContent = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
document.head.appendChild(spinStyle);

window.addEventListener('DOMContentLoaded', initDashboard);
