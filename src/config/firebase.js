/**
 * Firebase Admin Service Configuration for gueattend
 * Project ID: gueattend
 *
 * Reads credentials strictly from server-side environment variables:
 *   - FIREBASE_SERVICE_ACCOUNT_KEY (file path, raw JSON string, or base64 JSON)
 *   - GOOGLE_APPLICATION_CREDENTIALS (standard GCP/Firebase ADC path)
 *
 * Never exposed to frontend code.
 */

const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gueattend';
const SERVICE_ACCOUNT_RAW = (
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
  ''
).trim();

let firebaseInitialized = false;
let hasServiceAccount = false;

/**
 * Safely parse service account from path, inline JSON, or base64-encoded JSON.
 */
function loadServiceAccountFromEnv(raw) {
  if (!raw) return null;

  if (raw.startsWith('{')) {
    return JSON.parse(raw);
  }

  if (fs.existsSync(raw)) {
    return JSON.parse(fs.readFileSync(raw, 'utf8'));
  }

  // Support base64-encoded JSON for PaaS env vars (e.g. Render)
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    if (decoded.startsWith('{')) {
      const parsed = JSON.parse(decoded);
      if (parsed && parsed.private_key && parsed.client_email) {
        return parsed;
      }
    }
  } catch (err) {}

  return null;
}

try {
  const serviceAccount = loadServiceAccountFromEnv(SERVICE_ACCOUNT_RAW);
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gueattend.firebasestorage.app',
      projectId: serviceAccount.project_id || FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
    hasServiceAccount = true;
    console.log('[firebase] Admin SDK initialized with service account.');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
    hasServiceAccount = true;
    console.log('[firebase] Admin SDK initialized with default application credentials.');
  } else {
    // Graceful project-scoped initialization (verifies JWTs via Google public JWKS)
    admin.initializeApp({
      projectId: FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
    console.log(`[firebase] Admin SDK initialized in project scope mode (${FIREBASE_PROJECT_ID}).`);
  }
} catch (err) {
  console.warn('[firebase] Optional Firebase Admin initialization note:', err.message);
}

/**
 * Returns the initialized Firebase Admin App instance (or null)
 */
function getFirebaseApp() {
  return admin.apps.length > 0 ? admin.app() : null;
}

/**
 * Indicates whether Admin SDK has privileged credentials for setCustomUserClaims / listUsers.
 */
function hasServiceAccountCredential() {
  return hasServiceAccount;
}

/**
 * Checks if an email is configured as an administrator in ADMIN_EMAILS
 */
function isAdminEmail(email) {
  if (!email) return false;
  const list = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/**
 * Verifies a Firebase ID Token cryptographically via Firebase Admin SDK.
 */
async function verifyFirebaseToken(idToken, checkRevoked = false) {
  if (!idToken) throw new Error('Firebase ID token is required.');
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }
  return getAuth(app).verifyIdToken(idToken, checkRevoked && hasServiceAccount);
}

/**
 * Assigns Supabase Third-Party Auth's required custom claim `role: "authenticated"`
 * while keeping application roles (`app_role`: student/faculty/admin) strictly separate.
 */
async function setAuthenticatedUserClaim(uid, appRole = null) {
  if (!uid) throw new Error('Firebase UID is required.');
  const app = getFirebaseApp();
  if (!app || !hasServiceAccount) {
    return {
      updated: false,
      skipped: true,
      requiresServiceAccount: true,
      claims: null,
    };
  }

  const auth = getAuth(app);
  const userRecord = await auth.getUser(uid);
  const existingClaims = userRecord.customClaims || {};

  const normalizedAppRole = appRole ? String(appRole).trim().toLowerCase() : existingClaims.app_role || null;
  const alreadyMatches =
    existingClaims.role === 'authenticated' &&
    (!normalizedAppRole || existingClaims.app_role === normalizedAppRole);

  if (alreadyMatches) {
    return {
      updated: false,
      skipped: false,
      requiresServiceAccount: false,
      claims: existingClaims,
    };
  }

  const nextClaims = {
    ...existingClaims,
    role: 'authenticated',
    ...(normalizedAppRole ? { app_role: normalizedAppRole } : {}),
  };

  await auth.setCustomUserClaims(uid, nextClaims);
  return {
    updated: true,
    skipped: false,
    requiresServiceAccount: false,
    claims: nextClaims,
  };
}

/**
 * Diagnostic health-check for Firebase service (never leaks secrets)
 */
function checkFirebaseHealth() {
  const apiKey = (process.env.FIREBASE_API_KEY || '').trim();
  const hasApiKey = Boolean(apiKey && !apiKey.includes('FakeKey') && !apiKey.includes('your_'));
  return {
    projectId: FIREBASE_PROJECT_ID,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'gueattend.firebaseapp.com',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gueattend.firebasestorage.app',
    initialized: firebaseInitialized,
    hasApiKey,
    hasServiceAccount,
    canManageCustomClaims: hasServiceAccount,
  };
}

module.exports = {
  admin,
  getFirebaseApp,
  hasServiceAccountCredential,
  isAdminEmail,
  verifyFirebaseToken,
  setAuthenticatedUserClaim,
  checkFirebaseHealth,
};
