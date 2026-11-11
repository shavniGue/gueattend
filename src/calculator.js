/**
 * Module 4: Mathematical Intelligence Engine (75% Rule)
 * gueattend - Exact Catch-Up & Safe Skip Formulations
 *
 * Mathematical Foundations:
 * 1. Catch-Up Formula (Attendance < 75%):
 *    (A + k) / (T + k) >= 0.75
 *    4(A + k) >= 3(T + k)
 *    4A + 4k >= 3T + 3k
 *    k >= 3T - 4A
 *    k = max(1, ceil(3T - 4A))
 *
 * 2. Safe Skips / Bunk Margin (Attendance >= 75%):
 *    A / (T + k) >= 0.75
 *    4A >= 3(T + k)
 *    4A >= 3T + 3k
 *    3k <= 4A - 3T
 *    k = max(0, floor((4A - 3T) / 3))
 */

/**
 * Compute 75% criteria for a single subject or overall counts
 * @param {number} attended - Attended / Present classes (A)
 * @param {number} total - Total marked classes (T)
 */
function calculateSubject75Margin(attended, total) {
  const A = parseInt(attended, 10) || 0;
  const T = parseInt(total, 10) || 0;

  if (T === 0) {
    return {
      percentage: 0.0,
      isShortage: false,
      canBunk: 0,
      mustAttend: 0,
      status: 'OK',
      guidance: 'Abhi koi class mark nahi hui.',
      message: 'No classes conducted yet.',
    };
  }

  const percentage = Number(((A / T) * 100).toFixed(2));

  // Attendance >= 75% (Safe margin calculation)
  if (percentage >= 75.0) {
    const rawBunk = Math.floor((4 * A - 3 * T) / 3);
    const canBunk = Math.max(0, rawBunk);

    return {
      percentage,
      isShortage: false,
      canBunk,
      mustAttend: 0,
      status: 'OK',
      guidance: `${canBunk} classes miss kar sakte ho aur fir bhi 75%+ rahega.`,
      message: canBunk > 0 ? `Can safely miss ${canBunk} class${canBunk > 1 ? 'es' : ''}.` : 'On track (0 skip margin).',
    };
  }

  // Attendance < 75% (Catch-up calculation with Edge-Case Guard)
  const rawNeed = Math.ceil(3 * T - 4 * A);
  const mustAttend = Math.max(1, rawNeed); // Edge-case guard: even 74.9% requires at least 1 class

  return {
    percentage,
    isShortage: true,
    canBunk: 0,
    mustAttend,
    status: 'ATTENTION',
    guidance: `${mustAttend} classes lagani padegi 75% lane ke liye.`,
    message: `Must attend next ${mustAttend} class${mustAttend > 1 ? 'es' : ''} consecutively for 75%.`,
  };
}

/**
 * Analyze an entire array of subjects
 */
function analyzeSubjectsAttendance(subjects = []) {
  let totalAttended = 0;
  let totalMarked = 0;
  let below75Count = 0;

  const analyzed = subjects.map((sub) => {
    const a = parseInt(sub.present_classes ?? sub.attended, 10) || 0;
    const t = parseInt(sub.marked_classes ?? sub.total, 10) || 0;
    totalAttended += a;
    totalMarked += t;

    const margin = calculateSubject75Margin(a, t);
    if (margin.isShortage) below75Count++;

    return {
      ...sub,
      attended: a,
      total: t,
      percentage: margin.percentage,
      status: margin.status,
      guidance: margin.guidance,
      bunkMargin: margin,
    };
  });

  const overall = calculateSubject75Margin(totalAttended, totalMarked);

  return {
    overallPercentage: overall.percentage,
    totalAttended,
    totalMarked,
    below75Count,
    okCount: analyzed.length - below75Count,
    totalSubjects: analyzed.length,
    overallMargin: overall,
    subjects: analyzed,
  };
}

module.exports = {
  calculateSubject75Margin,
  analyzeSubjectsAttendance,
};

