/**
 * GUeAttend Database Project Identity & Isolation Guard
 *
 * Ensures GUeAttend ONLY connects to its dedicated Supabase PostgreSQL project:
 *   Expected Supabase Project Reference: cnpullmxupyqdndxzbih
 *   Forbidden Reference (QAttend):       ifqcykeinpgqyoduwyho
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const BUNDLED_SUPABASE_CA_PATH = path.join(__dirname, '..', '..', 'config', 'supabase-prod-ca-2021.crt');

const EXPECTED_SUPABASE_PROJECT_REF = (
  process.env.GUEATTEND_SUPABASE_PROJECT_REF || 'cnpullmxupyqdndxzbih'
).trim().toLowerCase();

const FORBIDDEN_PROJECT_REFS = new Set(['ifqcykeinpgqyoduwyho']);

class DatabaseIsolationError extends Error {
  constructor(message, report = {}) {
    super(message);
    this.name = 'DatabaseIsolationError';
    this.code = 'DATABASE_ISOLATION_VIOLATION';
    this.report = report;
  }
}

function extractRefFromSupabaseUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(String(rawUrl).trim());
    const match = u.hostname.match(/^([a-z0-9-]+)\.supabase\.(?:co|com)$/i);
    return match ? match[1].toLowerCase() : '';
  } catch (err) {
    const fallback = String(rawUrl).match(/https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|com)/i);
    return fallback ? fallback[1].toLowerCase() : '';
  }
}

function parseConnectionStringIdentity(connectionString) {
  const raw = String(connectionString || '').trim();
  if (!raw) {
    return {
      present: false,
      isPlaceholder: false,
      username: '',
      hostname: '',
      port: '',
      database: '',
      dbRef: '',
      isLocalhost: false,
    };
  }

  const lowerRaw = raw.toLowerCase();
  const isPlaceholder =
    lowerRaw.includes('[password]') ||
    lowerRaw.includes('your_password') ||
    lowerRaw.includes('<password>') ||
    lowerRaw.includes('[your_db_password]');

  let username = '';
  let hostname = '';
  let port = '';
  let database = '';

  try {
    const parsed = new URL(raw);
    username = decodeURIComponent(parsed.username || '');
    hostname = (parsed.hostname || '').toLowerCase();
    port = parsed.port || '';
    database = (parsed.pathname || '').replace(/^\//, '');
  } catch (err) {
    const hostMatch = raw.match(/@([^:/?#\s]+)(?::(\d+))?\/([^?\s]*)/);
    const userMatch = raw.match(/:\/\/([^:@\s]+)(?::[^@]*)?@/);
    username = userMatch ? userMatch[1] : '';
    hostname = hostMatch ? hostMatch[1].toLowerCase() : '';
    port = hostMatch && hostMatch[2] ? hostMatch[2] : '';
    database = hostMatch ? hostMatch[3] : '';
  }

  // Extract project ref from Supabase pooler username (postgres.<ref>) OR direct db host (db.<ref>.supabase.co)
  const userRefMatch = username.match(/^postgres\.([a-z0-9-]+)$/i);
  const directHostRefMatch = hostname.match(/^db\.([a-z0-9-]+)\.supabase\.(?:co|com)$/i);
  const dbRef = (
    (userRefMatch && userRefMatch[1]) ||
    (directHostRefMatch && directHostRefMatch[1]) ||
    ''
  ).toLowerCase();

  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  return {
    present: true,
    isPlaceholder,
    username,
    hostname,
    port,
    database,
    dbRef,
    isLocalhost,
  };
}

/**
 * Verifies that DATABASE_URL, SUPABASE_URL, and SUPABASE_JWKS_URL all belong exclusively
 * to GUeAttend's isolated Supabase project (`cnpullmxupyqdndxzbih`).
 */
