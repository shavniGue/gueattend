/**
 * Firebase Admin Service Configuration for gueattend
 *
 * Dedicated strictly to auxiliary features:
 *   - Push notifications
 *   - Optional file storage attachments
 *   - Authentication token validation
 *
 * Never duplicates ERP records (Supabase PostgreSQL is primary source of truth).
 */

const admin = require('firebase-admin');
const fs = require('fs');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gueattend';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '';

let firebaseInitialized = false;

try {
  if (SERVICE_ACCOUNT_PATH && fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gueattend.firebasestorage.app',
      projectId: FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
    console.log('[firebase] Admin SDK initialized with service account.');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
    });
    firebaseInitialized = true;
    console.log('[firebase] Admin SDK initialized with default application credentials.');
  } else {
    // Graceful initialization for token verification without full service account
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
 * Verifies Firebase ID Token if provided by client (e.g. for optional Google Sign-In)
 */
async function verifyFirebaseToken(idToken) {
  if (!idToken) throw new Error('Token is required.');
  return admin.auth().verifyIdToken(idToken);
}

/**
 * Diagnostic health-check for Firebase service
 */
function checkFirebaseHealth() {
  return {
    projectId: FIREBASE_PROJECT_ID,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'gueattend.firebaseapp.com',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gueattend.firebasestorage.app',
    initialized: firebaseInitialized,
  };
}

module.exports = {
  admin,
  verifyFirebaseToken,
  checkFirebaseHealth,
};

