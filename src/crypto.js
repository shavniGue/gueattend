/**
 * Module 2: AES-256-GCM Encryption Vault
 * gueattend - Secure Credential Storage for ERP Credentials
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SECRET_SEED = process.env.SESSION_SECRET || 'gueattend-default-secure-vault-key-32chars';
const KEY = crypto.createHash('sha256').update(String(SECRET_SEED)).digest();

/**
 * Encrypt plain text using AES-256-GCM
 * @param {string} text - Plain text password or sensitive token
 * @returns {string} - Formatted encrypted string: iv:authTag:encryptedData
 */
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt cipher text using AES-256-GCM
 * @param {string} payload - Formatted string: iv:authTag:encryptedData
 * @returns {string} - Decrypted plain text
 */
function decrypt(payload) {
  if (!payload || !payload.includes(':')) return '';
  try {
    const parts = payload.split(':');
    if (parts.length !== 3) return '';
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[crypto] Decryption error:', err.message);
    return '';
  }
}

module.exports = {
  encrypt,
  decrypt,
};
