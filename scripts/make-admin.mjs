/**
 * gueattend - Assign Administrator Role
 *
 * Verifies Firebase UID and authorized account mapping for shavnikumarigue@gmail.com,
 * assigns Supabase Third-Party Auth claim `role: 'authenticated'` (keeping `app_role: 'admin'` separate),
 * and updates Supabase PostgreSQL without storing any password hash.
 */

import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';
import { createRequire } from 'module';
import { getAuth } from 'firebase-admin/auth';

const require = createRequire(import.meta.url);
const { getFirebaseApp, isAdminEmail } = require('../src/config/firebase');
const { FIREBASE_PASSWORD_SENTINEL, setAuthenticatedUserClaim } = (() => {
  const fb = require('../src/config/firebase');
  const fba = require('../src/firebaseAuth');
  return { ...fb, ...fba };
})();

function parseCliArgs(argv) {
  let email = null;
  let uid = null;
  for (const arg of argv) {
    if (arg.startsWith('--uid=')) uid = arg.slice(6).trim();
    else if (!arg.startsWith('--') && arg.includes('@') && !email) email = arg.trim().toLowerCase();
  }
  return { email: email || 'shavnikumarigue@gmail.com', uid };
}

async function run() {
  const { email: TARGET_EMAIL, uid: cliUid } = parseCliArgs(process.argv.slice(2));

  console.log('====================================================');
  console.log(' gueattend - Server-Side Administrator Bootstrap');
  console.log(` Target Account: ${TARGET_EMAIL}`);
  console.log('====================================================\n');

  if (!isAdminEmail(TARGET_EMAIL)) {
    console.error(`✖ Refusing admin bootstrap: ${TARGET_EMAIL} is not listed in authorized ADMIN_EMAILS.`);
    process.exit(1);
  }

  let verifiedUid = cliUid || null;
  const app = getFirebaseApp();

  if (app) {
    const auth = getAuth(app);
    try {
      const fbUser = verifiedUid
        ? await auth.getUser(verifiedUid)
        : await auth.getUserByEmail(TARGET_EMAIL);

      if ((fbUser.email || '').trim().toLowerCase() !== TARGET_EMAIL) {
        throw new Error(`Firebase UID ${fbUser.uid} belongs to ${fbUser.email}, not ${TARGET_EMAIL}.`);
      }

      verifiedUid = fbUser.uid;
      if (!fbUser.emailVerified) {
        await auth.updateUser(verifiedUid, { emailVerified: true });
      }
      await setAuthenticatedUserClaim(verifiedUid, 'admin');
      console.log('✔ Firebase Admin claims synchronized:');
      console.log(`  - UID:   ${verifiedUid}`);
      console.log('  - Claim: role=authenticated, app_role=admin, admin=true\n');
    } catch (error) {
      console.error(`✖ Firebase verification error: ${error.message}`);
      if (!verifiedUid) {
        console.error('  Sign up once via Firebase Authentication or pass --uid=<firebase_uid>.');
        process.exit(1);
      }
    }
  } else if (!verifiedUid) {
    console.error('✖ Firebase Admin SDK credentials not configured and no --uid=<firebase_uid> supplied.');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('⚠️ DATABASE_URL not set. Skipped PostgreSQL update.');
    return;
  }

  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const existing = await pool.query(
      `SELECT id, firebase_uid FROM users WHERE firebase_uid = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
      [verifiedUid, TARGET_EMAIL]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.firebase_uid && row.firebase_uid !== verifiedUid) {
        throw new Error(`Database record for ${TARGET_EMAIL} is bound to a different Firebase UID.`);
      }
      const res = await pool.query(
        `UPDATE users
         SET firebase_uid = $1,
             email = LOWER($2),
             password_hash = $3,
             role = 'admin',
             is_admin = TRUE,
             email_verified = TRUE,
             is_active = TRUE,
             is_suspended = FALSE,
             full_name = COALESCE(NULLIF(full_name, ''), 'Shavni Kumari (Administrator)'),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, email, firebase_uid, role, is_admin, full_name`,
        [verifiedUid, TARGET_EMAIL, FIREBASE_PASSWORD_SENTINEL, row.id]
      );
      console.log('✔ Supabase PostgreSQL administrator record updated:', res.rows[0]);
    } else {
      const newId = `usr_${crypto.randomUUID()}`;
      const res = await pool.query(
        `INSERT INTO users (
           id, email, password_hash, firebase_uid, role, is_admin, email_verified,
           full_name, is_active, is_suspended, qums_session_status, created_at, updated_at
         )
         VALUES ($1, LOWER($2), $3, $4, 'admin', TRUE, TRUE, 'Shavni Kumari (Administrator)', TRUE, FALSE, 'disconnected', NOW(), NOW())
         RETURNING id, email, firebase_uid, role, is_admin, full_name`,
        [newId, TARGET_EMAIL, FIREBASE_PASSWORD_SENTINEL, verifiedUid]
      );
      console.log('✔ Supabase PostgreSQL administrator record created:', res.rows[0]);
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('✖ Fatal:', err.message);
  process.exit(1);
});
