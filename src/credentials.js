/**
 * Module 2: Session Disk Loader & Credential Manager
 * gueattend - Secure Session Storage (0600 Owner-Only Permissions)
 */

const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getSessionFilePath(userId) {
  const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(SESSIONS_DIR, `qums_${safeId}.json`);
}

/**
 * Save extracted ERP cookies securely with 0600 file mode
 */
function saveSessionCookies(userId, cookies, metadata = {}) {
  const filePath = getSessionFilePath(userId);
  const data = {
    userId,
    cookies,
    metadata,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });

  // On Unix-based systems enforce mode 0600 (owner read & write only)
  try {
    if (process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o600);
    }
  } catch (err) {
    // Ignore on unsupported filesystems
  }
  return filePath;
}

/**
 * Load session cookies from disk
 */
function loadSessionCookies(userId) {
  const filePath = getSessionFilePath(userId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[credentials] Failed to read session for ${userId}:`, err.message);
    return null;
  }
}

/**
 * Delete session cookies on explicit logout
 */
function clearSessionCookies(userId) {
  const filePath = getSessionFilePath(userId);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {}
  }
}

module.exports = {
  saveSessionCookies,
  loadSessionCookies,
  clearSessionCookies,
  getSessionFilePath,
};

