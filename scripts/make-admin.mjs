/**
 * gueattend - Assign Administrator Role
 * 
 * Configures administrator privileges for shavnikumarigue@gmail.com across:
 * 1. Supabase PostgreSQL (gueattend primary source of truth)
 * 2. Firebase Authentication (Custom User Claims: role: 'admin', admin: true)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const TARGET_EMAIL = process.argv[2] || 'shavnikumarigue@gmail.com';

console.log('====================================================');
console.log(` gueattend - Administrator Role Setup`);
console.log(` Target Account: ${TARGET_EMAIL}`);
console.log('====================================================\n');

/**
 * 1. Synchronize Supabase PostgreSQL ERP Database
 */
async function syncSupabaseAdmin() {
  console.log('[1/2] Synchronizing Supabase PostgreSQL ERP Database...');
  
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('  ⚠️ DATABASE_URL not set in .env. Skipping Supabase DB sync.');
    return;
  }

  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const passwordHash = await bcrypt.hash('Admin@GEU2025!', 10);
    const query = `
      INSERT INTO users (
        id, email, password_hash, role, is_admin, email_verified, full_name, is_active, created_at, updated_at
      )
      VALUES (
        'usr_admin_shavni', LOWER($1), $2, 'admin', TRUE, TRUE, 'Shavni Kumari (Administrator)', TRUE, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        email = LOWER($1),
        role = 'admin',
        is_admin = TRUE,
        email_verified = TRUE,
        full_name = 'Shavni Kumari (Administrator)',
        password_hash = $2,
        updated_at = NOW()
      RETURNING id, email, role, is_admin, full_name;
    `;

    const res = await pool.query(query, [TARGET_EMAIL, passwordHash]);
    console.log('  ✔ Supabase PostgreSQL record updated successfully:');
    console.log(`    - User ID:   ${res.rows[0].id}`);
    console.log(`    - Email:     ${res.rows[0].email}`);
    console.log(`    - Role:      ${res.rows[0].role}`);
    console.log(`    - Is Admin:  ${res.rows[0].is_admin}`);
    console.log(`    - Full Name: ${res.rows[0].full_name}`);
    console.log(`    - Initial Temporary Password: Admin@GEU2025!\n`);
  } catch (err) {
    console.error('  ✖ Supabase sync error:', err.message);
  } finally {
    await pool.end();
  }
}

/**
 * 2. Assign Custom Claims in Firebase Authentication
 */
async function syncFirebaseAdmin() {
  console.log('[2/2] Assigning Firebase Auth Custom User Claims...');

  // Candidate paths for service account key
  const candidateKeyPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
    path.resolve(process.cwd(), 'service-account.json'),
    path.resolve(process.cwd(), 'firebase-service-account.json'),
    path.resolve(process.cwd(), 'config', 'firebase-service-account.json'),
  ].filter(Boolean);

  let credential;
  let usedPath = null;

  for (const candidate of candidateKeyPaths) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const keyData = JSON.parse(raw);
        credential = cert(keyData);
        usedPath = candidate;
        break;
      } catch (e) {
        // continue
      }
    }
  }

  if (!credential) {
    // Fall back to applicationDefault()
    credential = applicationDefault();
  }

  let app;
  if (getApps().length === 0) {
    try {
      app = initializeApp({
        credential,
        projectId: process.env.FIREBASE_PROJECT_ID || 'gueattend',
      });
    } catch (e) {
      console.warn('  ⚠️ Firebase initializeApp failed:', e.message);
    }
  } else {
    app = getApps()[0];
  }

  if (!app) {
    console.warn('  ⚠️ Could not initialize Firebase Admin SDK.');
    return;
  }

  const auth = getAuth(app);

  try {
    const user = await auth.getUserByEmail(TARGET_EMAIL);

    if (!user.emailVerified) {
      console.warn(`  ⚠️ Warning: Email ${TARGET_EMAIL} is not marked verified in Firebase.`);
      console.log('     Proceeding to mark email verified and set claims...');
      await auth.updateUser(user.uid, { emailVerified: true });
    }

    const existingClaims = user.customClaims || {};

    await auth.setCustomUserClaims(user.uid, {
      ...existingClaims,
      role: 'admin',
      admin: true,
    });

    console.log('  ✔ Firebase Admin role assigned successfully!');
    console.log(`    - Email:     ${TARGET_EMAIL}`);
    console.log(`    - UID:       ${user.uid}`);
    console.log('    - Claims:   ', { ...existingClaims, role: 'admin', admin: true });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log(`  ℹ User ${TARGET_EMAIL} does not exist yet in Firebase Auth.`);
      console.log('    Creating admin account in Firebase Auth directly...');
      try {
        const newUser = await auth.createUser({
          email: TARGET_EMAIL,
          emailVerified: true,
          password: 'Admin@GEU2025!',
          displayName: 'Shavni Kumari (Administrator)',
        });
        await auth.setCustomUserClaims(newUser.uid, {
          role: 'admin',
          admin: true,
        });
        console.log('  ✔ Created and assigned admin claims in Firebase Auth!');
        console.log(`    - UID: ${newUser.uid}`);
      } catch (createErr) {
        console.error('  ✖ Could not create Firebase Auth user:', createErr.message);
      }
    } else {
      console.error('  ✖ Firebase Admin setup encountered an error:');
      console.error(`    ${error.message}\n`);
      if (error.message.includes('metadata.google.internal') || error.message.includes('credential')) {
        console.log('  -------------------------------------------------------------');
        console.log('  ℹ ACTION REQUIRED FOR FIREBASE ADMIN SDK CREDENTIAL:');
        console.log('  To grant Firebase Admin SDK permission to manage auth claims:');
        console.log('  1. Open Firebase Console:');
        console.log('     https://console.firebase.google.com/project/gueattend/settings/serviceaccounts/adminsdk');
        console.log('  2. Click "Generate new private key" to download service account JSON.');
        console.log('  3. Save it to project root as: service-account.json');
        console.log('  4. Re-run: npm run make-admin');
        console.log('  -------------------------------------------------------------\n');
      }
    }
  }
}

async function run() {
  await syncSupabaseAdmin();
  await syncFirebaseAdmin();
  console.log('====================================================');
  console.log(' gueattend Admin Role Setup Complete');
  console.log('====================================================');
}

run();

