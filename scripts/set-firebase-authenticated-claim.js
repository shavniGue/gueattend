/**
 * Migration Script: Assign `role = "authenticated"` custom JWT claim
 * to all existing Firebase Auth users in project `gueattend` for
 * Supabase Third-Party Authentication.
 *
 * Keeps application roles (`student`, `faculty`, `admin`) separate in
 * `public.users.role` and optional `app_role` claim; top-level `role` claim
 * is strictly `"authenticated"` for PostgreSQL / Supabase RLS.
 *
 * Usage:
 *   node scripts/set-firebase-authenticated-claim.js [--dry-run]
 */

require('dotenv').config();
const { getAuth } = require('firebase-admin/auth');
const {
  getFirebaseApp,
  hasServiceAccountCredential,
  isAdminEmail,
  setAuthenticatedUserClaim,
} = require('../src/config/firebase');
const db = require('../src/database/db');

const DRY_RUN = process.argv.includes('--dry-run');

async function resolveAppRole(firebaseUser) {
  const cleanEmail = (firebaseUser.email || '').trim().toLowerCase();
  if (!cleanEmail) return 'student';

  try {
    const dbUser = await db.getUserByEmail(cleanEmail);
    if (dbUser) {
      if (dbUser.role === 'admin' || dbUser.is_admin === true || isAdminEmail(cleanEmail)) {
        return 'admin';
      }
      return dbUser.role || 'student';
    }
  } catch (err) {}

  return isAdminEmail(cleanEmail) ? 'admin' : 'student';
}

async function migrateExistingFirebaseUsers() {
  const app = getFirebaseApp();
  if (!app || !hasServiceAccountCredential()) {
    console.error(
      '[firebase-claims] ERROR: Firebase Admin Service Account credentials are required to list users and set custom claims.'
    );
    console.error(
      '[firebase-claims] Set FIREBASE_SERVICE_ACCOUNT_KEY (path, JSON, or base64) or GOOGLE_APPLICATION_CREDENTIALS in .env.'
    );
    process.exit(1);
  }

  const auth = getAuth(app);
  let nextPageToken;
  let scanned = 0;
  let updated = 0;
  let alreadyCompliant = 0;
  let failed = 0;

  console.log(`[firebase-claims] Scanning Firebase users (dryRun=${DRY_RUN})...`);

  do {
    const page = await auth.listUsers(1000, nextPageToken);
    for (const userRecord of page.users) {
      scanned++;
      const existingClaims = userRecord.customClaims || {};
      const appRole = await resolveAppRole(userRecord);

      if (existingClaims.role === 'authenticated' && existingClaims.app_role === appRole) {
        alreadyCompliant++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY-RUN] Would assign role="authenticated", app_role="${appRole}" to UID ${userRecord.uid}`);
        updated++;
        continue;
      }

      try {
        await setAuthenticatedUserClaim(userRecord.uid, appRole);
        updated++;
      } catch (err) {
        failed++;
        console.error(`  [ERROR] Failed for UID ${userRecord.uid}: ${err.message}`);
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  console.log(
    `[firebase-claims] Completed. scanned=${scanned}, updated=${updated}, alreadyCompliant=${alreadyCompliant}, failed=${failed}`
  );
  process.exit(failed > 0 ? 1 : 0);
}

migrateExistingFirebaseUsers().catch((err) => {
  console.error('[firebase-claims] Fatal error:', err.message);
  process.exit(1);
});

