/**
 * Graphic Era University ERP Modular Adapter Interface
 *
 * Keeps external university scraping / sync modular without inventing undocumented
 * post-login `student.geu.ac.in` endpoints or bypassing Cloudflare Turnstile.
 *
 * See `GRAPHIC_ERA_ERP_INTEGRATION.md` for documented endpoints & schemas.
 */

const externalSync = require('./external-sync');

const DOCUMENTED_ERP_CAPABILITIES = {
  loginAndCaptchaRelay: {
    status: 'IMPLEMENTED',
    loginUrl: process.env.COLLEGE_LOGIN_URL || 'https://student.geu.ac.in/N0j5Ha0',
    turnstileBypass: false,
  },
  postLoginLiveEndpoints: {
    status: 'AWAITING_AUTHORIZED_ENDPOINT_EVIDENCE',
    requiredContracts: [
      'fetchStudentProfile(sessionCookies) -> { gueid, fullName, course, semester, section, enrollmentNumber }',
      'fetchSubjectAttendance(sessionCookies) -> Array<{ subjectCode, subjectName, presentCount, absentCount, markedCount }>',
      'fetchTodaySchedule(sessionCookies, dateStr) -> Array<{ periodNumber, startTime, endTime, subjectCode, facultyName, status }>',
      'fetchMonthlyRegister(sessionCookies, month, year) -> Array<{ classDate, periodNumber, subjectCode, status }>',
      'fetchWeeklyTimetable(sessionCookies) -> Array<{ dayOfWeek, periodNumber, subjectCode, room, facultyName }>',
      'fetchAssignments(sessionCookies) -> Array<{ externalId, subjectCode, title, dueDate, attachmentUrl }>',
    ],
  },
  authorizedBatchIngestion: {
    status: 'IMPLEMENTED',
    method: 'external-sync.syncAttendanceBatch + /api/admin/import/excel',
  },
};

class BaseGeuErpAdapter {
  getCapabilities() {
    return DOCUMENTED_ERP_CAPABILITIES;
  }

  async fetchStudentProfile() {
    throw new Error('NOT_CONFIGURED: Authorized post-login GEU profile endpoint not yet registered.');
  }

  async fetchSubjectAttendance() {
    throw new Error('NOT_CONFIGURED: Authorized post-login GEU attendance endpoint not yet registered.');
  }

  async fetchTodaySchedule() {
    throw new Error('NOT_CONFIGURED: Authorized post-login GEU today schedule endpoint not yet registered.');
  }

  async fetchMonthlyRegister() {
    throw new Error('NOT_CONFIGURED: Authorized post-login GEU monthly register endpoint not yet registered.');
  }

  async fetchWeeklyTimetable() {
    throw new Error('NOT_CONFIGURED: Authorized post-login GEU timetable endpoint not yet registered.');
  }

  async fetchAssignments() {
    throw new Error('NOT_CONFIGURED: Authorized post-login GEU assignments endpoint not yet registered.');
  }

  async ingestAuthorizedAttendanceBatch(records, sourceName = 'GEU_AUTHORIZED_SYNC', syncedByUserId = null) {
    return externalSync.syncAttendanceBatch(records, sourceName, syncedByUserId);
  }
}

module.exports = {
  DOCUMENTED_ERP_CAPABILITIES,
  BaseGeuErpAdapter,
  defaultErpAdapter: new BaseGeuErpAdapter(),
};
