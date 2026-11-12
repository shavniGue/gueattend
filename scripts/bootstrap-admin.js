/**
 * gueattend - Server-Side Administrator Bootstrap
 *
 * Configures administrator privileges for shavnikumarigue@gmail.com across:
 * 1. Firebase Authentication (verifies Firebase UID + sets role='authenticated', app_role='admin', admin=true)
 * 2. Supabase PostgreSQL (stores Firebase UID mapping + role='admin', is_admin=TRUE; NEVER stores passwords)
 * 3. Audit Logs (ADMIN_BOOTSTRAPPED)
 *
 * Usage:
 *   node scripts/bootstrap-admin.js [email] [--uid=<firebase_uid>]
 */

require('dotenv').config();
const crypto = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const db = require('../src/database/db');
const { getFirebaseApp, isAdminEmail } = require('../src/config/firebase');
const {
  FIREBASE_PASSWORD_SENTINEL,
  ensureFirebaseAuthenticatedClaim,
} = require('../src/firebaseAuth');

function parseArgs(argv) {
  let email = null;
  let uid = null;
  for (const arg of argv) {
    if (arg.startsWith('--uid=')) {
      uid = arg.slice(6).trim();
    } else if (arg.startsWith('--email=')) {
      email = arg.slice(8).trim().toLowerCase();
    } else if (!arg.startsWith('--') && arg.includes('@') && !email) {
      email = arg.trim().toLowerCase();
    }
  }
  return {
    email: email || 'shavnikumarigue@gmail.com',
    uid,
  };
}

async function bootstrapAdmin({ email = 'shavnikumarigue@gmail.com', uid = null } = {}) {
  const cleanEmail = String(email).trim().toLowerCase();
  if (!isAdminEmail(cleanEmail)) {
    throw new Error(`Email "${cleanEmail}" is not in authorized ADMIN_EMAILS.`);
  }

  let verifiedUid = uid || null;
  const app = getFirebaseApp();

  if (app) {
    try {
      const fbAuth = getAuth(app);
      const fbUser = verifiedUid
        ? await fbAuth.getUser(verifiedUid)
        : await fbAuth.getUserByEmail(cleanEmail);

      if ((fbUser.email || '').trim().toLowerCase() !== cleanEmail) {
        throw new Error(`Firebase UID ${fbUser.uid} belongs to ${fbUser.email}, not ${cleanEmail}.`);
      }

      verifiedUid = fbUser.uid;
      if (!fbUser.emailVerified) {
        await fbAuth.updateUser(verifiedUid, { emailVerified: true });
      }
      await ensureFirebaseAuthenticatedClaim(verifiedUid, 'admin');
    } catch (fbErr) {
      if (!verifiedUid) {
        throw new Error(
          `Could not verify Firebase UID for ${cleanEmail}: ${fbErr.message}. Sign up via Firebase first or pass --uid=<firebase_uid>.`
        );
      }
    }
  }

  if (!verifiedUid) {
    throw new Error(
      `Firebase UID could not be resolved for ${cleanEmail}. Configure FIREBASE_SERVICE_ACCOUNT_KEY or pass --uid=<firebase_uid>.`
    );
  }

  // Locate existing row safely without ever overriding another UID's account
  const byUid = await db.getUserByFirebaseUid(verifiedUid);
  const byEmail = await db.getUserByEmail(cleanEmail);

  if (byEmail && byEmail.firebase_uid && byEmail.firebase_uid !== verifiedUid) {
    await db.recordAuditLog({
      userId: byEmail.id,
      action: 'ADMIN_BOOTSTRAP_UID_MISMATCH',
      resource: 'admin:bootstrap',
      details: {
        email: cleanEmail,
        existingFirebaseUid: byEmail.firebase_uid,
        attemptedFirebaseUid: verifiedUid,
      },
    });
    throw new Error(
      `Firebase UID mismatch for ${cleanEmail}: database record is bound to a different Firebase UID.`
    );
  }

  const targetUser = byUid || byEmail;
  let adminRow;

  if (targetUser) {
    const upd = await db.query(
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
       RETURNING id, email, firebase_uid, role, is_admin, email_verified, full_name`,
      [verifiedUid, cleanEmail, FIREBASE_PASSWORD_SENTINEL, targetUser.id]
    );
    adminRow = upd.rows[0];
  } else {
    const userId = `usr_${crypto.randomUUID()}`;
    const ins = await db.query(
      `INSERT INTO users (
         id, email, full_name, password_hash, firebase_uid,
         role, is_admin, email_verified, is_active, is_suspended,
         qums_session_status, created_at, updated_at
       )
       VALUES ($1, LOWER($2), 'Shavni Kumari (Administrator)', $3, $4, 'admin', TRUE, TRUE, TRUE, FALSE, 'disconnected', NOW(), NOW())
       RETURNING id, email, firebase_uid, role, is_admin, email_verified, full_name`,
      [userId, cleanEmail, FIREBASE_PASSWORD_SENTINEL, verifiedUid]
    );
    adminRow = ins.rows[0];
  }

  await db.recordAuditLog({
    userId: adminRow.id,
    action: 'ADMIN_BOOTSTRAPPED',
    resource: 'admin:bootstrap',
    details: {
      email: adminRow.email,
      firebaseUid: adminRow.firebase_uid,
      role: 'admin',
      isAdmin: true,
    },
  });

  return adminRow;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    try {
      const adminRow = await bootstrapAdmin(args);
      console.log('✔ GUeAttend Administrator Bootstrapped:');
      console.log(`  - User ID:      ${adminRow.id}`);
      console.log(`  - Email:        ${adminRow.email}`);
      console.log(`  - Firebase UID: ${adminRow.firebase_uid}`);
      console.log(`  - Role:         ${adminRow.role} (is_admin=${adminRow.is_admin})`);
      await db.pool.end().catch(() => {});
    } catch (err) {
      console.error('✖ Admin bootstrap failed:', err.message);
      await db.pool.end().catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { bootstrapAdmin, parseArgs };