function verifyDatabaseIsolation(options = {}) {
  const connectionString = options.connectionString !== undefined ? options.connectionString : (process.env.DATABASE_URL || '');
  const supabaseUrl = options.supabaseUrl !== undefined ? options.supabaseUrl : (process.env.SUPABASE_URL || '');
  const jwksUrl = options.jwksUrl !== undefined ? options.jwksUrl : (process.env.SUPABASE_JWKS_URL || '');
  const allowLocalTest = Boolean(options.allowLocalTest || String(process.env.ALLOW_LOCAL_TEST_DB || '').toLowerCase() === 'true');

  const conn = parseConnectionStringIdentity(connectionString);
  const supabaseRef = extractRefFromSupabaseUrl(supabaseUrl);
  const jwksRef = extractRefFromSupabaseUrl(jwksUrl);
  const reasons = [];

  if (!supabaseUrl) {
    reasons.push('SUPABASE_URL is not configured.');
  } else if (supabaseRef !== EXPECTED_SUPABASE_PROJECT_REF) {
    reasons.push(
      `SUPABASE_URL points to "${supabaseRef || 'unknown'}", expected GUeAttend project "${EXPECTED_SUPABASE_PROJECT_REF}".`
    );
  }

  if (jwksUrl && jwksRef !== EXPECTED_SUPABASE_PROJECT_REF) {
    reasons.push(
      `SUPABASE_JWKS_URL points to "${jwksRef || 'unknown'}", expected "${EXPECTED_SUPABASE_PROJECT_REF}".`
    );
  }
  if (jwksUrl && !jwksUrl.includes('.supabase.co/')) {
    reasons.push(`SUPABASE_JWKS_URL must use *.supabase.co domain (found "${jwksUrl}").`);
  }

  let isForbiddenProject = false;
  if (FORBIDDEN_PROJECT_REFS.has(conn.dbRef) || FORBIDDEN_PROJECT_REFS.has(supabaseRef) || FORBIDDEN_PROJECT_REFS.has(jwksRef)) {
    isForbiddenProject = true;
    reasons.push('CRITICAL: Configuration references QAttend database project (ifqcykeinpgqyoduwyho). Connection blocked.');
  }

  if (!conn.present || conn.isPlaceholder) {
    reasons.push(
      `DATABASE_URL is not configured with live credentials for Supabase project "${EXPECTED_SUPABASE_PROJECT_REF}".`
    );
  } else if (conn.isLocalhost && allowLocalTest) {
    // Explicit isolated local Postgres test instance allowed only when not referencing forbidden refs
  } else {
    if (!conn.hostname.endsWith('.supabase.com') && !conn.hostname.endsWith('.supabase.co')) {
      reasons.push(
        `DATABASE_URL hostname "${conn.hostname || 'unknown'}" is not a recognized Supabase PostgreSQL host.`
      );
    }
    if (conn.dbRef !== EXPECTED_SUPABASE_PROJECT_REF) {
      reasons.push(
        `DATABASE_URL identity (${conn.dbRef || conn.username || conn.hostname || 'unknown'}) does not match GUeAttend project "${EXPECTED_SUPABASE_PROJECT_REF}".`
      );
    }
  }

  const ok = reasons.length === 0;
  return {
    ok,
    expectedRef: EXPECTED_SUPABASE_PROJECT_REF,
    dbRef: conn.dbRef,
    dbHost: conn.hostname,
    dbUser: conn.username,
    supabaseRef,
    jwksRef,
    isPlaceholder: conn.isPlaceholder,
    isForbiddenProject,
    reasons,
  };
}

function assertDatabaseIsolation(options = {}) {
  const report = verifyDatabaseIsolation(options);
  if (!report.ok) {
    throw new DatabaseIsolationError(
      `Database isolation check aborted execution: ${report.reasons.join(' ')}`,
      report
    );
  }
  return report;
}

/**
 * Resolves PostgreSQL TLS options with strict certificate verification (`rejectUnauthorized: true`).
 * Uses operator-supplied CA or the bundled Supabase Root 2021 CA for Supabase pooler/direct hosts.
 */
function resolvePgSslConfig(connectionString = '') {
  const conn = parseConnectionStringIdentity(connectionString);
  if (!connectionString || conn.isLocalhost) {
    return false;
  }

  const caPath = process.env.DATABASE_CA_CERT_PATH || process.env.PGSSLROOTCERT || '';
  const inlineCa = process.env.DATABASE_CA_CERT || '';
  const isSupabaseHost = conn.hostname.endsWith('.supabase.com') || conn.hostname.endsWith('.supabase.co');
  let ca = undefined;

  if (inlineCa) {
    ca = inlineCa.replace(/\\n/g, '\n');
  } else if (caPath && fs.existsSync(caPath)) {
    ca = fs.readFileSync(caPath, 'utf8');
  } else if (isSupabaseHost && fs.existsSync(BUNDLED_SUPABASE_CA_PATH)) {
    ca = fs.readFileSync(BUNDLED_SUPABASE_CA_PATH, 'utf8');
  }

  return {
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
  };
}

module.exports = {
  EXPECTED_SUPABASE_PROJECT_REF,
  FORBIDDEN_PROJECT_REFS,
  DatabaseIsolationError,
  extractRefFromSupabaseUrl,
  parseConnectionStringIdentity,
  verifyDatabaseIsolation,
  assertDatabaseIsolation,
  resolvePgSslConfig,
};

