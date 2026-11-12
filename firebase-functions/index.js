/**
 * Firebase Cloud Functions for Project: gueattend
 * Automatically assigns custom JWT claim `role = "authenticated"` on newly created
 * Firebase Auth users so Supabase Third-Party Authentication recognizes them immediately.
 *
 * Note: Our Express backend (`POST /api/auth/register`, `POST /api/auth/sync-claims`,
 * and `establishSessionFromIdToken`) ALSO assigns `role = "authenticated"` automatically
 * when FIREBASE_SERVICE_ACCOUNT_KEY is configured, so deployment of Cloud Functions is
 * complementary and zero-downtime.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.assignAuthenticatedRoleOnSignup = functions.auth.user().onCreate(async (user) => {
  if (!user || !user.uid) return null;
  const existing = user.customClaims || {};
  if (existing.role === 'authenticated') {
    return null;
  }

  await admin.auth().setCustomUserClaims(user.uid, {
    ...existing,
    role: 'authenticated',
    app_role: existing.app_role || 'student',
  });

  return { uid: user.uid, role: 'authenticated' };
});

