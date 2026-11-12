/**
 * Module 2: AES-256-GCM Encryption Vault
 * gueattend - Secure Credential Storage for ERP Credentials
 *
 * Uses dedicated ENCRYPTION_KEY when provided, with deterministic backward-compatible
 * fallback to SESSION_SECRET (and supports multi-key decryption during rotation).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function deriveKey(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function getPrimaryKey() {
  const primarySeed =
    process.env.ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    'gueattend-default-secure-vault-key-32chars';
  return deriveKey(primarySeed);
}

function getCandidateDecryptionKeys() {
  const seeds = [
    process.env.ENCRYPTION_KEY,
    process.env.ENCRYPTION_KEY_PREVIOUS,
    process.env.SESSION_SECRET,
    'gueattend-default-secure-vault-key-32chars',
  ].filter(Boolean);

  const uniqueSeeds = [...new Set(seeds)];
  return uniqueSeeds.map(deriveKey);
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getPrimaryKey(), iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `v2:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(payload) {
  if (!payload || !payload.includes(':')) return '';
  const parts = String(payload).split(':');

  let ivHex;
  let authTagHex;
  let encryptedHex;
  if (parts.length === 4 && parts[0] === 'v2') {
    [, ivHex, authTagHex, encryptedHex] = parts;
  } else if (parts.length === 3) {
    [ivHex, authTagHex, encryptedHex] = parts;
  } else {
    return '';
  }

  for (const key of getCandidateDecryptionKeys()) {
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      // Try next rotation key
    }
  }
  return '';
}

module.exports = {
  encrypt,
  decrypt,
};
